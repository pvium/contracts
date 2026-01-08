import { ethers } from "hardhat";

//0x1b36D86396510Ba0C5732B7E81dC5A4233727a3a
async function main() {
  const [deployer] = await ethers.getSigners();

  console.log("╔════════════════════════════════════════════════════════════════╗");
  console.log("║              TokenRelay Deployment Script                     ║");
  console.log("╚════════════════════════════════════════════════════════════════╝");
  console.log();
  console.log("Deploying contracts with account:", deployer.address);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("Account balance:", ethers.formatEther(balance), "ETH");
  console.log();

  // Get network info
  const network = await ethers.provider.getNetwork();
  console.log("Network:", network.name);
  console.log("Chain ID:", network.chainId.toString());
  console.log();

  // Deployment parameters
  const FEE_PERCENTAGE = 100;                          // 1% fee
  const MAX_FEE_PERCENTAGE = 1000;                     // 10% max fee
  const MINIMUM_AMOUNT = ethers.parseUnits("1", 18);  // 1 token minimum
  const DOMAIN_NAME = "TokenRelay";
  const DOMAIN_VERSION = "1";

  console.log("Deployment Parameters:");
  console.log("├─ Fee Percentage:", FEE_PERCENTAGE, "basis points (1%)");
  console.log("├─ Max Fee Percentage:", MAX_FEE_PERCENTAGE, "basis points (10%)");
  console.log("├─ Minimum Amount:", ethers.formatEther(MINIMUM_AMOUNT), "tokens");
  console.log("├─ EIP-712 Domain Name:", DOMAIN_NAME);
  console.log("└─ EIP-712 Domain Version:", DOMAIN_VERSION);
  console.log();

  // Deploy TokenRelay
  console.log("Deploying TokenRelay contract...");
  const TokenRelay = await ethers.getContractFactory("TokenRelay");
  const relay = await TokenRelay.deploy(
    FEE_PERCENTAGE,
    MAX_FEE_PERCENTAGE,
    MINIMUM_AMOUNT,
    DOMAIN_NAME,
    DOMAIN_VERSION
  );

  await relay.waitForDeployment();
  const relayAddress = await relay.getAddress();

  console.log();
  console.log("╔════════════════════════════════════════════════════════════════╗");
  console.log("║                  Deployment Successful!                       ║");
  console.log("╚════════════════════════════════════════════════════════════════╝");
  console.log();
  console.log("TokenRelay deployed to:", relayAddress);
  console.log();

  // Get role information
  const DEFAULT_ADMIN_ROLE = await relay.DEFAULT_ADMIN_ROLE();
  const ADMIN_ROLE = await relay.ADMIN_ROLE();
  const DAO_ROLE = await relay.DAO_ROLE();

  console.log("Role Assignments:");
  console.log("├─ DEFAULT_ADMIN_ROLE:", DEFAULT_ADMIN_ROLE);
  console.log("│  └─ Granted to:", deployer.address);
  console.log("├─ ADMIN_ROLE:", ADMIN_ROLE);
  console.log("│  └─ Granted to:", deployer.address);
  console.log("└─ DAO_ROLE:", DAO_ROLE);
  console.log("   └─ Granted to:", deployer.address);
  console.log();

  console.log("Next Steps:");
  console.log("1. Verify the contract:");
  console.log(`   npx hardhat verify --network ${network.name} ${relayAddress} ${FEE_PERCENTAGE} ${MAX_FEE_PERCENTAGE} "${MINIMUM_AMOUNT.toString()}" "${DOMAIN_NAME}" "${DOMAIN_VERSION}"`);
  console.log();
  console.log("2. Add supported tokens:");
  console.log("   await relay.addSupportedToken(tokenAddress)");
  console.log();
  console.log("3. Grant roles to appropriate addresses:");
  console.log("   await relay.grantRole(ADMIN_ROLE, adminAddress)");
  console.log("   await relay.grantRole(DAO_ROLE, daoAddress)");
  console.log();
  console.log("4. (Optional) Revoke deployer roles for decentralization:");
  console.log("   await relay.revokeRole(ADMIN_ROLE, deployerAddress)");
  console.log("   await relay.revokeRole(DAO_ROLE, deployerAddress)");
  console.log();

  // Save deployment info
  const deploymentInfo = {
    network: network.name,
    chainId: network.chainId.toString(),
    contract: "TokenRelay",
    address: relayAddress,
    deployer: deployer.address,
    timestamp: new Date().toISOString(),
    parameters: {
      feePercentage: FEE_PERCENTAGE,
      maxFeePercentage: MAX_FEE_PERCENTAGE,
      minimumAmount: MINIMUM_AMOUNT.toString(),
      domainName: DOMAIN_NAME,
      domainVersion: DOMAIN_VERSION
    }
  };

  console.log("Deployment Info (save this):");
  console.log(JSON.stringify(deploymentInfo, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
