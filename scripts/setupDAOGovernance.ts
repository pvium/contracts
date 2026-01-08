/**
 * Example deployment script showing how to set up DAO governance for TokenRelay
 * This demonstrates the complete flow from deployment to granting DAO_ROLE to a governance contract
 */

import { ethers } from "hardhat";

async function main() {
    const [deployer] = await ethers.getSigners();
    console.log("Deploying contracts with account:", deployer.address);

    // ========================================
    // STEP 1: Deploy Governance Token
    // ========================================
    console.log("\n1. Deploying Governance Token...");

    // In production, use a proper governance token (e.g., ERC20Votes)
    // For this example, we'll assume you have a governance token contract
    // const GovernanceToken = await ethers.getContractFactory("GovernanceToken");
    // const govToken = await GovernanceToken.deploy("Relay DAO Token", "RELAY", ethers.parseUnits("1000000", 18));
    // await govToken.waitForDeployment();
    // console.log("Governance Token deployed to:", await govToken.getAddress());

    const govTokenAddress = "0x..."; // Replace with your governance token address

    // ========================================
    // STEP 2: Deploy DAO Governor
    // ========================================
    console.log("\n2. Deploying DAO Governor...");

    const SimpleDAOGovernor = await ethers.getContractFactory("SimpleDAOGovernor");
    const governor = await SimpleDAOGovernor.deploy(
        govTokenAddress,                   // Governance token
        50400,                             // Voting period: ~7 days (12s blocks)
        ethers.parseUnits("100000", 18),  // Quorum: 100k tokens
        ethers.parseUnits("1000", 18)     // Proposal threshold: 1k tokens
    );
    await governor.waitForDeployment();
    console.log("DAO Governor deployed to:", await governor.getAddress());

    // ========================================
    // STEP 3: Deploy TokenRelay
    // ========================================
    console.log("\n3. Deploying TokenRelay...");

    const TokenRelay = await ethers.getContractFactory("TokenRelay");
    const relay = await TokenRelay.deploy(
        100,                               // Fee: 1%
        1000,                              // Max fee: 10%
        ethers.parseUnits("1", 18),       // Minimum: 1 token
        "TokenRelay",                      // EIP-712 domain name
        "1"                                // EIP-712 domain version
    );
    await relay.waitForDeployment();
    console.log("TokenRelay deployed to:", await relay.getAddress());

    // ========================================
    // STEP 4: Grant DAO_ROLE to Governor
    // ========================================
    console.log("\n4. Granting DAO_ROLE to Governor contract...");

    const DAO_ROLE = await relay.DAO_ROLE();
    await relay.grantRole(DAO_ROLE, await governor.getAddress());
    console.log("✓ DAO_ROLE granted to:", await governor.getAddress());

    // ========================================
    // STEP 5: Verify Role Assignment
    // ========================================
    console.log("\n5. Verifying role assignments...");

    const hasRole = await relay.hasRole(DAO_ROLE, await governor.getAddress());
    console.log("Governor has DAO_ROLE:", hasRole);

    // ========================================
    // OPTIONAL: Revoke DAO_ROLE from Deployer
    // ========================================
    console.log("\n6. (Optional) Revoking DAO_ROLE from deployer...");
    console.log("⚠️  WARNING: This makes the protocol fully governed by the DAO");
    console.log("⚠️  Only do this once governance is thoroughly tested");

    // Uncomment to fully decentralize:
    // await relay.revokeRole(DAO_ROLE, deployer.address);
    // console.log("✓ DAO_ROLE revoked from deployer");

    // ========================================
    // Summary
    // ========================================
    console.log("\n" + "=".repeat(60));
    console.log("DEPLOYMENT SUMMARY");
    console.log("=".repeat(60));
    console.log("Governance Token:", govTokenAddress);
    console.log("DAO Governor:    ", await governor.getAddress());
    console.log("TokenRelay:      ", await relay.getAddress());
    console.log("\nCurrent Roles:");
    console.log("- Deployer has ADMIN_ROLE:  ", await relay.hasRole(await relay.ADMIN_ROLE(), deployer.address));
    console.log("- Deployer has DAO_ROLE:    ", await relay.hasRole(DAO_ROLE, deployer.address));
    console.log("- Governor has DAO_ROLE:    ", hasRole);

    console.log("\n" + "=".repeat(60));
    console.log("NEXT STEPS:");
    console.log("=".repeat(60));
    console.log("1. Distribute governance tokens to community");
    console.log("2. Create test proposal to verify governance works");
    console.log("3. After testing, revoke DAO_ROLE from deployer");
    console.log("4. Consider adding a Timelock for additional security");
    console.log("\nExample: Create a proposal to change max fee to 5%:");
    console.log(`
    const callData = relay.interface.encodeFunctionData("setMaxFeePercentage", [500]);
    await governor.propose(
        "${await relay.getAddress()}",
        callData,
        "Lower maximum fee from 10% to 5%"
    );
    `);
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
