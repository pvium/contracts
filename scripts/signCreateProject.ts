import { ethers } from "ethers";

/**
 * Script to sign a create project payload for SmartEscrowFactory
 * This generates the app signature and Pvium attestation signature required for createProject()
 */

// Configuration - UPDATE THESE VALUES
const PRIVATE_KEY_APP = "0xc5db2c24995f712831d2d2200c7d7d89add33495b1c1dda53e2c7f4451fd8d66"; // App owner private key
const PRIVATE_KEY_PVIUM = "0x0000000000000000000000000000000000000000000000000000000000000002"; // Pvium admin private key

const PVIUM_FEE_BPS = 50; // 1% - Get this from factory.pviumFeeBps()
const CHAIN_ID = 84532; // BSC mainnet - UPDATE based on your network
const CHAIN_NAME = 'base-test'

// Domain prefix for signatures (must match contract)
const SIGNATURE_DOMAIN = ethers.id("PVIUM_SIGNATURE_MESSAGE");

// Project configuration
const payload = {
    app: "app_7cef728f3b2ee0cee8aa23f4655a00dd",
    projectId: "project-001",
    metadata: "ipfs://QmExample...", // IPFS hash or metadata URI
    tokenAddress: "0x7dCEd3bFcC97948a665BB665a5D7eEfdfce39C3A", // ERC20 token address (e.g., USDC)
    refundAddress: "0xd89410Ef11eb583d85767d84a73002E89E6d0545", // Address to receive refunds
    appFeeAddress: "0xd89410Ef11eb583d85767d84a73002E89E6d0545", // Address to receive app fees
    appAdminAddress: "0xd89410Ef11eb583d85767d84a73002E89E6d0545", // Initial app admin address
    appFeeBps: 200, // 2% app fee
    disputeWindowSeconds: 3 * 24 * 60 * 60, // 3 days
    lockDurationSeconds: 90 * 24 * 60 * 60, // 90 days (duration in seconds)
    minimumBalancePerVendor: ethers.parseUnits("100", 6), // $100 per vendor (for 6 decimal tokens like USDC)
    maxNumVendors: 10,
    chain: CHAIN_NAME,
    funderEmail: "feminefa@gmail.com"
};

async function signCreateProject() {
    console.log("=== SmartEscrow Project Creation Signature Generator ===\n");

    // Create wallets from private keys
    const appOwnerWallet = new ethers.Wallet(PRIVATE_KEY_APP);
    const pviumWallet = new ethers.Wallet(PRIVATE_KEY_PVIUM);

    console.log("App Owner Address:", appOwnerWallet.address);
    console.log("Pvium Admin Address:", pviumWallet.address);
    console.log("\n--- Project Payload ---");
    console.log(JSON.stringify({
        ...payload,
        minimumBalancePerVendor: payload.minimumBalancePerVendor.toString()
    }, null, 2));
    const abiParams = [
        SIGNATURE_DOMAIN,
        payload.app,
        payload.projectId,
        payload.metadata,
        payload.tokenAddress,
        payload.refundAddress,
        payload.appFeeAddress,
        payload.appAdminAddress,
        payload.appFeeBps,
        payload.disputeWindowSeconds,
        payload.lockDurationSeconds,
        payload.minimumBalancePerVendor,
        PVIUM_FEE_BPS,
        CHAIN_ID
    ];
    console.log('ABIPArams', abiParams)
    // Step 1: App owner signs the payload
    console.log("\n--- Step 1: App Signature ---");
    const appMessageHash = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
            [
                "bytes32", // SIGNATURE_DOMAIN
                "string",  // app
                "string",  // projectId
                "string",  // metadata
                "address", // tokenAddress
                "address", // refundAddress
                "address", // appFeeAddress
                "address", // appAdminAddress
                "uint256", // appFeeBps
                "uint256", // disputeWindowSeconds
                "uint256", // lockDurationSeconds
                "uint256", // minimumBalancePerVendor
                "uint256", // pviumFeeBps
                "uint256"  // chainId
            ],
            abiParams
        )
    );
    
console.log("MessageHash", appMessageHash)
    const appSignature = await appOwnerWallet.signMessage(ethers.getBytes(appMessageHash));
    console.log("App Message Hash:", appMessageHash);
    console.log("App Signature:", appSignature);

    // Step 2: Pvium attests the app signature
    console.log("\n--- Step 2: Pvium Attestation ---");
    const pviumMessageHash = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
            ["bytes32", "bytes", "uint256"],
            [SIGNATURE_DOMAIN, appSignature, CHAIN_ID]
        )
    );

    const pviumSignature = await pviumWallet.signMessage(ethers.getBytes(pviumMessageHash));
    console.log("Pvium Message Hash:", pviumMessageHash);
    console.log("Pvium Signature:", pviumSignature);

    // Step 3: Output the complete function call data
    console.log("\n--- Step 3: Contract Call Parameters ---");
    console.log("Call factory.createProject() with these parameters:");
    console.log("\nPayload:");
    console.log(JSON.stringify({
        app: payload.app,
        projectId: payload.projectId,
        metadata: payload.metadata,
        tokenAddress: payload.tokenAddress,
        refundAddress: payload.refundAddress,
        appFeeAddress: payload.appFeeAddress,
        appAdminAddress: payload.appAdminAddress,
        appFeeBps: payload.appFeeBps,
        disputeWindowSeconds: payload.disputeWindowSeconds,
        lockDurationSeconds: payload.lockDurationSeconds,
        minimumBalancePerVendor: payload.minimumBalancePerVendor.toString(),
        maxNumVendors: payload.maxNumVendors
    }, null, 2));

    console.log("\nappSignature:");
    console.log(appSignature);

    console.log("\npviumSignature:");
    console.log(pviumSignature);

    // Step 4: Generate ethers.js code example
    console.log("\n--- Step 4: Example Code ---");
    console.log(`
// Using ethers.js v6:
const factory = await ethers.getContractAt("SmartEscrowFactory", FACTORY_ADDRESS);

const payload = ${JSON.stringify({
    app: payload.app,
    projectId: payload.projectId,
    metadata: payload.metadata,
    tokenAddress: payload.tokenAddress,
    refundAddress: payload.refundAddress,
    appFeeAddress: payload.appFeeAddress,
    appAdminAddress: payload.appAdminAddress,
    appFeeBps: payload.appFeeBps,
    disputeWindowSeconds: payload.disputeWindowSeconds,
    lockDurationSeconds: payload.lockDurationSeconds,
    minimumBalancePerVendor: "REPLACE_WITH_BIGINT_VALUE",
    maxNumVendors: payload.maxNumVendors
}, null, 2).replace('"REPLACE_WITH_BIGINT_VALUE"', payload.minimumBalancePerVendor.toString() + 'n')};

const appSignature = "${appSignature}";
const pviumSignature = "${pviumSignature}";

const tx = await factory.createProject(payload, appSignature, pviumSignature);
const receipt = await tx.wait();
console.log("Project created! Transaction hash:", receipt.hash);

// Get the project address
const projectAddress = await factory.getProjectByUniqueId("${payload.app}", "${payload.projectId}");
console.log("Project address:", projectAddress);
    `);

    // Step 5: Verification info
    console.log("\n--- Step 5: Signature Verification ---");
    console.log("Recovered app signer:", ethers.verifyMessage(ethers.getBytes(appMessageHash), appSignature));
    console.log("Expected app signer:", appOwnerWallet.address);
    console.log("App signature valid:", ethers.verifyMessage(ethers.getBytes(appMessageHash), appSignature) === appOwnerWallet.address);

    console.log("\nRecovered Pvium signer:", ethers.verifyMessage(ethers.getBytes(pviumMessageHash), pviumSignature));
    console.log("Expected Pvium signer:", pviumWallet.address);
    console.log("Pvium signature valid:", ethers.verifyMessage(ethers.getBytes(pviumMessageHash), pviumSignature) === pviumWallet.address);

    console.log("\n=== Signature Generation Complete ===");
}

// Run the script
signCreateProject().catch((error) => {
    console.error("Error:", error);
    process.exit(1);
});
