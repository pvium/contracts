# Batch Payment Protocol

> **Pvium's scheduled payment protocol for batched payouts secured by Merkle proofs**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Solidity](https://img.shields.io/badge/Solidity-^0.8.20-blue)](https://soliditylang.org/)
[![Hardhat](https://img.shields.io/badge/Built%20with-Hardhat-yellow)](https://hardhat.org/)

## Protocol Overview

Pvium Batch Payment Protocol is a scheduled payout system built around the `MerkleBatchPayout` contract. It lets a payer or platform fund a batch once, publish a Merkle root representing many future payments, and allow each recipient to claim their allocation on or after its claim date.

This model is designed for scheduled payroll, affiliate payouts, rebates, vesting-style disbursements, and large-scale payment runs where on-chain efficiency matters.

## Protocol Design

### Core Properties

- **Scheduled Claims**: Each payment includes a `claimDate`, so recipients can only claim when the payment becomes active.
- **Batch Compression**: Many payments are represented by a single Merkle root instead of storing every payout on-chain.
- **Recipient Self-Service**: Each receiver claims independently using a Merkle proof.
- **Single Funding Token Per Batch**: Every batch is funded and paid in one token.
- **Replay Resistance**: Leaves are tied to the contract-generated batch hash.
- **Claim Protection**: Claimed and disabled leaves are tracked on-chain.

## How The Protocol Works

### 1. Batch Definition

An off-chain service prepares a list of payments. Each payment contains:

- receiver address
- payment amount
- claim date
- memo

The payment list is encoded into Merkle leaves and rolled into a single Merkle root.

### 2. Batch Creation

The creator calls `createBatch(...)` with:

- an external batch identifier
- signer identity
- Merkle root
- batch timing configuration
- funding token
- total funding amount
- optional withdrawal wallet
- optional signer authorization

Inside the contract:

- a protocol batch hash is derived from the batch inputs
- the protocol batch id is derived from signer + batch hash
- the funding token is transferred into the payout contract
- the batch metadata is stored under that batch id

### 3. Scheduled Claiming

A recipient claims with:

- `payment.batchId`
- receiver address
- amount
- claim date
- memo
- Merkle proof

The contract reconstructs the leaf and verifies:

- the batch exists
- the claim date has passed
- the claim is not already claimed
- the claim has not been disabled
- the Merkle proof is valid
- the batch still has sufficient funds

If valid, the funding token is transferred to the receiver.

### 4. Cancellation / Recovery

The protocol also supports claim disablement and canceled-fund withdrawal flows. This allows a signer or withdrawal wallet to manage exceptions and reclaim canceled allocations according to the batch state.

## Implementation Notes

`MerkleBatchPayout` implements the protocol with:

- OpenZeppelin `MerkleProof` for leaf verification
- `ReentrancyGuard` on external state-changing functions
- per-batch funding and claim tracking
- leaf-based claim status storage
- signer-authorized batch creation
- optional withdrawal wallet support
- batch statistics and cancellation tracking

The payment leaf is built from:

```solidity
keccak256(
    abi.encodePacked(
        batch.batchHash,
        payment.receiver,
        payment.amount,
        payment.claimDate,
        payment.memo
    )
)
```

This ties every payment proof to the protocol-generated batch hash and prevents reuse across unrelated batches.

## Protocol Use Cases

- payroll runs with recipient-specific claim dates
- marketplace or affiliate payout batches
- treasury disbursements
- recurring claims funded up front
- scheduled token distributions with independent recipient claiming

## Relationship To The Swap Router

The batch payment protocol can operate as a standalone scheduled payout system, but it is also designed to interoperate with Pvium's swap router. `UniversalDexRouter` can be configured to work with approved `MerkleBatchPayout` contracts for batch funding and payout-related routing flows.

## References

- [contracts/MerkleBatchPayout.sol](./contracts/MerkleBatchPayout.sol)
- [contracts/interfaces/IMerkleBatchPayout.sol](./contracts/interfaces/IMerkleBatchPayout.sol)
- [MERKLE_BATCH_PAYOUT.md](./MERKLE_BATCH_PAYOUT.md) for a more implementation-focused guide
