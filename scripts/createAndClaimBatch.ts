import { ethers } from "hardhat";
import {
  PaymentEntry,
  generateBatchData,
  getPaymentProof,
} from "./merkleHelper";

/**
 * Example script for creating and claiming from a Merkle batch
 */
async function main() {
  console.log("\n=== Merkle Batch Payout Example ===\n");

  // Get signers
  const [deployer, signer, receiver1, receiver2, receiver3] =
    await ethers.getSigners();

  console.log("Deployer:", deployer.address);
  console.log("Batch Signer:", signer.address);
  console.log("Receiver 1:", receiver1.address);
  console.log("Receiver 2:", receiver2.address);
  console.log("Receiver 3:", receiver3.address);

  // Deploy MerkleBatchPayout contract
  console.log("\n--- Deploying MerkleBatchPayout Contract ---");
  const MerkleBatchPayout = await ethers.getContractFactory(
    "MerkleBatchPayout"
  );

  // You'll need to replace these with actual router and WETH addresses for your network
  const UNISWAP_ROUTER = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D"; // Ethereum mainnet
  const WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2"; // Ethereum mainnet

  const merkleBatchPayout = await MerkleBatchPayout.deploy(
    UNISWAP_ROUTER,
    WETH,
    deployer.address,
    deployer.address
  );

  await merkleBatchPayout.waitForDeployment();
  const contractAddress = await merkleBatchPayout.getAddress();
  console.log("MerkleBatchPayout deployed to:", contractAddress);

  // Create payment entries
  console.log("\n--- Creating Payment Entries ---");
  const now = Math.floor(Date.now() / 1000);

  const payments: PaymentEntry[] = [
    {
      receiverAddress: receiver1.address,
      amount: ethers.parseEther("1.0").toString(),
      claimableDate: now + 60, // Claimable in 1 minute
      memo: "Payment to receiver 1",
    },
    {
      receiverAddress: receiver2.address,
      amount: ethers.parseEther("2.0").toString(),
      claimableDate: now + 120, // Claimable in 2 minutes
      memo: "Payment to receiver 2",
    },
    {
      receiverAddress: receiver3.address,
      amount: ethers.parseEther("1.5").toString(),
      claimableDate: now + 180, // Claimable in 3 minutes
      memo: "Payment to receiver 3",
    },
  ];

  console.log("Created", payments.length, "payment entries");
  payments.forEach((p, i) => {
    console.log(
      `  ${i + 1}. ${p.receiverAddress}: ${ethers.formatEther(p.amount)} ETH - ${p.memo}`
    );
  });

  // Generate batch data
  console.log("\n--- Generating Batch Data ---");
  const chainId = (await ethers.provider.getNetwork()).chainId;

  // Calculate total funding amount from all payments
  const totalFundingAmount = payments.reduce(
    (sum, payment) => sum + BigInt(payment.amount),
    0n
  );
  console.log("Total funding amount:", ethers.formatEther(totalFundingAmount), "ETH");

  const batchData = await generateBatchData(
    payments,
    "unique-batch-salt-" + Date.now(),
    signer,
    contractAddress,
    totalFundingAmount,
    Math.floor(Date.now() / 1000),
    Number(chainId)
  );

  console.log("Batch ID:", batchData.batchId);
  console.log("Merkle Root:", batchData.merkleRoot);
  console.log("Batch Hash:", batchData.batchHash);

  // Calculate creatorWithdrawDate (when creator can withdraw remaining funds)
  const maxClaimableDate = Math.max(...payments.map((p) => p.claimableDate));
  const creatorWithdrawDate = maxClaimableDate + 86400 * 30; // 30 days after last payment

  console.log("\n--- Batch Timeline ---");
  console.log(
    "Last payment claimable:",
    new Date(maxClaimableDate * 1000).toISOString()
  );
  console.log(
    "Creator can withdraw after:",
    new Date(creatorWithdrawDate * 1000).toISOString()
  );
  console.log("Note: Recipients can still claim after this date if funds remain");

  // For this example, we'll create a simple batch with direct token funding
  // instead of swaps. In production, you'd set up the swap parameters.
  console.log("\n--- Note: This is a simplified example ---");
  console.log(
    "In production, you would fund the batch via swaps using BatchPaySummary[]"
  );
  console.log(
    "For testing, you can deploy an ERC20 token and fund the batch directly"
  );

  // Example: How to call createBatch (commented out since we need actual tokens)
  /*
  const batchPaySummary = [
    {
      amountIn: ethers.parseEther("10"),
      amountOut: ethers.parseEther("4.5"), // Total for all payments
      path: [WETH, USDC_ADDRESS], // Example path
    },
  ];

  const tx = await merkleBatchPayout.createBatch(
    batchData.batchHash,
    batchPaySummary,
    batchData.signature,
    batchData.signerAddress,
    Math.floor(Date.now() / 1000) + 300, // 5 min swap deadline
    batchData.merkleRoot,
    creatorWithdrawDate, // Creator can withdraw after this date
    { value: ethers.parseEther("10") } // Send ETH for swap
  );

  await tx.wait();
  console.log("Batch created!");
  */

  // Generate proofs for each payment
  console.log("\n--- Generating Merkle Proofs ---");
  const proofs = payments.map((payment, i) => {
    const proof = getPaymentProof(batchData.tree, batchData.batchId, payment);
    console.log(`Proof for payment ${i + 1}:`, proof.length, "elements");
    return proof;
  });

  // Example: How to claim a payment (commented out)
  /*
  console.log("\n--- Claiming Payment ---");

  // Wait for claimable date
  await new Promise(resolve => setTimeout(resolve, 61000)); // Wait 61 seconds

  const claimTx = await merkleBatchPayout.connect(receiver1).claimPayment(
    batchData.batchId,
    payments[0].receiverAddress,
    payments[0].amount,
    payments[0].claimableDate,
    payments[0].memo,
    proofs[0]
  );

  await claimTx.wait();
  console.log("Payment claimed by", receiver1.address);

  // Check batch status
  const batch = await merkleBatchPayout.getBatch(batchData.batchId);
  console.log("Total funded:", ethers.formatEther(batch.totalFunded));
  console.log("Total claimed:", ethers.formatEther(batch.totalClaimed));
  console.log("Remaining:", ethers.formatEther(batch.totalFunded - batch.totalClaimed));

  // After creatorWithdrawDate passes, creator can withdraw remaining funds
  // Note: Claims can still happen after this date if funds remain
  // Wait for creatorWithdrawDate to pass (in real scenario)
  // Then:
  const withdrawTx = await merkleBatchPayout.connect(signer).withdrawRemainingFunds(
    batchData.batchId
  );
  await withdrawTx.wait();
  console.log("Remaining funds withdrawn by batch creator");
  */

  console.log("\n=== Example Complete ===\n");
  console.log("Key data to save for later claiming:");
  console.log("- Batch ID:", batchData.batchId);
  console.log("- Merkle Root:", batchData.merkleRoot);
  console.log("- Store proofs for each payment recipient\n");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
