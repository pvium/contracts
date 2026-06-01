import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();

  console.log("╔════════════════════════════════════════════════════════════════╗");
  console.log("║           Deploying EscrowBatchPayout Contract               ║");
  console.log("╚════════════════════════════════════════════════════════════════╝");
  console.log();

  const network = await ethers.provider.getNetwork();
  console.log("Network:", network.name);
  console.log("Chain ID:", network.chainId.toString());
  console.log("Deployer:", deployer.address);
  console.log();

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("Deployer Balance:", ethers.formatEther(balance), "ETH");
  console.log();

  console.log("Constructor Parameters:");
  console.log("└─ No constructor parameters needed");
  console.log();

  console.log("Deploying EscrowBatchPayout...");
  const EscrowBatchPayout = await ethers.getContractFactory("EscrowBatchPayout");
  const escrowBatchPayout = await EscrowBatchPayout.deploy();

  await escrowBatchPayout.waitForDeployment();
  const contractAddress = await escrowBatchPayout.getAddress();

  console.log("✓ EscrowBatchPayout deployed to:", contractAddress);
  console.log();

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

  const explorerUrls: Record<number, { name: string; url: string }> = {
    84532: {
      name: "BaseScan (Sepolia)",
      url: `https://sepolia.basescan.org/address/${contractAddress}`,
    },
    8453: {
      name: "BaseScan",
      url: `https://basescan.org/address/${contractAddress}`,
    },
    56: {
      name: "BscScan",
      url: `https://bscscan.com/address/${contractAddress}`,
    },
    1: {
      name: "Etherscan",
      url: `https://etherscan.io/address/${contractAddress}`,
    },
    137: {
      name: "PolygonScan",
      url: `https://polygonscan.com/address/${contractAddress}`,
    },
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
  console.log("ESCROW_BATCH_CONTRACT=" + contractAddress);
  console.log();

  console.log("Next steps:");
  console.log("1. Set ESCROW_BATCH_CONTRACT to this address before deploying UniversalDexRouter");
  console.log("2. UniversalDexRouter will register this contract in its constructor");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
