import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();
  const balance = await ethers.provider.getBalance(deployer.address);

  console.log("╔════════════════════════════════════════════════════════════════╗");
  console.log("║             MultiSigFactory Deployment Script                ║");
  console.log("╚════════════════════════════════════════════════════════════════╝");
  console.log();
  console.log("Deploying with account:", deployer.address);
  console.log("Account balance:", ethers.formatEther(balance), "ETH");
  console.log("Network:", network.name);
  console.log("Chain ID:", network.chainId.toString());
  console.log();

  console.log("Deploying MultiSigFactory contract...");
  const MultiSigFactory = await ethers.getContractFactory("MultiSigFactory");
  const factory = await MultiSigFactory.deploy();
  await factory.waitForDeployment();

  const factoryAddress = await factory.getAddress();

  console.log();
  console.log("╔════════════════════════════════════════════════════════════════╗");
  console.log("║                  Deployment Successful!                       ║");
  console.log("╚════════════════════════════════════════════════════════════════╝");
  console.log();
  console.log("MultiSigFactory deployed to:", factoryAddress);
  console.log();
  console.log("Next Steps:");
  console.log("1. Create a wallet through the factory:");
  console.log(
    `   await factory.createWallet([owner1, owner2, owner3], 2)`
  );
  console.log();
  console.log("2. Verify the factory if needed:");
  console.log(
    `   npx hardhat verify --network ${network.name} ${factoryAddress}`
  );
  console.log();

  const deploymentInfo = {
    network: network.name,
    chainId: network.chainId.toString(),
    contract: "MultiSigFactory",
    address: factoryAddress,
    deployer: deployer.address,
    timestamp: new Date().toISOString(),
  };

  console.log("Deployment Info:");
  console.log(JSON.stringify(deploymentInfo, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });