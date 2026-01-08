# MEV Protection Implementation Guide

## Overview
MEV protection has been implemented for the UniversalDexRouter and needs to be applied to AerodromeRouter.

## Features Implemented

### 1. **Configurable MEV Protection**
- `maxSlippageBps`: Maximum slippage allowed (default: 3% = 300 basis points)
- `minBlockDelay`: Blocks to wait between commitment and execution (default: 0, disabled)
- `commitmentDuration`: How long a commitment remains valid (default: 5 minutes)

### 2. **Two-Phase Commit Pattern** (Optional)
When `minBlockDelay > 0`:
1. User calls `commitSwap(paramsHash)` to commit to swap parameters
2. Wait for `minBlockDelay` blocks
3. Execute swap with commitment nonce

### 3. **Automatic Slippage Protection**
- Enforces maximum slippage regardless of user settings
- Rejects swaps with excessive slippage automatically

## Remaining Implementation Tasks for UniversalDexRouter

### Add Hash Helper Functions
Add these functions after `_computeParamsHash`:

```solidity
/**
 * @dev Helper to compute params hash for ETH swaps
 */
function _computeETHParamsHash(SwapETHParams calldata params) internal pure returns (bytes32) {
    return keccak256(abi.encode(
        params.amountOutMin,
        params.path,
        params.to,
        params.paymentAmount,
        params.deadline,
        params.memo
    ));
}

/**
 * @dev Helper to compute params hash for V3 single hop swaps
 */
function _computeV3SingleParamsHash(SwapV3SingleParams calldata params) internal pure returns (bytes32) {
    return keccak256(abi.encode(
        params.tokenIn,
        params.tokenOut,
        params.fee,
        params.amountIn,
        params.amountOutMinimum,
        params.to,
        params.paymentAmount,
        params.deadline,
        params.memo
    ));
}

/**
 * @dev Helper to compute params hash for V3 multi-hop swaps
 */
function _computeV3MultiParamsHash(SwapV3MultiParams calldata params) internal pure returns (bytes32) {
    return keccak256(abi.encode(
        params.path,
        params.amountIn,
        params.amountOutMinimum,
        params.to,
        params.paymentAmount,
        params.deadline,
        params.memo
    ));
}
```

### Update Function Signatures

#### swapExactETHForTokens (Line ~343)
```solidity
function swapExactETHForTokens(
    SwapETHParams calldata params
) external payable nonReentrant mevProtection(msg.value, params.amountOutMin, params.commitNonce, _computeETHParamsHash(params)) returns (uint256[] memory amounts) {
    require(params.path[0] == WETH, "Path must start with WETH");
    require(params.paymentAmount <= params.amountOutMin, "Payment amount exceeds minimum output");
    require(msg.value > 0, "ETH amount must be greater than zero");
    // ... rest of function
```

#### swapTokensForExactTokens (Line ~380)
```solidity
function swapTokensForExactTokens(
    SwapV2Params calldata params
) external nonReentrant mevProtection(params.amountIn, params.amountOutMin, params.commitNonce, _computeParamsHash(params)) returns (uint256[] memory amounts) {
    require(params.paymentAmount <= params.amountOutMin, "Payment amount exceeds minimum output");
    require(params.amountIn > 0, "Amount must be greater than zero");
    // ... rest of function

    // Add after swap execution:
    IERC20(params.path[0]).forceApprove(router, 0);
```

#### swapETHForExactTokens (Line ~429)
```solidity
function swapETHForExactTokens(
    SwapETHParams calldata params
) external payable nonReentrant mevProtection(msg.value, params.amountOutMin, params.commitNonce, _computeETHParamsHash(params)) returns (uint256[] memory amounts) {
    require(params.path[0] == WETH, "Path must start with WETH");
    require(params.paymentAmount <= params.amountOutMin, "Payment amount exceeds minimum output");
    require(msg.value > 0, "ETH amount must be greater than zero");

    // ... rest of function

    // CRITICAL FIX: Move event emission BEFORE refund (Line 468-469)
    emit SwapFee(msg.sender, swapId, feeAmount);
    emit SwapExecuted(msg.sender, params.to, params.path[0], params.path[params.path.length - 1], amounts[0], amounts[amounts.length - 1], params.paymentAmount, params.memo);

    // Then refund
    uint256 ethBalanceAfter = address(this).balance;
    if (ethBalanceAfter > ethBalanceBefore) {
        (bool success, ) = payable(msg.sender).call{value: ethBalanceAfter - ethBalanceBefore}("");
        require(success, "ETH refund failed");
    }
```

#### swapExactTokensForETH (Line ~476)
```solidity
function swapExactTokensForETH(
    SwapV2Params calldata params
) external nonReentrant mevProtection(params.amountIn, params.amountOutMin, params.commitNonce, _computeParamsHash(params)) returns (uint256[] memory amounts) {
    require(params.path[params.path.length - 1] == WETH, "Path must end with WETH");
    require(params.paymentAmount <= params.amountOutMin, "Payment amount exceeds minimum output");
    require(params.amountIn > 0, "Amount must be greater than zero");

    // ... after swap execution:
    IERC20(params.path[0]).forceApprove(router, 0);
```

#### swapExactTokenForTokenSingleV3 (Line ~185 in linted version)
```solidity
function swapExactTokenForTokenSingleV3(
    SwapV3SingleParams calldata swapParams
) external nonReentrant mevProtection(swapParams.amountIn, swapParams.amountOutMinimum, swapParams.commitNonce, _computeV3SingleParamsHash(swapParams)) returns (uint256 amountOut) {
    require(swapParams.paymentAmount <= swapParams.amountOutMinimum, "Payment amount exceeds minimum output");
    require(swapParams.amountIn > 0, "Amount must be greater than zero");

    // ... after swap execution:
    IERC20(swapParams.tokenIn).forceApprove(router, 0);
```

#### swapExactTokenForTokenV3Multi (Line ~234 in linted version)
```solidity
function swapExactTokenForTokenV3Multi(
    SwapV3MultiParams calldata swapParams
) external nonReentrant mevProtection(swapParams.amountIn, swapParams.amountOutMinimum, swapParams.commitNonce, _computeV3MultiParamsHash(swapParams)) returns (uint256 amountOut) {
    require(swapParams.paymentAmount <= swapParams.amountOutMinimum, "Payment amount exceeds minimum output");
    require(swapParams.amountIn > 0, "Amount must be greater than zero");

    // Add path length validation BEFORE assembly (Line ~243)
    require(swapParams.path.length >= 43, "Invalid path length");

    // ... after swap execution (after line 268):
    IERC20(tokenIn).forceApprove(router, 0);
```

### getSwapsByRange Fix (Line ~296)
```solidity
function getSwapsByRange(uint256 fromId, uint256 toId) external view returns (SwapData[] memory) {
    require(fromId <= toId, "Invalid range");
    require(toId <= lastSwapId, "Range exceeds last swap ID");

    uint256 length = toId - fromId + 1;
    require(length <= 100, "Range too large"); // Add this line

    SwapData[] memory result = new SwapData[](length);
    // ... rest of function
```

## Usage Examples

### Basic Usage (MEV Protection Enabled, No Commitment)
```javascript
const params = {
    amountIn: ethers.parseUnits("100", 18),
    amountOutMin: ethers.parseUnits("95", 18),
    path: [tokenA.address, tokenB.address],
    to: recipient.address,
    paymentAmount: ethers.parseUnits("90", 18),
    deadline: Math.floor(Date.now() / 1000) + 3600,
    memo: "Payment",
    commitNonce: 0  // No commitment
};

await router.swapExactTokensForTokens(params);
```

### Enhanced Protection with Commitment
```javascript
// Step 1: Compute params hash (off-chain)
const paramsHash = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
    ["uint256", "uint256", "address[]", "address", "uint256", "uint256", "string"],
    [amountIn, amountOutMin, path, to, paymentAmount, deadline, memo]
));

// Step 2: Commit
const tx = await router.commitSwap(paramsHash);
const receipt = await tx.wait();
const event = receipt.events.find(e => e.event === "SwapCommitted");
const nonce = event.args.nonce;

// Step 3: Wait for minBlockDelay blocks
await ethers.provider.send("evm_mine", []);  // Mine blocks

// Step 4: Execute swap with commitment
const params = {
    // ... same as above
    commitNonce: nonce  // Use commitment
};

await router.swapExactTokensForTokens(params);
```

### Admin Configuration
```javascript
// Enable stricter MEV protection
await router.setMEVConfig(
    true,      // enabled
    200,       // 2% max slippage
    2,         // 2 block delay
    600        // 10 minute commitment duration
);

// Disable MEV protection (not recommended for mainnet)
await router.setMEVConfig(false, 0, 0, 60);
```

## Testing Requirements

1. Test slippage rejection
2. Test commitment flow (commit → wait → execute)
3. Test commitment expiry
4. Test invalid commitment
5. Test zero amount rejection
6. Test approval reset after swaps
7. Test MEV config updates
8. Test with MEV protection disabled

## AerodromeRouter Implementation

Apply the same pattern to AerodromeRouter.sol:
1. Copy MEV config structs, mappings, and events
2. Add MEV protection modifier
3. Update SwapParams struct to include `commitNonce`
4. Add `setMEVConfig()` and `commitSwap()` functions
5. Add hash helper functions
6. Apply MEV protection to all swap functions
7. Add approval reset with `forceApprove(router, 0)`
8. Add zero amount validations

## Security Notes

- MEV protection provides **defense in depth** but cannot eliminate all MEV
- Users should still use private RPCs or Flashbots for maximum protection
- The commitment pattern adds 1-2 blocks of latency but significantly reduces sandwich attack risk
- Slippage limits prevent the worst MEV scenarios but determined attackers can still extract value within limits
