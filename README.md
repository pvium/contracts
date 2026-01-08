# SwapPay Protocol

> **A non-custodial payment routing protocol enabling invoice settlements in any token with instant stablecoin conversion**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Solidity](https://img.shields.io/badge/Solidity-^0.8.20-blue)](https://soliditylang.org/)
[![Hardhat](https://img.shields.io/badge/Built%20with-Hardhat-yellow)](https://hardhat.org/)

## Protocol Overview

SwapPay is a decentralized payment routing protocol that enables frictionless multi-token invoice settlements. Built on the UniversalDexRouter smart contract, the protocol provides atomic token swaps with instant settlement and complete on-chain auditability.

### Core Protocol Features

- **Multi-Token Acceptance**: Accept payments in any ERC20 token with sufficient DEX liquidity
- **Atomic Settlement**: Instant, non-custodial conversion and transfer in a single transaction
- **On-Chain Auditability**: Immutable event logs for every payment with invoice association
- **Optimal Execution**: Intelligent routing across multiple DEX protocols (Uniswap V2/V3, PancakeSwap, Aerodrome)
- **Zero Custody**: Protocol never holds user funds; all operations are atomic

## Protocol Mechanism

### Transaction Flow

The SwapPay protocol executes payment settlements through a single atomic transaction:

1. **Payment Initiation**: Invoice denominated in a target stablecoin (USDC, USDT, DAI, etc.)
2. **Token Selection**: Payer selects payment token from available balance (ETH, WBTC, or any ERC20)
3. **Route Optimization**: Off-chain quoter determines optimal execution path across integrated DEXs
4. **Minimal Approval**: Payer approves exact input amount required for swap
5. **Atomic Execution**: UniversalDexRouter executes swap and settlement in single transaction:
   - Input token → DEX swap → Output stablecoin
   - Instant transfer to recipient address (99.7%)
   - Protocol fee distribution (0.3% max)
   - Excess input refund (for exact output swaps)
6. **Event Emission**: `SwapFee` and `SwapExecuted` events published for indexing and audit
7. **Invoice Settlement**: Payment automatically linked to invoice via memo field

### Protocol Guarantees

| Guarantee | Implementation |
|-----------|----------------|
| **Non-Custodial** | Zero balance retention; atomic execution only |
| **Instant Settlement** | Single-transaction finality; no withdrawal delays |
| **Auditability** | Immutable event logs with invoice association |
| **Slippage Protection** | User-defined minimum output amounts enforced |
| **Refund Mechanism** | Automatic return of unused input tokens |
| **Fee Transparency** | Maximum 0.3% fee enforced at contract level |

## Event Schema & Indexing

The protocol emits two events per transaction, providing a complete audit trail for payment detection, settlement verification, and compliance monitoring.

### Event Architecture

**Design Principles:**
- **Immutability**: On-chain event logs are permanent and tamper-proof
- **Real-time Indexing**: Events enable instant payment detection via event listeners
- **Regulatory Compliance**: Complete audit trail for accounting and tax reporting
- **Invoice Association**: Memo field provides deterministic payment-to-invoice mapping

### 1. SwapFee Event
```solidity
event SwapFee(
    address indexed sender,      // Who initiated the payment
    uint256 indexed swapId,      // Unique swap identifier
    uint256 fee                  // Fee collected (in output token)
);
```

### 2. SwapExecuted Event
```solidity
event SwapExecuted(
    address indexed sender,      // Who initiated the payment
    address indexed recipient,   // Invoice recipient
    address tokenIn,             // Token used for payment
    address indexed tokenOut,    // Token received (invoice stablecoin)
    uint256 amountIn,           // Amount of input token
    uint256 amountOut,          // Amount of output token received
    uint256 paymentAmount,      // Amount sent to recipient
    string memo                 // Invoice ID or reference
);
```

**Indexing Strategy**: The `memo` field enables O(1) payment-to-invoice mapping for backend systems.

## Technical Specifications

### Supported DEX Integrations

- ✅ **V2 Swaps**: Uniswap V2, PancakeSwap, Aerodrome
  - Exact input swaps (ETH/tokens → tokens/ETH)
  - Exact output swaps (pay exactly what's invoiced)

- ✅ **V3 Swaps**: Uniswap V3
  - Single-hop swaps (direct pair)
  - Multi-hop swaps (routing through multiple pools)
  - Exact input and exact output support

### Route Optimization

The protocol supports multi-path routing with off-chain computation for optimal execution:

| Optimization | Implementation |
|--------------|----------------|
| **Quote Aggregation** | Parallel price queries across all integrated DEXs |
| **Path Comparison** | Single-hop vs multi-hop route evaluation |
| **Fee Tier Analysis** | V3 pool comparison (0.05%, 0.3%, 1% tiers) |
| **Best Execution** | Minimizes input amount required from payer |
| **Slippage Configuration** | User-defined tolerance (default: 1%) |

### Fee Model

| Parameter | Value | Notes |
|-----------|-------|-------|
| **Protocol Fee** | 0.3% (30 bps) | Maximum enforced at contract level |
| **Fee Transparency** | On-chain | Emitted in `SwapFee` event |
| **Additional Costs** | DEX-dependent | Uniswap/PancakeSwap/Aerodrome native fees |

### Security Model

| Security Layer | Implementation |
|----------------|----------------|
| **Reentrancy Guard** | OpenZeppelin `ReentrancyGuard` on all external functions |
| **Access Control** | Role-based permissions (OpenZeppelin `AccessControl`) |
| **Fee Enforcement** | Maximum 0.3% hardcoded at contract level |
| **Slippage Protection** | User-defined `amountOutMin` / `amountInMax` parameters |
| **Atomic Execution** | All-or-nothing transactions; no partial states |
| **Emergency Controls** | Admin-only withdrawal for stuck funds (requires `DEFAULT_ADMIN_ROLE`) |

## Non-Custodial Architecture

### Core Principle: Zero Balance Protocol

SwapPay implements a **pure routing architecture** with zero fund custody:

| Principle | Guarantee |
|-----------|-----------|
| **Zero Balance** | Contract maintains 0 balance; all funds routed atomically |
| **Instant Settlement** | Single-transaction finality; recipient receives funds immediately |
| **Atomic Execution** | All-or-nothing; no partial execution or intermediate states |
| **Minimal Approval** | Users approve exact input amount only; no blanket approvals |
| **Direct Transfer** | Funds flow directly from DEX to recipient address |
| **Immutable Audit** | Events (`SwapFee`, `SwapExecuted`) provide complete transaction history |
| **No Deposit Phase** | Zero waiting period; no lock-up mechanisms |

### Execution Architecture

The UniversalDexRouter functions as a **stateless router**, not a custodian:

```
┌─────────────────────────────────────────────────────────────┐
│              SINGLE ATOMIC TRANSACTION                       │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  1. Input Token    →  DEX Contract                          │
│  2. DEX Swap       →  Output Stablecoin                     │
│  3. Distribution   →  Recipient (99.7%)                     │
│                    →  Fee Receiver (0.3%)                   │
│                    →  Excess Refund (if any)                │
│  4. Event Emission →  SwapFee + SwapExecuted                │
│                                                              │
│  Router Balance: 0 (before) → 0 (after)                    │
└─────────────────────────────────────────────────────────────┘
```

**Key Invariant**: `routerBalance(t) = 0` for all time `t` outside active transaction execution.

## Deployments

### Mainnet Deployments

| Network | Chain ID | UniversalDexRouter | DEX Integration | Status |
|---------|----------|-------------------|-----------------|--------|
| **Base** | 8453 | `0xbe31BE82b488321b7acFAc3bd41998C9843B2e71` |  Uniswap V2, Aerodrome (Coming soon), | ✅ Production |
| **BNB Chain** | 56 | `0xbe31BE82b488321b7acFAc3bd41998C9843B2e71` | PancakeSwap V2 | ✅ Production |



### Testnet Deployments

| Network | Chain ID | UniversalDexRouter | Status |
|---------|----------|-------------------|--------|
| Base Sepolia | 84532 | `0x45B6540EE63a9455e4d405C50446F1Abc90b5BF4` | 🔧 Development |

### External Routers

| Network | DEX Router | Address |
|---------|-----------|---------|
| BNB Chain | PancakeSwap V2 | `0x10ED43C718714eb63d5aA57B78B54704E256024E` |
| Base | Uniswap | `0x4752ba5dbc23f44d87826276bf6fd6b1c372ad24` |

## Integration Guide

### SDK Integration (ethers.js v6)

```typescript
import { ethers } from "ethers";

const router = await ethers.getContractAt(
  "UniversalDexRouter",
  "0xbe31BE82b488321b7acFAc3bd41998C9843B2e71" // BSC address
);

// Swap ETH for exact USDT to pay invoice #36349b
const params = {
  amountOutMin: ethers.parseUnits("100", 18),  // Want exactly 100 USDT
  path: [WBNB, USDT],                          // Swap path
  to: "0x4d8caa7826e8b10b97ef173a282cbf2d772c1131",  // Invoice recipient
  paymentAmount: ethers.parseUnits("99.7", 18),      // 99.7 USDT to recipient
  deadline: Math.floor(Date.now() / 1000) + 120,    // 2 min deadline
  memo: "36349b"                                      // Invoice ID
};

const tx = await router.swapETHForExactTokens(params, {
  value: ethers.parseEther("0.05")  // Max 0.05 BNB willing to spend
});

await tx.wait();
```

### Quote Interface

```typescript
// Quote exact output: determine required input for desired output
const amounts = await router.quoteForExactOutputV2(
  ethers.parseUnits("100", 18),  // Desired output amount
  [WBNB, USDT]                    // Swap path
);

console.log(`Required input: ${ethers.formatEther(amounts[0])} BNB`);
```

### Event Listener Implementation

```typescript
// Real-time payment detection via event subscription
router.on("SwapExecuted", async (
  sender,
  recipient,
  tokenIn,
  tokenOut,
  amountIn,
  amountOut,
  paymentAmount,
  memo,
  event
) => {
  // Parse payment data
  const payment = {
    invoiceId: memo,
    payer: sender,
    recipient: recipient,
    amountPaid: ethers.formatUnits(paymentAmount, 18),
    tokenPaid: tokenOut,
    txHash: event.log.transactionHash,
    blockNumber: event.log.blockNumber,
  };

  console.log(`✓ Payment detected for invoice ${memo}`);
  console.log(`  Amount: ${payment.amountPaid} tokens`);
  console.log(`  Payer: ${sender}`);
  console.log(`  TX: ${payment.txHash}`);

  // Update backend state
  await updateInvoiceStatus(payment.invoiceId, "PAID", payment);
});
```

## Development

### Build & Test

```bash
# Install dependencies
npm install --save-dev hardhat @nomicfoundation/hardhat-toolbox

# Compile contracts
npx hardhat compile

# Run test suite
npx hardhat test

# Deploy to network
npx hardhat run scripts/deployUniversalDexRouter.ts --network <network-name>
```

## Security

### Audit Status

| Status | Details |
|--------|---------|
| **Formal Audit** | 🔜 Scheduled - third-party audit in progress |
| **Internal Review** | ✅ Complete |
| **Automated Scanning** | ✅ Complete (Slither, MythX) |
| **Test Coverage** | ✅ Comprehensive unit & integration tests |
| **Testnet Validation** | ✅ Complete |

**⚠️ Risk Disclosure**: Protocol is not yet formally audited. Use at your own risk until audit publication.

### Security Practices

- **OpenZeppelin Contracts**: Industry-standard implementations for `ReentrancyGuard`, `AccessControl`
- **Immutable Logic**: No upgradeable proxies; contract logic is immutable post-deployment
- **Rate Limiting**: Fee enforcement prevents economic exploits (max 0.3%)
- **Slippage Protection**: User-defined bounds on all swap operations
- **Emergency Controls**: Admin-only recovery mechanisms with role-based access

### Bug Bounty

Coming soon. Responsible disclosure: security@pvium.com

## Protocol Architecture

### Contract Composition

```
┌─────────────────────────────────────┐
│      UniversalDexRouter             │
│  (Core Protocol Contract)           │
├─────────────────────────────────────┤
│ • OpenZeppelin::AccessControl       │
│ • OpenZeppelin::ReentrancyGuard     │
│ • IUniswapV2Router (V2 DEX)        │
│ • IUniswapV3Router (V3 DEX)        │
│ • IWETH (Wrapped ETH)              │
└─────────────────────────────────────┘

┌─────────────────────────────────────┐
│      AerodromeRouter                │
│  (Aerodrome-specific Implementation)│
├─────────────────────────────────────┤
│ • OpenZeppelin::AccessControl       │
│ • OpenZeppelin::ReentrancyGuard     │
│ • IAerodromeRouter                  │
└─────────────────────────────────────┘
```

### Transaction Lifecycle

```
┌──────────────────────────────────────────────────────────────┐
│  PHASE 1: OFF-CHAIN PREPARATION                              │
├──────────────────────────────────────────────────────────────┤
│  1. Invoice Creation (target stablecoin specified)           │
│  2. Route Optimization (quote aggregation across DEXs)       │
│  3. Token Approval (payer approves exact input amount)       │
└──────────────────────────────────────────────────────────────┘
                            ↓
┌──────────────────────────────────────────────────────────────┐
│  PHASE 2: ON-CHAIN EXECUTION (ATOMIC)                        │
├──────────────────────────────────────────────────────────────┤
│  UniversalDexRouter.swapXXX()                                │
│    │                                                          │
│    ├─→ [1] Transfer: Input Token → DEX                      │
│    ├─→ [2] Execute: DEX Swap (input → stablecoin)           │
│    ├─→ [3] Validate: Fee ≤ 0.3%, slippage within bounds     │
│    ├─→ [4] Distribute: (ZERO BALANCE MAINTAINED)            │
│    │       • Recipient: 99.7% (INSTANT)                     │
│    │       • Fee Receiver: 0.3%                             │
│    │       • Refund: Excess → Payer                         │
│    ├─→ [5] Store: SwapData (on-chain record)                │
│    └─→ [6] Emit: SwapFee + SwapExecuted events              │
│                                                              │
│  Router Balance: 0 (invariant maintained)                   │
└──────────────────────────────────────────────────────────────┘
                            ↓
┌──────────────────────────────────────────────────────────────┐
│  PHASE 3: BACKEND INDEXING                                   │
├──────────────────────────────────────────────────────────────┤
│  1. Event Listener detects SwapExecuted                      │
│  2. Invoice matched via memo field (O(1) lookup)             │
│  3. Payment status updated to PAID                           │
│  4. Audit trail persisted in database                        │
└──────────────────────────────────────────────────────────────┘
```

### State Management

The protocol maintains minimal on-chain state for analytics and verification:

```solidity
// Swap record structure
struct SwapData {
    address recipient;      // Payment beneficiary
    uint256 paymentAmount; // Net amount transferred (excludes fee)
    uint256 timestamp;     // Block timestamp
    string memo;           // Invoice identifier
}

// State mappings
mapping(uint256 => SwapData) public swaps;              // swapId → SwapData
mapping(address => uint256) public swapCounts;          // recipient → total count
mapping(address => uint256) public swapTotalsToken;     // token → cumulative volume
mapping(address => uint256) public swapTotalsRecipient; // recipient → cumulative received
```

## Contract Interface

### Core Swap Functions

#### Uniswap V2 Compatible

| Function | Description | Parameters |
|----------|-------------|------------|
| `swapExactTokensForTokens` | Exact input token → variable output token | `SwapV2Params` |
| `swapExactETHForTokens` | Exact input ETH → variable output token | `SwapETHParams` |
| `swapExactTokensForETH` | Exact input token → variable output ETH | `SwapV2Params` |
| `swapTokensForExactTokens` | Variable input token → exact output token | `SwapV2Params` |
| `swapETHForExactTokens` | Variable input ETH → exact output token | `SwapETHParams` |

#### Uniswap V3 Compatible

| Function | Description | Parameters |
|----------|-------------|------------|
| `swapExactTokenForTokenSingleV3` | Exact input, single-hop V3 | `SwapV3SingleParams` |
| `swapExactTokenForTokenV3Multi` | Exact input, multi-hop V3 | `SwapV3MultiParams` |
| `swapTokensForExactTokensSingleV3` | Exact output, single-hop V3 | `SwapV3ExactOutputSingleParams` |
| `swapTokensForExactTokensV3Multi` | Exact output, multi-hop V3 | `SwapV3ExactOutputMultiParams` |
| `swapETHForExactTokensSingleV3` | ETH → exact output, single-hop | `SwapETHForExactTokensV3SingleParams` |
| `swapETHForExactTokensV3Multi` | ETH → exact output, multi-hop | `SwapETHForExactTokensV3MultiParams` |

### Quote Functions

| Function | Returns | Use Case |
|----------|---------|----------|
| `quoteForExactOutputV2(uint256, address[])` | Required input amount | Determine cost for exact output |
| `quoteForExactInputV2(uint256, address[])` | Expected output amount | Determine output for exact input |

### Analytics & State Queries

| Function | Returns | Description |
|----------|---------|-------------|
| `getSwapsByRange(uint256, uint256)` | `SwapData[]` | Batch retrieve swap records |
| `swaps(uint256)` | `SwapData` | Single swap record lookup |
| `swapCounts(address)` | `uint256` | Total swaps received by address |
| `swapTotalsToken(address)` | `uint256` | Cumulative volume for token |
| `swapTotalsRecipient(address)` | `uint256` | Cumulative received by address |

### Administrative Functions

| Function | Access Control | Purpose |
|----------|----------------|---------|
| `setFeeReceiver(address)` | `ADMIN_ROLE` | Update fee destination address |
| `emergencyWithdraw(address, address, uint256)` | `DEFAULT_ADMIN_ROLE` | Recover stuck funds (emergency only) |

## Frequently Asked Questions

### Protocol Usage

**Q: Why use SwapPay over traditional crypto payments?**

A: SwapPay provides:
- **Token Flexibility**: Pay with any ERC20 token (don't need exact denomination)
- **Instant Settlement**: On-chain finality with zero withdrawal delays
- **Non-Custodial**: No fund custody; retain control throughout transaction
- **Lower Costs**: No intermediaries; only DEX fees + 0.3% protocol fee
- **Global Access**: Permissionless; works anywhere with blockchain connectivity

**Q: What happens if a swap transaction fails?**

A: All transactions are atomic - they either complete fully or revert with zero state changes. No funds are lost. Common failure causes:
- Slippage tolerance exceeded
- Insufficient DEX liquidity
- Price volatility outside acceptable bounds

**Solution**: Retry with increased slippage tolerance or alternative token.

**Q: Can I pay a USDC invoice using ETH/WBTC/any token?**

A: Yes. SwapPay's core functionality is enabling cross-token payments. The protocol handles conversion automatically.

**Q: Which tokens are supported?**

A: Any ERC20 token with sufficient liquidity on integrated DEXs. The frontend filters tokens based on minimum liquidity thresholds to ensure execution reliability.

**Q: Is there a minimum payment amount?**

A: Economic minimums exist due to:
- DEX swap fees (0.05% - 1% depending on protocol)
- SwapPay protocol fee (0.3% max)
- Gas costs (chain-dependent)

**Recommendation**: For invoices < $10 USD, paying directly in the requested stablecoin is more cost-efficient.

**Q: What if I send excess funds in an exact output swap?**

A: **Exact Output Swaps**: Unused input is atomically refunded to sender.
**Exact Input Swaps**: Excess output (beyond `paymentAmount` + fee) is returned to sender.

All refunds occur within the same transaction - no manual claims required.

## Contributing

Contributions are welcome. Please follow these guidelines:

1. **Fork Repository**: Create personal fork for development
2. **Feature Branches**: Isolate changes in dedicated branches
3. **Test Coverage**: Include unit tests for all new functionality
4. **Test Passing**: Ensure `npx hardhat test` completes successfully
5. **Pull Request**: Submit with detailed description of changes

## License

This project is licensed under the **MIT License**. See `LICENSE` file for full terms.

## Resources & Support

| Resource | Link |
|----------|------|
| **Telegram Community** | [@pviumapp](https://t.me/pviumapp) |
| **Twitter** | [@pviumapp]](https://x.com/pviumapp) |
| **Email Support** | support@pvium.com |
| **Security Contact** | security@pvium.com |

---

## Acknowledgments

Built by the Pvium team.

**SwapPay Protocol** - Non-custodial payment routing for Web3.
