# MerkleBatchPayout Deployment Guide

## Overview

The MerkleBatchPayout contract enables gasless, scalable batch payments using Merkle proofs. Recipients can claim their payments by providing a valid Merkle proof, eliminating the need for the payer to execute individual transactions.

## Prerequisites

- Node.js and Yarn installed
- Hardhat configured
- Private key with sufficient funds for deployment
- Network RPC URL configured in `hardhat.config.ts`

## Deployment

### 1. Deploy MerkleBatchPayout Contract

```bash
# Deploy to local hardhat network (for testing)
npx hardhat run scripts/deployMerkleBatchPayout.ts --network hardhat

# Deploy to Base Sepolia (testnet)
npx hardhat run scripts/deployMerkleBatchPayout.ts --network basetest

# Deploy to Base Mainnet
npx hardhat run scripts/deployMerkleBatchPayout.ts --network base

# Deploy to BSC Mainnet
npx hardhat run scripts/deployMerkleBatchPayout.ts --network bsc

# Deploy to Ethereum Mainnet
npx hardhat run scripts/deployMerkleBatchPayout.ts --network mainnet

# Deploy to Polygon Mainnet
npx hardhat run scripts/deployMerkleBatchPayout.ts --network polygon
```

### 2. Save the Deployed Address

After deployment, save the contract address from the output:

```
MERKLE_BATCH_PAYOUT_ADDRESS=0x...
```

### 3. Verify Contract on Block Explorer

Use the verification command provided in the deployment output:

```bash
npx hardhat verify --network <network-name> <CONTRACT_ADDRESS> "<ROUTER_ADDRESS>" "<WETH_ADDRESS>" "<DEPLOYER_ADDRESS>" "<DEPLOYER_ADDRESS>"
```

Example for Base Sepolia:
```bash
npx hardhat verify --network basetest 0x5FbDB2315678afecb367f032d93F642f64180aa3 "0x1689E7B1F10000AE47eBfE339a4f69dECd19F602" "0x4200000000000000000000000000000000000006" "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"
```

## Integration with UniversalDexRouter

After deploying MerkleBatchPayout, you need to register it with the UniversalDexRouter to enable swap-to-fund functionality.

### Option 1: Register During UniversalDexRouter Deployment (Recommended)

If you haven't deployed UniversalDexRouter yet, you can register MerkleBatchPayout automatically during deployment:

```bash
# Set the MerkleBatchPayout address as an environment variable
export MERKLE_BATCH_PAYOUT_ADDRESS=0x...

# Deploy UniversalDexRouter (will automatically register MerkleBatchPayout)
npx hardhat run scripts/deployUniversalDexRouter.ts --network <network-name>
```

The UniversalDexRouter constructor now accepts an optional 6th parameter for the MerkleBatchPayout contract address. If provided (not address(0)), it will automatically register the contract during deployment.

### Option 2: Register After Deployment

If UniversalDexRouter is already deployed, you can add MerkleBatchPayout using the provided script:

```bash
export UNIVERSAL_DEX_ROUTER_ADDRESS=0x...
export MERKLE_BATCH_PAYOUT_ADDRESS=0x...

npx hardhat run scripts/addMerkleBatchPayoutSupport.ts --network <network-name>
```

Or manually using Hardhat console:

```bash
npx hardhat console --network <network-name>
```

```javascript
const router = await ethers.getContractAt("UniversalDexRouter", "0x...");
await router.setSupportedMerkleBatchPayoutContract("0x...", true);
```

## Usage

### Creating a Batch Payment

See `scripts/createAndClaimBatch.ts` for a complete example. Here's a quick overview:

```typescript
import { generateBatchData, PaymentEntry } from "./scripts/merkleHelper";

// 1. Define payments
const payments: PaymentEntry[] = [
  {
    receiverAddress: "0x...",
    amount: ethers.parseEther("100").toString(),
    claimableDate: Math.floor(Date.now() / 1000) + 86400, // 1 day from now
    memo: "Payment 1"
  },
  {
    receiverAddress: "0x...",
    amount: ethers.parseEther("50").toString(),
    claimableDate: Math.floor(Date.now() / 1000) + 86400,
    memo: "Payment 2"
  }
];

// 2. Generate batch data
const signer = await ethers.getSigner();
const timestamp = Math.floor(Date.now() / 1000);
const chainId = (await ethers.provider.getNetwork()).chainId;

const batchData = await generateBatchData(
  payments,
  "unique-salt-123", // Unique salt for this batch
  signer,
  FUNDING_TOKEN_ADDRESS,
  timestamp,
  Number(chainId)
);

// 3. Create batch via UniversalDexRouter (with swap funding)
const router = await ethers.getContractAt("UniversalDexRouter", ROUTER_ADDRESS);
const totalAmount = ethers.parseEther("150");

await router.createMerkleBatch(
  MERKLE_BATCH_PAYOUT_ADDRESS,
  [{
    amountIn: ethers.parseEther("160"),
    amountOut: totalAmount,
    path: [TOKEN_IN_ADDRESS, FUNDING_TOKEN_ADDRESS]
  }],
  batchData.batchHash,
  timestamp,
  batchData.signerAddress,
  batchData.merkleRoot,
  Math.floor(Date.now() / 1000) + 86400 * 30, // 30 days for creator withdrawal
  FUNDING_TOKEN_ADDRESS,
  batchData.signature,
  totalAmount
);
```

### Claiming a Payment

```typescript
import { getPaymentProof } from "./scripts/merkleHelper";

// Get proof for specific payment
const proof = getPaymentProof(batchData.tree, batchData.batchId, payments[0]);

// Claim via UniversalDexRouter
await router.connect(receiver).claimMerkleBatchPayment(
  MERKLE_BATCH_PAYOUT_ADDRESS,
  batchData.batchId,
  payments[0].receiverAddress,
  payments[0].amount,
  payments[0].claimableDate,
  payments[0].memo,
  proof
);
```

## Supported Networks

The deployment script includes pre-configured settings for:

- **Base Sepolia** (Chain ID: 84532) - Testnet
- **Base Mainnet** (Chain ID: 8453)
- **BSC Mainnet** (Chain ID: 56)
- **Ethereum Mainnet** (Chain ID: 1)
- **Polygon Mainnet** (Chain ID: 137)

## Security Considerations

1. **Role Management**: The deployer receives both DEFAULT_ADMIN_ROLE and ADMIN_ROLE. Consider transferring these to a multisig wallet for production.

2. **Batch Creator Withdrawal**: Batch creators can withdraw unclaimed funds after `creatorWithdrawDate`. Set this appropriately based on your use case.

3. **Merkle Proof Security**: The batchId includes the chainId to prevent cross-chain replay attacks.

4. **Signature Verification**: All batches require valid signatures from the batch creator to prevent unauthorized batch creation.

## Troubleshooting

### Deployment Fails

- **Insufficient Balance**: Ensure the deployer account has enough native currency for gas fees
- **Invalid Router/WETH**: Verify the router and WETH addresses for your network
- **Network Configuration**: Check `hardhat.config.ts` has the correct network configuration

### Adding to UniversalDexRouter Fails

- **Not Admin**: Ensure you're using the admin account (deployer by default)
- **Wrong Network**: Verify you're on the same network where both contracts are deployed
- **Contract Not Deployed**: Confirm both contracts are deployed and addresses are correct

## Additional Resources

- [Merkle Helper Documentation](./scripts/merkleHelper.ts)
- [Example Usage Script](./scripts/createAndClaimBatch.ts)
- [Contract Documentation](./MERKLE_BATCH_PAYOUT.md)
- [Test Suite](./test/UniversalDexRouter.test.ts)
