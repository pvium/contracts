# Merkle Batch Payout Contract

A smart contract system for creating and claiming batch payouts using Merkle proofs, with integrated DEX swap functionality for batch funding.

## Overview

The `MerkleBatchPayout` contract allows you to:

1. **Create batches** of payments secured by Merkle trees
2. **Fund batches** automatically via DEX swaps (Uniswap V2/V3, PancakeSwap)
3. **Claim payments** using Merkle proofs after a specified date
4. **Track funding** per batch with efficient storage

## Architecture Decision: Single Contract vs Contract-per-Batch

We chose a **single contract with per-batch funding tracking** because:

- ✅ Lower gas costs (deploy once vs per batch)
- ✅ Easier contract management and upgrades
- ✅ Minimal storage overhead (one uint256 per batch)
- ✅ Ability to reuse liquidity across batches
- ❌ Slightly more complex state management

Alternative (Contract-per-Batch) would have:
- ❌ Higher deployment gas costs
- ✅ Cleaner separation of concerns
- ✅ No cross-batch state to manage

## Key Features

### 1. Merkle Proof System
- Each payment is a leaf in a Merkle tree
- Leaf hash: `keccak256(batchId, receiverAddress, amount, claimableDate, memo)`
- **batchId is included in leaf hash to prevent cross-batch proof reuse**
- Only valid proofs can claim payments
- Prevents double-claiming
- All payments in a batch use the same output token (enforced at batch creation)

### 2. Batch Creation with Signature Verification
- Batch creator must sign: `keccak256(batchHash, merkleRoot, contractAddress, chainId)`
- BatchId = `keccak256(signerAddress, batchHash)`
- Prevents unauthorized batch creation
- Chain-specific signatures prevent replay attacks

### 3. Swap-to-Fund Mechanism
- Automatically swaps input tokens to funding token
- Supports multiple swaps in a single batch creation
- All swaps must output to the same token
- Refunds unused input tokens

### 4. Time-Locked Claims with Creator Withdrawal
- Each payment has a `claimableDate` (when it becomes claimable)
- Batch has a `creatorWithdrawDate` (when creator can withdraw remaining funds)
- Payments can be claimed anytime after their `claimableDate` (no expiration)
- After `creatorWithdrawDate`, batch creator can withdraw remaining funds
- **Important**: Claims are NOT blocked after `creatorWithdrawDate` - recipients can still claim if funds remain
- Useful for vesting, scheduled payouts, and giving creators the option to reclaim unclaimed funds

## Contract Interface

### Core Functions

#### `createBatch`
```solidity
function createBatch(
    bytes32 batchHash,
    BatchPaySummary[] calldata payoutSummary,
    bytes calldata batchSignature,
    address signer,
    uint256 deadline,
    bytes32 merkleRoot,
    uint256 creatorWithdrawDate
) external payable
```

Creates a new batch with swap funding.

**Parameters:**
- `batchHash`: Hash of batch data for verification
- `payoutSummary`: Array of swap configurations (all must output to same token)
- `batchSignature`: Signature from the batch signer
- `signer`: Address of the authorized signer
- `deadline`: Deadline for swap operations
- `merkleRoot`: Merkle root of all payments
- `creatorWithdrawDate`: After this date, creator can withdraw remaining funds (does not block claims)

**Example:**
```typescript
const batchPaySummary = [
  {
    amountIn: ethers.parseEther("10"),
    amountOut: ethers.parseEther("4.5"),
    path: [WETH, USDC],
  },
];

await merkleBatchPayout.createBatch(
  batchHash,
  batchPaySummary,
  signature,
  signerAddress,
  deadline,
  merkleRoot,
  creatorWithdrawDate, // Unix timestamp
  { value: ethers.parseEther("10") }
);
```

#### `claimPayment`
```solidity
function claimPayment(
    bytes32 batchId,
    address receiverAddress,
    uint256 amount,
    uint256 claimableDate,
    string calldata memo,
    bytes32[] calldata merkleProof
) external
```

Claims a payment from a batch using Merkle proof.

**Requirements:**
- Batch must exist
- Payment not already claimed
- Current time >= claimableDate
- Valid Merkle proof
- Sufficient batch funds

**Note**: Claims are NOT blocked after `creatorWithdrawDate` - recipients can claim anytime as long as funds remain.

**Example:**
```typescript
await merkleBatchPayout.claimPayment(
  batchId,
  receiverAddress,
  amount,
  claimableDate,
  memo,
  proof
);
```

#### `withdrawRemainingFunds`
```solidity
function withdrawRemainingFunds(bytes32 batchId) external
```

Withdraw remaining funds from a batch. Only callable by batch creator after `creatorWithdrawDate`.

**Requirements:**
- Batch must exist
- Caller must be batch creator (signer)
- Current time >= creatorWithdrawDate
- Remaining funds > 0

**Important**: This does NOT prevent future claims. Recipients can still claim after withdrawal if new funds are added.

**Example:**
```typescript
// After creatorWithdrawDate passes
await merkleBatchPayout.connect(creator).withdrawRemainingFunds(batchId);
```

#### `addFundsToBatch`
```solidity
function addFundsToBatch(bytes32 batchId, uint256 amount) external
```

Add additional funds to an existing batch (in case of underfunding).

### View Functions

#### `getBatch`
```solidity
function getBatch(bytes32 batchId) external view returns (Batch memory)
```

Returns batch information.

#### `isClaimed`
```solidity
function isClaimed(bytes32 batchId, address receiver) external view returns (bool)
```

Check if a payment has been claimed.

#### `getRemainingFunds`
```solidity
function getRemainingFunds(bytes32 batchId) external view returns (uint256)
```

Get remaining unclaimed funds in a batch.

## Usage Guide

### Step 1: Prepare Payment Data

```typescript
import { PaymentEntry } from "./merkleHelper";

const payments: PaymentEntry[] = [
  {
    receiverAddress: "0x1234...",
    amount: ethers.parseEther("100").toString(),
    claimableDate: Math.floor(Date.now() / 1000) + 86400, // 1 day
    memo: "Payment 1",
  },
  // ... more payments
];
```

### Step 2: Generate Merkle Tree and Batch Data

```typescript
import { generateBatchData } from "./merkleHelper";

const batchData = await generateBatchData(
  payments,
  "unique-salt-123", // Unique salt for this batch
  signer, // Ethers signer
  contractAddress,
  chainId
);

console.log("Batch ID:", batchData.batchId);
console.log("Merkle Root:", batchData.merkleRoot);
```

### Step 3: Create Batch with Swap Funding

```typescript
// Calculate total needed and creatorWithdrawDate
const totalPaymentsAmount = payments.reduce(
  (sum, p) => sum + BigInt(p.amount),
  0n
);
const maxClaimableDate = Math.max(...payments.map((p) => p.claimableDate));
const creatorWithdrawDate = maxClaimableDate + 86400 * 30; // 30 days after last payment

const batchPaySummary = [
  {
    amountIn: ethers.parseEther("10"), // Max input
    amountOut: totalPaymentsAmount, // Exact output needed
    path: [WETH, USDC], // Swap path (all swaps must output same token)
  },
];

const tx = await merkleBatchPayout.createBatch(
  batchData.batchHash,
  batchPaySummary,
  batchData.signature,
  batchData.signerAddress,
  Math.floor(Date.now() / 1000) + 300, // 5 min swap deadline
  batchData.merkleRoot,
  creatorWithdrawDate, // When creator can withdraw remaining funds
  { value: ethers.parseEther("10") } // Send ETH for swap
);

await tx.wait();
```

### Step 4: Recipients Claim Payments

```typescript
import { getPaymentProof } from "./merkleHelper";

// Get proof for a specific payment (batchId is required)
const proof = getPaymentProof(batchData.tree, batchData.batchId, payments[0]);

// Claim the payment (must be after claimableDate, no expiration)
await merkleBatchPayout.connect(receiver).claimPayment(
  batchData.batchId,
  payments[0].receiverAddress,
  payments[0].amount,
  payments[0].claimableDate,
  payments[0].memo,
  proof
);
```

### Step 5: Creator Withdraws Remaining Funds (Optional)

```typescript
// After creatorWithdrawDate, creator can withdraw remaining funds
// Note: Recipients can still claim after this if funds remain
await merkleBatchPayout.connect(creator).withdrawRemainingFunds(batchData.batchId);
```

## Helper Scripts

### `merkleHelper.ts`

Provides utilities for working with Merkle trees:

- `generateLeafHash(batchId, entry)`: Generate leaf hash from payment data (includes batchId)
- `generateMerkleTree(batchId, payments)`: Create Merkle tree from payments
- `getMerkleRoot(tree)`: Get the root hash
- `getMerkleProof(tree, batchId, payment)`: Get proof for a specific payment
- `verifyMerkleProof(proof, root, batchId, payment)`: Verify a proof locally
- `generateBatchData()`: Generate complete batch data including batchId, merkle tree, and signature

**Important**: The batchId must be known before generating the Merkle tree, as it's included in each leaf hash. The `generateBatchData()` function handles this automatically by calculating the batchId first.

### `createAndClaimBatch.ts`

Example script demonstrating the complete workflow.

## Security Considerations

1. **Signature Verification**: All batches must be signed by an authorized signer
2. **Chain-Specific**: Signatures include chainId to prevent cross-chain replay
3. **Cross-Batch Protection**: batchId is included in leaf hash to prevent proof reuse across batches
4. **Double-Claim Protection**: Each payment can only be claimed once
5. **Time Locks**: Payments cannot be claimed before claimableDate (no expiration)
6. **Merkle Proofs**: Only valid proofs can claim payments
7. **ReentrancyGuard**: Protects against reentrancy attacks
8. **Access Control**: Admin functions protected by OpenZeppelin AccessControl
9. **Non-Blocking Withdrawals**: Creator withdrawals don't prevent future claims

## Gas Optimization

- Uses `calldata` for function parameters where possible
- Efficient Merkle proof verification (O(log n))
- Single storage slot updates for claims
- Batch creation combines multiple operations

## Events

### `BatchCreated`
```solidity
event BatchCreated(
    bytes32 indexed batchId,
    bytes32 merkleRoot,
    address indexed signer,
    address indexed fundingToken,
    uint256 totalFunded,
    uint256 creatorWithdrawDate
)
```

### `PaymentClaimed`
```solidity
event PaymentClaimed(
    bytes32 indexed batchId,
    address indexed receiver,
    uint256 amount,
    address indexed token,
    string memo
)
```

### `BatchFunded`
```solidity
event BatchFunded(
    bytes32 indexed batchId,
    address indexed token,
    uint256 amount
)
```

### `BatchWithdrawn`
```solidity
event BatchWithdrawn(
    bytes32 indexed batchId,
    address indexed signer,
    uint256 amount
)
```

Emitted when batch creator withdraws remaining funds after `creatorWithdrawDate`.

## Example Use Cases

1. **Payroll**: Time-locked salary payments to multiple employees
2. **Vesting**: Token vesting schedules with milestone-based unlocks
3. **Airdrops**: Efficient distribution with claim-based model
4. **Freelancer Payments**: Batch payments with invoice memos
5. **DAO Grants**: Scheduled grant distributions with governance approval

## Testing

Run the example script:

```bash
npx hardhat run scripts/createAndClaimBatch.ts --network localhost
```

## Deployment

1. Deploy the contract with your router and WETH addresses:

```typescript
const merkleBatchPayout = await MerkleBatchPayout.deploy(
  UNISWAP_ROUTER,
  WETH,
  defaultAdmin,
  admin
);
```

2. Grant roles as needed:

```typescript
await merkleBatchPayout.grantRole(ADMIN_ROLE, adminAddress);
```

## Dependencies

- OpenZeppelin Contracts 5.x
- Hardhat
- Ethers.js v6
- merkletreejs
- keccak256

## License

MIT
