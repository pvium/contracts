import { ethers } from "hardhat";

async function main() {
  const [admin] = await ethers.getSigners();

  console.log("╔════════════════════════════════════════════════════════════════╗");
  console.log("║    Adding MerkleBatchPayout to UniversalDexRouter Support    ║");
  console.log("╚════════════════════════════════════════════════════════════════╝");
  console.log();

  // Get network info
  const network = await ethers.provider.getNetwork();
  console.log("Network:", network.name);
  console.log("Chain ID:", network.chainId.toString());
  console.log("Admin:", admin.address);
  console.log();

  // Check balance
  const balance = await ethers.provider.getBalance(admin.address);
  console.log("Admin Balance:", ethers.formatEther(balance), "ETH");
  console.log();

  // ============================================================
  // CONFIGURATION - Update these addresses for your deployment
  // ============================================================

  const UNIVERSAL_DEX_ROUTER_ADDRESS = process.env.UNIVERSAL_DEX_ROUTER_ADDRESS || "";
  const MERKLE_BATCH_PAYOUT_ADDRESS = process.env.MERKLE_BATCH_PAYOUT_ADDRESS || "";

  if (!UNIVERSAL_DEX_ROUTER_ADDRESS || !MERKLE_BATCH_PAYOUT_ADDRESS) {
    console.error("❌ Error: Missing contract addresses");
    console.log();
    console.log("Please set environment variables:");
    console.log("  export UNIVERSAL_DEX_ROUTER_ADDRESS=0x...");
    console.log("  export MERKLE_BATCH_PAYOUT_ADDRESS=0x...");
    console.log();
    console.log("Or edit this script to hardcode the addresses");
    process.exit(1);
  }

  console.log("Contract Addresses:");
  console.log("├─ UniversalDexRouter:", UNIVERSAL_DEX_ROUTER_ADDRESS);
  console.log("└─ MerkleBatchPayout:", MERKLE_BATCH_PAYOUT_ADDRESS);
  console.log();

  // Get UniversalDexRouter contract
  console.log("Connecting to UniversalDexRouter...");
  const router = await ethers.getContractAt("UniversalDexRouter", UNIVERSAL_DEX_ROUTER_ADDRESS);

  // Verify admin has ADMIN_ROLE
  const ADMIN_ROLE = await router.ADMIN_ROLE();
  const hasAdminRole = await router.hasRole(ADMIN_ROLE, admin.address);

  if (!hasAdminRole) {
    console.error("❌ Error: Current account does not have ADMIN_ROLE");
    console.log("Admin address:", admin.address);
    console.log("Required role:", ADMIN_ROLE);
    process.exit(1);
  }

  console.log("✓ Admin role verified");
  console.log();

  // Check if already supported
  const isCurrentlySupported = await router.supportMerkleBatchPayoutContracts(MERKLE_BATCH_PAYOUT_ADDRESS);

  if (isCurrentlySupported) {
    console.log("ℹ MerkleBatchPayout is already supported");
    console.log();

    console.log("Do you want to remove support? (y/n)");
    // For automation, we'll just continue without prompting
    console.log("Skipping... (modify script to remove if needed)");
    console.log();
  } else {
    console.log("Adding MerkleBatchPayout to supported contracts...");

    const tx = await router.connect(admin).setSupportedMerkleBatchPayoutContract(
      MERKLE_BATCH_PAYOUT_ADDRESS,
      true
    );

    console.log("Transaction hash:", tx.hash);
    console.log("Waiting for confirmation...");

    await tx.wait();

    console.log("✓ Transaction confirmed");
    console.log();

    // Verify the change
    const isNowSupported = await router.supportMerkleBatchPayoutContracts(MERKLE_BATCH_PAYOUT_ADDRESS);

    if (isNowSupported) {
      console.log("╔════════════════════════════════════════════════════════════════╗");
      console.log("║                  Successfully Added Support!                  ║");
      console.log("╚════════════════════════════════════════════════════════════════╝");
      console.log();

      console.log("MerkleBatchPayout is now supported by UniversalDexRouter");
      console.log();
      console.log("You can now:");
      console.log("1. Create batches via UniversalDexRouter.createMerkleBatch()");
      console.log("2. Claim payments via UniversalDexRouter.claimMerkleBatchPayment()");
      console.log("3. Add funds via UniversalDexRouter.addFundsToMerkleBatch()");
    } else {
      console.error("❌ Error: Failed to add support");
      console.log("Please check the transaction and try again");
      process.exit(1);
    }
  }

  console.log();
  console.log("Next steps:");
  console.log("1. See scripts/createAndClaimBatch.ts for usage examples");
  console.log("2. See scripts/merkleHelper.ts for batch data generation");
  console.log("3. Read MERKLE_BATCH_PAYOUT_DEPLOYMENT.md for full documentation");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
