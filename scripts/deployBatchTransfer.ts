import { ethers } from "hardhat";

/**
 * Deployment Script for BatchTransfer Contract
 *
 * This contract enables secure, atomic batch transfers of ERC20 tokens
 * without the security vulnerabilities of using Multicall3 with approvals.
 *
 * Features:
 * - Transfers from msg.sender (caller's wallet)
 * - Atomic batch processing (all or nothing)
 * - No ownership - permissionless and secure by design
 * - Caller approves contract to spend their own tokens
 * - No funds held in contract
 *
 * Usage:
 * npx hardhat run scripts/deployBatchTransfer.ts --network <network-name>
 *
 * Example:
 * npx hardhat run scripts/deployBatchTransfer.ts --network base-testnet
 * npx hardhat run scripts/deployBatchTransfer.ts --network base
 */

async function main() {
    console.log("=== BatchTransfer Contract Deployment ===\n");

    // Get deployer account
    const [deployer] = await ethers.getSigners();
    console.log("Deploying contract with account:", deployer.address);
    console.log("Account balance:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "ETH\n");

    // Get network info
    const network = await ethers.provider.getNetwork();
    const chainId = Number(network.chainId);

    console.log("--- Network Information ---");
    console.log("Network:", network.name);
    console.log("Chain ID:", chainId);
    console.log("Deployer:", deployer.address);
    console.log();

    // Deploy BatchTransfer contract
    console.log("--- Deploying BatchTransfer Contract ---");
    const BatchTransfer = await ethers.getContractFactory("BatchTransfer");
    const batchTransfer = await BatchTransfer.deploy();
    await batchTransfer.waitForDeployment();
    const contractAddress = await batchTransfer.getAddress();

    console.log("✅ BatchTransfer deployed to:", contractAddress);
    console.log();

    // Output summary
    console.log("=== Deployment Summary ===");
    console.log("BatchTransfer Contract:", contractAddress);
    console.log("Deployer:", deployer.address);
    console.log();

    console.log("=== Next Steps ===");
    console.log("1. Add contract address to your .env file:");
    console.log(`   BATCH_TRANSFER_CONTRACT=${contractAddress}`);
   

    // Generate deployment config file
    const deploymentInfo = {
        network: network.name,
        chainId: chainId.toString(),
        timestamp: new Date().toISOString(),
        deployer: deployer.address,
        contract: {
            BatchTransfer: contractAddress
        },
        security: {
            transfersFrom: "msg.sender (caller)",
            ownership: "None - permissionless",
            approval: "Caller approves for their own tokens only"
        },
        instructions: {
            step1: "Add BATCH_TRANSFER_CONTRACT to .env",
            step2: "Fund REWARD_PAYOUT_WALLET with USDC",
            step3: "Worker service handles approval automatically",
            step4: "Test with small batch before production use"
        }
    };

    console.log("=== Deployment Info (JSON) ===");
    console.log(JSON.stringify(deploymentInfo, null, 2));
    console.log();

    console.log("⚠️  IMPORTANT SECURITY NOTES:");
    console.log("- Contract transfers from msg.sender (your wallet)");
    console.log("- No ownership - anyone can call, but only moves their own tokens");
    console.log("- Secure by design - impossible to drain other users' tokens");
    console.log("- Keep your REWARD_PAYOUT_WALLET private key secure");
    console.log("- Test on testnet before mainnet deployment");
}

// Execute deployment
main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error("Deployment failed:");
        console.error(error);
        process.exit(1);
    });
