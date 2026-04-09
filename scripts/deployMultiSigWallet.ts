import { ethers } from "hardhat";

function parseOwners(rawOwners: string | undefined): string[] {
  if (!rawOwners) {
    return [];
  }

  return rawOwners
    .split(",")
    .map((owner) => owner.trim())
    .filter((owner) => owner.length > 0);
}

async function resolveOwners(): Promise<string[]> {
  const envOwners = parseOwners(process.env.MULTISIG_OWNERS);
  if (envOwners.length > 0) {
    return envOwners;
  }

  const network = await ethers.provider.getNetwork();
  if (network.name === "hardhat" || network.name === "localhost") {
    const signers = await ethers.getSigners();
    return signers.slice(0, 3).map((signer) => signer.address);
  }

  throw new Error(
    "Set MULTISIG_OWNERS as a comma-separated list of owner addresses"
  );
}

function resolveRequired(ownerCount: number): number {
  const rawRequired = process.env.MULTISIG_REQUIRED;
  if (!rawRequired) {
    return Math.min(2, ownerCount);
  }

  const required = Number(rawRequired);
  if (!Number.isInteger(required)) {
    throw new Error("MULTISIG_REQUIRED must be an integer");
  }

  return required;
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();
  const balance = await ethers.provider.getBalance(deployer.address);
  const owners = await resolveOwners();
  const required = resolveRequired(owners.length);

  if (owners.length === 0) {
    throw new Error("At least one owner is required");
  }

  if (required <= 0 || required > owners.length) {
    throw new Error(
      "MULTISIG_REQUIRED must be greater than 0 and less than or equal to the owner count"
    );
  }

  console.log("╔════════════════════════════════════════════════════════════════╗");
  console.log("║              MultiSigWallet Deployment Script                ║");
  console.log("╚════════════════════════════════════════════════════════════════╝");
  console.log();
  console.log("Deploying with account:", deployer.address);
  console.log("Account balance:", ethers.formatEther(balance), "ETH");
  console.log("Network:", network.name);
  console.log("Chain ID:", network.chainId.toString());
  console.log();

  console.log("Constructor Parameters:");
  owners.forEach((owner, index) => {
    console.log(`├─ Owner ${index + 1}:`, owner);
  });
  console.log("└─ Required Confirmations:", required);
  console.log();

  console.log("Deploying MultiSigWallet contract...");
  const MultiSigWallet = await ethers.getContractFactory("MultiSigWallet");
  const wallet = await MultiSigWallet.deploy(owners, required);
  await wallet.waitForDeployment();

  const walletAddress = await wallet.getAddress();

  console.log();
  console.log("╔════════════════════════════════════════════════════════════════╗");
  console.log("║                  Deployment Successful!                       ║");
  console.log("╚════════════════════════════════════════════════════════════════╝");
  console.log();
  console.log("MultiSigWallet deployed to:", walletAddress);
  console.log();
  console.log("Verification command:");
  console.log(
    `npx hardhat verify --network ${network.name} ${walletAddress} '[\"${owners.join(
      '\",\"'
    )}\"]' ${required}`
  );
  console.log();

  const deploymentInfo = {
    network: network.name,
    chainId: network.chainId.toString(),
    contract: "MultiSigWallet",
    address: walletAddress,
    deployer: deployer.address,
    timestamp: new Date().toISOString(),
    parameters: {
      owners,
      required,
    },
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