# BatchTransfer Contract Deployment Guide

## Overview
The BatchTransfer contract enables secure, atomic batch transfers of ERC20 tokens. Unlike using Multicall3 with `transferFrom` (which creates a security vulnerability), this contract:
- Transfers tokens from **msg.sender** (the caller) to multiple recipients
- All transfers in a batch succeed or fail atomically
- Only the caller can move their own tokens (secure by design)
- No need to fund the contract - it transfers from your wallet
- Caller must approve the contract once per batch

## Security Issue with Multicall3
When using an EOA (wallet) to call Multicall3:
- Multicall3 uses regular `call`, NOT `delegatecall`
- The `msg.sender` in target contracts is Multicall3, not your wallet
- To use `transferFrom`, you must approve Multicall3 to spend tokens
- **VULNERABILITY**: Anyone can call the public Multicall3 contract to drain your approved tokens
- **Solution**: Use a custom contract that transfers from msg.sender (only caller can move their own tokens)

## Deployment Steps

### 1. Compile and Deploy Contract
```bash
cd /Users/Projects/Javascript/paytrack/contracts

# Compile the contract
npx hardhat compile

# Deploy to Base Testnet
npx hardhat run scripts/deploy-batch-transfer.js --network base-testnet

# Deploy to Base Mainnet (production)
npx hardhat run scripts/deploy-batch-transfer.js --network base
```

### 2. Update Environment Variables
Add the deployed contract address to your `.env` file:

```bash
# BatchTransfer contract address (after deployment)
BATCH_TRANSFER_CONTRACT=0x... # Replace with actual deployed address
```

### 3. Fund Your Wallet (Not the Contract)
The BatchTransfer contract transfers from **your wallet**, not from the contract itself.
Make sure your `REWARD_PAYOUT_WALLET` has enough USDC balance:

```bash
# Check your wallet balance
# The wallet configured in REWARD_PAYOUT_WALLET should have USDC
```

### 4. No Ownership Needed
The contract has no owner - anyone can call it, but they can only transfer their own tokens.
This is secure because:
- You approve the contract to spend YOUR tokens
- The contract transfers from msg.sender (you) to recipients
- No one else can spend your approved tokens

## Contract Interface

### Main Function
```solidity
function batchTransfer(
    address token,        // ERC20 token address (USDC)
    address[] recipients, // Array of recipient addresses
    uint256[] amounts     // Array of amounts (must match recipients.length)
) external
```

**Note**: No `onlyOwner` modifier - anyone can call, but only transfers from their own wallet

## Usage Flow

1. **Setup**: Deploy contract and add address to .env
2. **Fund Wallet**: Ensure your REWARD_PAYOUT_WALLET has USDC
3. **Approval**: Worker service approves BatchTransfer to spend batch amount
4. **Batch Execution**: Worker service calls `batchTransfer()` with arrays of recipients and amounts
5. **Atomic Processing**: All transfers execute in one transaction - all succeed or all fail
6. **Database Update**: After successful on-chain transfer, batch update all reward records
7. **Notifications**: Send success notifications to all users

## Gas Optimization
- Batch size: 20 transfers per transaction (configurable in `worker.service.ts`)
- Each batch is atomic - if one fails, all revert
- More gas efficient than individual transfers
- Approval transaction only needed when allowance is insufficient

## Monitoring
Check your wallet balance regularly:
```javascript
const balance = await usdcContract.balanceOf(REWARD_PAYOUT_WALLET);
console.log(`Wallet USDC balance: ${ethers.formatUnits(balance, 6)} USDC`);
```

## Security Features
✅ **Transfers from msg.sender** - only the caller can move their own tokens
✅ **Atomic batch processing** - all or nothing
✅ **No ownership** - permissionless contract, secure by design
✅ **Approval scoped to caller** - each user approves only for their own tokens
✅ **No funds held in contract** - nothing to steal from the contract itself
✅ **Cannot drain other users** - impossible to transfer someone else's approved tokens

## Contract Address (Update After Deployment)
- **Base Testnet**: TBD
- **Base Mainnet**: TBD
