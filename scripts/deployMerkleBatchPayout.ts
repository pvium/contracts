import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();

  console.log("╔════════════════════════════════════════════════════════════════╗");
  console.log("║           Deploying MerkleBatchPayout Contract               ║");
  console.log("╚════════════════════════════════════════════════════════════════╝");
  console.log();

  // Get network info
  const network = await ethers.provider.getNetwork();
  console.log("Network:", network.name);
  console.log("Chain ID:", network.chainId.toString());
  console.log("Deployer:", deployer.address);
  console.log();

  // Check balance
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("Deployer Balance:", ethers.formatEther(balance), "ETH");
  console.log();

  console.log("Constructor Parameters:");
  console.log("└─ No constructor parameters needed");
  console.log();

  // Deploy MerkleBatchPayout
  console.log("Deploying MerkleBatchPayout...");
  const MerkleBatchPayout = await ethers.getContractFactory("MerkleBatchPayout");

  const merkleBatchPayout = await MerkleBatchPayout.deploy();

  await merkleBatchPayout.waitForDeployment();
  const contractAddress = await merkleBatchPayout.getAddress();

  console.log("✓ MerkleBatchPayout deployed to:", contractAddress);
  console.log();

  // Verify deployment
  console.log("Verifying deployment...");
  console.log("Deployed Contract State:");
  console.log("└─ Contract Address:", contractAddress);
  console.log();

  console.log("╔════════════════════════════════════════════════════════════════╗");
  console.log("║                   Deployment Successful!                      ║");
  console.log("╚════════════════════════════════════════════════════════════════╝");
  console.log();

  console.log("Contract Address:", contractAddress);
  console.log();

  // Network-specific explorer URLs
  const explorerUrls: Record<number, { name: string; url: string }> = {
    84532: { name: "BaseScan (Sepolia)", url: `https://sepolia.basescan.org/address/${contractAddress}` },
    8453: { name: "BaseScan", url: `https://basescan.org/address/${contractAddress}` },
    56: { name: "BscScan", url: `https://bscscan.com/address/${contractAddress}` },
    1: { name: "Etherscan", url: `https://etherscan.io/address/${contractAddress}` },
    137: { name: "PolygonScan", url: `https://polygonscan.com/address/${contractAddress}` }
  };

  const explorer = explorerUrls[Number(network.chainId)];
  if (explorer) {
    console.log(`View on ${explorer.name}:`);
    console.log(explorer.url);
    console.log();
  }

  console.log("To verify on block explorer, run:");
  console.log(`npx hardhat verify --network <network-name> ${contractAddress}`);
  console.log();

  console.log("Save this information:");
  console.log("MERKLE_BATCH_PAYOUT_ADDRESS=" + contractAddress);
  console.log();

  console.log("Next steps:");
  console.log("1. Add this contract to UniversalDexRouter's supported contracts:");
  console.log(`   await universalDexRouter.setSupportedMerkleBatchPayoutContract("${contractAddress}", true)`);
  console.log();
  console.log("2. Create and fund batches using the merkleHelper utility");
  console.log("   See: scripts/createAndClaimBatch.ts for example usage");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
