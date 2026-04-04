import { ethers } from "hardhat";
import { acceptedTokensByChain } from "./tokenConfig";

/**
 * Deployment Script for SmartEscrow System
 *
 * Deploys:
 * 1. SmartEscrowDeployer contract
 * 2. SmartEscrowFactory contract (with deployer address and accepted tokens)
 *
 * The script automatically configures commonly used stablecoins for each network:
 * - Ethereum: USDC, USDT, DAI
 * - BSC: USDC, USDT, DAI
 * - Polygon: USDC (bridged & native), USDT, DAI
 * - Base: USDC (native), DAI
 * - Arbitrum: USDC (native & bridged), USDT, DAI
 * - Optimism: USDC (native & bridged), USDT, DAI
 * - Avalanche: USDC, USDT, DAI
 *
 * For custom networks or additional tokens, modify the ACCEPTED_TOKENS array
 * in the script or add tokens after deployment using factory.setAcceptedToken().
 *
 * Usage:
 * npx hardhat run scripts/deployEscrowFactory.ts --network <network-name>
 */

const validityPeriodByChain: Record<number, number> = {
    // Local
    31337: 3000, // Local hardhat network (3000 seconds for testing)

    // Mainnets
    1: 300, // Ethereum Mainnet (5 minutes)
    56: 300, // BSC Mainnet (5 minutes)
    137: 300, // Polygon Mainnet (5 minutes)
    8453: 300, // Base Mainnet (5 minutes)
    42161: 300, // Arbitrum One (5 minutes)
    10: 300, // Optimism Mainnet (5 minutes)
    43114: 300, // Avalanche C-Chain (5 minutes)

    // Testnets
    11155111: 600, // Sepolia (10 minutes for testing)
    84532: 600, // Base Sepolia (10 minutes for testing)
    97: 600, // BSC Testnet (10 minutes for testing)
    80001: 600, // Mumbai (Polygon Testnet) (10 minutes for testing)
    421614: 600, // Arbitrum Sepolia (10 minutes for testing)
    11155420: 600, // Optimism Sepolia (10 minutes for testing)
};

// Re-export for backward compatibility
export { acceptedTokensByChain };

async function main() {
    console.log("=== SmartEscrow System Deployment ===\n");

    // Get deployer account
    const [deployer] = await ethers.getSigners();
    console.log("Deploying contracts with account:", deployer.address);
    console.log("Account balance:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "ETH\n");

    // Get chain ID
    const network = await ethers.provider.getNetwork();
    const chainId = Number(network.chainId);

    // CONFIGURATION - UPDATE THESE VALUES
    const PVIUM_FEE_BPS = 50;  // 0.5% Pvium fee
    const WITHDRAWAL_PROCESSOR_FEE_BPS = 0;  // 0% withdrawal processor fee (for testing)
    const PVIUM_ADMIN_ADDRESS = deployer.address;  // Address that can sign attestations
    const PVIUM_FEE_ADDRESS = deployer.address;    // Address that receives Pvium fees
    const VALIDITY_PERIOD = validityPeriodByChain[chainId] ?? 300; // Default to 300 seconds (5 minutes)

    // Get accepted tokens for the current network
    // If deploying to localhost/hardhat, you can override with custom addresses
    const ACCEPTED_TOKENS: string[] = acceptedTokensByChain[chainId] ?? [];

    // OPTIONAL: Override for custom tokens (uncomment and add addresses as needed)
    // const ACCEPTED_TOKENS: string[] = [
    //     "0xYourCustomTokenAddress1",
    //     "0xYourCustomTokenAddress2",
    // ];

    console.log("--- Configuration ---");
    console.log("Network:", network.name);
    console.log("Chain ID:", chainId);
    console.log("Pvium Fee:", PVIUM_FEE_BPS / 100, "%");
    console.log("Withdrawal Processor Fee:", WITHDRAWAL_PROCESSOR_FEE_BPS / 100, "%");
    console.log("Pvium Admin Address:", PVIUM_ADMIN_ADDRESS);
    console.log("Pvium Fee Address:", PVIUM_FEE_ADDRESS);
    console.log("Payload Validity Period:", VALIDITY_PERIOD, "seconds");
    console.log("\nAccepted Tokens:", ACCEPTED_TOKENS.length);
    if (ACCEPTED_TOKENS.length > 0) {
        ACCEPTED_TOKENS.forEach((token, index) => {
            console.log(`  ${index + 1}. ${token}`);
        });
    } else {
        console.log("  ⚠️  No tokens configured - you will need to add them using setAcceptedToken() after deployment");
    }
    console.log();

    // Step 1: Deploy SmartEscrowDeployer
    console.log("--- Step 1: Deploying SmartEscrowDeployer ---");
    const SmartEscrowDeployer = await ethers.getContractFactory("SmartEscrowDeployer");
    const escrowDeployer = await SmartEscrowDeployer.deploy();
    await escrowDeployer.waitForDeployment();
    const deployerAddress = await escrowDeployer.getAddress();

    console.log("✅ SmartEscrowDeployer deployed to:", deployerAddress);
    console.log();

    // Step 2: Deploy SmartEscrowFactory with deployer address
    console.log("--- Step 2: Deploying SmartEscrowFactory ---");
    const SmartEscrowFactory = await ethers.getContractFactory("SmartEscrowFactory");
    const escrowFactory = await SmartEscrowFactory.deploy(
        PVIUM_FEE_BPS,
        WITHDRAWAL_PROCESSOR_FEE_BPS,  // Add withdrawal processor fee parameter
        PVIUM_ADMIN_ADDRESS,
        PVIUM_FEE_ADDRESS,
        deployerAddress,  // Pass the deployer contract address
        VALIDITY_PERIOD,   // Pass the validity period
        ACCEPTED_TOKENS   // Pass the accepted tokens array
    );
    await escrowFactory.waitForDeployment();
    const factoryAddress = await escrowFactory.getAddress();

    console.log("✅ SmartEscrowFactory deployed to:", factoryAddress);
    console.log();

    // Step 3: Verify deployment
    console.log("--- Step 3: Verifying Deployment ---");
    const storedDeployer = await escrowFactory.deployer();
    const storedPviumFeeBps = await escrowFactory.pviumFeeBps();
    const storedPviumFeeAddress = await escrowFactory.pviumFeeAddress();

    console.log("Factory's deployer address:", storedDeployer);
    console.log("Factory's Pvium fee:", storedPviumFeeBps.toString(), "bps");
    console.log("Factory's Pvium fee address:", storedPviumFeeAddress);

    if (storedDeployer === deployerAddress) {
        console.log("✅ Deployer address correctly set in factory");
    } else {
        console.log("❌ ERROR: Deployer address mismatch!");
    }
    console.log();

    // Step 4: Output summary
    console.log("=== Deployment Summary ===");
    console.log("SmartEscrowDeployer:", deployerAddress);
    console.log("SmartEscrowFactory:", factoryAddress);
    console.log();

    console.log("=== Next Steps ===");
    console.log("1. Save these addresses for your frontend/backend");
    console.log("2. Verify contracts on block explorer:");
    console.log(`   npx hardhat verify --network <network> ${deployerAddress}`);
    console.log(`   npx hardhat verify --network <network> ${factoryAddress} ${PVIUM_FEE_BPS} ${WITHDRAWAL_PROCESSOR_FEE_BPS} ${PVIUM_ADMIN_ADDRESS} ${PVIUM_FEE_ADDRESS} ${deployerAddress} ${VALIDITY_PERIOD} '[${ACCEPTED_TOKENS.map(t => `"${t}"`).join(",")}]'`);
    console.log("3. Update your .env file with these addresses");
    if (ACCEPTED_TOKENS.length === 0) {
        console.log("4. Add accepted tokens using factory.setAcceptedToken() or factory.setAcceptedTokensBatch()");
    }
    console.log();

    // Step 5: Generate deployment config file
    const deploymentInfo = {
        network: (await ethers.provider.getNetwork()).name,
        chainId: (await ethers.provider.getNetwork()).chainId.toString(),
        timestamp: new Date().toISOString(),
        deployer: deployer.address,
        contracts: {
            SmartEscrowDeployer: deployerAddress,
            SmartEscrowFactory: factoryAddress
        },
        configuration: {
            pviumFeeBps: PVIUM_FEE_BPS,
            withdrawalProcessorFeeBps: WITHDRAWAL_PROCESSOR_FEE_BPS,
            pviumAdminAddress: PVIUM_ADMIN_ADDRESS,
            pviumFeeAddress: PVIUM_FEE_ADDRESS,
            validityPeriod: VALIDITY_PERIOD,
            acceptedTokens: ACCEPTED_TOKENS
        }
    };

    console.log("=== Deployment Info (JSON) ===");
    console.log(JSON.stringify(deploymentInfo, null, 2));
}

// Execute deployment
main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error("Deployment failed:");
        console.error(error);
        process.exit(1);
    });
