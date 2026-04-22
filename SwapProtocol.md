# Swap Protocol

> **Pvium's non-custodial payment routing protocol for token swaps and invoice settlement**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Solidity](https://img.shields.io/badge/Solidity-^0.8.20-blue)](https://soliditylang.org/)
[![Hardhat](https://img.shields.io/badge/Built%20with-Hardhat-yellow)](https://hardhat.org/)

## Protocol Overview

Pvium Swap Protocol is a decentralized payment routing protocol that enables multi-token settlements through the `UniversalDexRouter` smart contract. It supports atomic swaps, payment distribution, and on-chain event logs for payment tracking.

### Core Protocol Features

- **Multi-Token Acceptance**: Accept payments in any ERC20 token with sufficient DEX liquidity
- **Atomic Settlement**: Swap and payment execution in a single transaction
- **On-Chain Auditability**: Immutable event logs for every payment
- **DEX Routing**: Integrates V2-style routers and supports batch-funding flows into approved Merkle payout contracts
- **Non-Custodial Flow**: Funds are routed during execution instead of held as protocol balances

## Protocol Mechanism

### Transaction Flow

1. **Payment Initiation**: A payer selects the token they want to spend.
2. **Route Selection**: An off-chain system chooses the desired swap path.
3. **Approval / Native Funding**: The payer approves token spend or sends native gas token value.
4. **Atomic Execution**: `UniversalDexRouter` performs the swap and splits the output into:
   - recipient payment
   - protocol fee
   - refund where applicable
5. **Event Emission**: `SwapExecuted`, `SwapFee`, and protocol-specific batch events are emitted.

## Contract Responsibilities

`UniversalDexRouter` is the main protocol router. Its implementation includes:

- role-gated admin operations via OpenZeppelin `AccessControl`
- fee receiver management
- swap execution for exact-input and exact-output flows
- native token and ERC20 payment support
- support registration for approved `MerkleBatchPayout` contracts
- events for swap tracking, fee collection, and Merkle batch funding / claims

## Event Model

### `SwapFee`

```solidity
event SwapFee(
    address indexed sender,
    uint256 indexed swapId,
    uint256 fee
);
```

### `SwapExecuted`

```solidity
event SwapExecuted(
    address indexed sender,
    address indexed recipient,
    address tokenIn,
    address indexed tokenOut,
    uint256 amountIn,
    uint256 amountOut,
    uint256 paymentAmount,
    string memo
);
```

These events support indexing, payment detection, reconciliation, and memo-based invoice association.

## Security Model

- `ReentrancyGuard` protects external swap entrypoints
- `ADMIN_ROLE` controls fee receiver updates and Merkle batch contract support
- max fee is capped in-contract at 30 bps
- slippage is controlled by user-provided minimum output / maximum input constraints
- failed execution reverts atomically

## Deployments

### Mainnet Deployments

| Network | Chain ID | UniversalDexRouter | DEX Integration | Status |
|---------|----------|-------------------|-----------------|--------|
| **Base** | 8453 | `0xbe31BE82b488321b7acFAc3bd41998C9843B2e71` | Uniswap V2, Aerodrome (coming soon) | ✅ Production |
| **BNB Chain** | 56 | `0xbe31BE82b488321b7acFAc3bd41998C9843B2e71` | PancakeSwap V2 | ✅ Production |

### Testnet Deployments

| Network | Chain ID | UniversalDexRouter | Status |
|---------|----------|-------------------|--------|
| Base Sepolia | 84532 | `0x45B6540EE63a9455e4d405C50446F1Abc90b5BF4` | 🔧 Development |

## Integration Reference

Typical integrations use:

- `swapExactTokensForTokens`
- `swapETHForExactTokens`
- quote helpers for route estimation
- event subscriptions on `SwapExecuted`

See [contracts/UniversalDexRouter.sol](./contracts/UniversalDexRouter.sol) and the scripts in `scripts/` for deployment and admin operations.
