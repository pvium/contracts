import { ethers } from "ethers";
import { acceptedTokensByChain } from "./tokenConfig";

/**
 * Script to sign a create account payload for SmartEscrowFactory
 * This generates the app signature and Pvium attestation signature required for createAccount()
 *
 * The token address is automatically selected from acceptedTokensByChain based on CHAIN_ID.
 * To use a different network:
 * 1. Update CHAIN_ID (e.g., 1 for Ethereum, 56 for BSC, 8453 for Base)
 * 2. Update CHAIN_NAME for reference
 * 3. Update FACTORY_ADDRESS with the deployed factory address on that network
 * 4. Ensure acceptedTokensByChain in deployEscrowFactory.ts has tokens configured for your chain
 *
 * Usage:
 * npx ts-node scripts/signCreateAccount.ts
 */

// Configuration - UPDATE THESE VALUES
const PRIVATE_KEY_APP = "0xc5db2c24995f712831d2d2200c7d7d89add33495b1c1dda53e2c7f4451fd8d66"; // App owner private key
const PRIVATE_KEY_PVIUM = "0x0000000000000000000000000000000000000000000000000000000000000002"; // Pvium admin private key

const PVIUM_FEE_BPS = 50; // 0.5% - Get this from factory.pviumFeeBps()

// Network Configuration - UPDATE based on your target network
const CHAIN_ID = 31337; // 31337 = Localhost/Hardhat, 1 = Ethereum, 56 = BSC, 8453 = Base
const CHAIN_NAME = 'localhost'; // For reference only
const FACTORY_ADDRESS = '0x8A791620dd6260079BF849Dc5567aDC3F2FdC318'; // Factory contract address on your network

// Domain prefix for signatures (must match contract)
const SIGNATURE_DOMAIN = ethers.id("PVIUM_SIGNATURE_MESSAGE");

// Get the first accepted token for the current chain
const acceptedTokens = acceptedTokensByChain[CHAIN_ID] || [];
if (acceptedTokens.length === 0) {
    throw new Error(`No accepted tokens configured for chain ID ${CHAIN_ID}. Please add tokens to acceptedTokensByChain in deployEscrowFactory.ts`);
}
const TOKEN_ADDRESS = acceptedTokens[0]; // Use the first accepted token

// Account configuration
const payload = {
    app: "app_7cef728f3b2ee0cee8aa23f4655a00dd",
    projectId: "project-012",
    metadata: "ipfs://QmExample...", // IPFS hash or metadata URI
    tokenAddress: TOKEN_ADDRESS, // Automatically selected from acceptedTokensByChain
    refundAddress: "0xd89410Ef11eb583d85767d84a73002E89E6d0545", // Address to receive refunds
    appFeeBps: 200, // 2% app fee
    disputeWindowSeconds: 3 * 24 * 60 * 60, // 3 days
    lockDurationSeconds: 90 * 24 * 60 * 60, // 90 days (duration in seconds)
    basePayout: ethers.parseUnits("100", 6), // $100 base payout (emergency fallback per receiver)
    maxPayout: ethers.parseUnits("150", 6), // $150 max total payout per receiver
    maxNumReceivers: 10,
    chain: CHAIN_NAME,
    funderEmail: "feminefa@gmail.com",
    timestamp: Math.floor(Date.now()/1000)
};

// Separate parameter for app fee address
const APP_FEE_ADDRESS = "0xd89410Ef11eb583d85767d84a73002E89E6d0545";

async function signCreateAccount() {
  console.log('=== SmartEscrow Account Creation Signature Generator ===\n');

  // Create wallets from private keys
  const appOwnerWallet = new ethers.Wallet(PRIVATE_KEY_APP);
  const pviumWallet = new ethers.Wallet(PRIVATE_KEY_PVIUM);

  console.log('App Owner Address:', appOwnerWallet.address);
  console.log('Pvium Admin Address:', pviumWallet.address);
  console.log();
  console.log('--- Network Configuration ---');
  console.log('Chain ID:', CHAIN_ID);
  console.log('Chain Name:', CHAIN_NAME);
  console.log('Factory Address:', FACTORY_ADDRESS);
  console.log('Token Address:', TOKEN_ADDRESS);
  console.log(`Available tokens for chain ${CHAIN_ID}:`, acceptedTokens.length);
  console.log();

  // Updated ABI params to match createAccount signature verification
  const abiParams = [
    SIGNATURE_DOMAIN,
    payload.app,
    APP_FEE_ADDRESS,  // appFeeAddress is now a separate parameter
    payload.projectId,
    payload.metadata,
    payload.tokenAddress,
    payload.refundAddress,
    payload.appFeeBps,
    payload.disputeWindowSeconds,
    payload.lockDurationSeconds,
    payload.basePayout,
    payload.maxPayout,
    payload.timestamp,
    CHAIN_ID,  // chainId should be number, not string
  ];
  console.log('ABI Params:', abiParams);

  // Step 1: App owner signs the payload
  console.log('\n--- Step 1: App Signature ---');
  const appMessageHash = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      [
        'bytes32', // SIGNATURE_DOMAIN
        'string', // app
        'address', // appFeeAddress
        'string', // projectId
        'string', // metadata
        'address', // tokenAddress
        'address', // refundAddress
        'uint256', // appFeeBps
        'uint256', // disputeWindowSeconds
        'uint256', // lockDurationSeconds
        'uint256', // basePayout
        'uint256', // maxPayout
        'uint256', // timestamp
        'uint256', // chainId
      ],
      abiParams,
    ),
  );

  console.log('Message Hash:', appMessageHash);
  console.log("Signer:", appOwnerWallet.address);
  const appSignature = await appOwnerWallet.signMessage(
    ethers.getBytes(appMessageHash),
  );
  console.log('App Signature:', appSignature);
  console.log();
  // Step 2: Pvium attests the app signature
  console.log('--- Step 2: Pvium Attestation ---');
  const pviumMessageHash = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ['bytes32', 'bytes', 'address', 'uint256'],
      [SIGNATURE_DOMAIN, appSignature, FACTORY_ADDRESS, CHAIN_ID],
    ),
  );

  const pviumSignature = await pviumWallet.signMessage(
    ethers.getBytes(pviumMessageHash),
  );
  console.log('Pvium Message Hash:', pviumMessageHash);
  console.log('Pvium Signature:', pviumSignature);
  console.log();

  // Step 3: Output the complete function call data
  console.log('--- Step 3: Contract Call Parameters ---');
  console.log('Call factory.createAccount() with these parameters:');
  console.log('\nPayload:');
  console.log(
    JSON.stringify(
      {
        app: payload.app,
        projectId: payload.projectId,
        metadata: payload.metadata,
        tokenAddress: payload.tokenAddress,
        refundAddress: payload.refundAddress,
        appFeeBps: payload.appFeeBps,
        disputeWindowSeconds: payload.disputeWindowSeconds,
        lockDurationSeconds: payload.lockDurationSeconds,
        basePayout: payload.basePayout.toString(),
        maxPayout: payload.maxPayout.toString(),
        maxNumReceivers: payload.maxNumReceivers,
        timestamp: payload.timestamp
      },
      null,
      2,
    ),
  );

  console.log('\nappFeeAddress:');
  console.log(APP_FEE_ADDRESS);

  console.log('\nappSignature:');
  console.log(appSignature);

  console.log('\npviumSignature:');
  console.log(pviumSignature);

  // Step 4: Generate ethers.js code example
  console.log('\n--- Step 4: Example Code ---');

  

  // Step 5: Verification info
  console.log('\n--- Step 5: Signature Verification ---');
  console.log(
    'Recovered app signer:',
    ethers.verifyMessage(ethers.getBytes(appMessageHash), appSignature),
  );
  console.log('Expected app signer:', appOwnerWallet.address);
  console.log(
    'App signature valid:',
    ethers.verifyMessage(ethers.getBytes(appMessageHash), appSignature) ===
      appOwnerWallet.address,
  );

  console.log(
    '\nRecovered Pvium signer:',
    ethers.verifyMessage(ethers.getBytes(pviumMessageHash), pviumSignature),
  );
  console.log('Expected Pvium signer:', pviumWallet.address);
  console.log(
    'Pvium signature valid:',
    ethers.verifyMessage(ethers.getBytes(pviumMessageHash), pviumSignature) ===
      pviumWallet.address,
  );
  // Create the payload object string with proper formatting
  const payloadStr = JSON.stringify(
    {
      app: payload.app,
      projectId: payload.projectId,
      metadata: payload.metadata,
      tokenAddress: payload.tokenAddress,
      refundAddress: payload.refundAddress,
      appFeeBps: payload.appFeeBps,
      disputeWindowSeconds: payload.disputeWindowSeconds,
      lockDurationSeconds: payload.lockDurationSeconds,
      basePayout: payload.basePayout.toString(),
      maxPayout: payload.maxPayout.toString(),
      maxNumReceivers: payload.maxNumReceivers,
      timestamp: payload.timestamp,
      signature: appSignature,
      funderEmail: "feminefa@gmail.com",
      chain: "localhost",
      appFeeAddress: appOwnerWallet.address,

    },
    null,
    2,
  );

  console.log(`
// Using ethers.js v6:
const factory = await ethers.getContractAt("SmartEscrowFactory", FACTORY_ADDRESS);

const payload = ${payloadStr}

const appFeeAddress = "${APP_FEE_ADDRESS}";
const appSignature = "${appSignature}";
const pviumSignature = "${pviumSignature}";

const tx = await factory.createAccount(payload, appFeeAddress, appSignature, pviumSignature);
const receipt = await tx.wait();
console.log("Account created! Transaction hash:", receipt.hash);

// Get the account address
const accountAddress = await factory.getAccountByUniqueId("${payload.app}", "${payload.projectId}");
console.log("Account address:", accountAddress);
    `);

  console.log('\n=== Signature Generation Complete ===');

  // Step 6: Generate addReceivers payload
  console.log('\n--- Step 6: addReceivers Payload ---');

  // Example receivers to add
  const receiversToAdd = [
    '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
    '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC'
  ];

  // Generate a large random nonce for replay protection (using timestamp + random)
  const addReceiversNonce = Date.now() * 1000 + Math.floor(Math.random() * 1000);

  // Create the message hash for addReceivers
  // Format: keccak256(abi.encode(appIdBytes, payloadData, nonce, chainId))
  // payloadData includes the projectId as first parameter (not address!)
  const appIdBytes = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(['string'], [payload.app]));
  const payloadData = ethers.AbiCoder.defaultAbiCoder().encode(
    ['string', 'string', 'address[]'],
    [payload.projectId, 'addReceivers', receiversToAdd]
  );

  const addReceiversMessageHash = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ['bytes32', 'bytes', 'uint256', 'uint256'],
      [appIdBytes, payloadData, addReceiversNonce, CHAIN_ID]
    )
  );

  const addReceiversSignature = await appOwnerWallet.signMessage(
    ethers.getBytes(addReceiversMessageHash)
  );

  // Output in DTO format
  const addReceiversPayload = {
    receivers: receiversToAdd,
    nonce: addReceiversNonce,
    signature: addReceiversSignature
  };

  console.log(JSON.stringify(addReceiversPayload, null, 2));

  console.log('\n--- Debug Info (compare with API logs) ---');
  console.log(`appId: ${payload.app}`);
  console.log(`appIdBytes: ${appIdBytes}`);
  console.log(`projectId: ${payload.projectId}`);
  console.log(`receivers: ${JSON.stringify(receiversToAdd)}`);
  console.log(`nonce: ${addReceiversNonce}`);
  console.log(`chainId: ${CHAIN_ID}`);
  console.log(`payloadData: ${payloadData}`);
  console.log(`messageHash: ${addReceiversMessageHash}`);
  console.log(`signature: ${addReceiversSignature}`);
  console.log(`signer: ${appOwnerWallet.address}`);

  // Step 7: Generate activateAccount payload
  console.log('\n--- Step 7: activateAccount Payload ---');

  // Generate a large random nonce for replay protection
  const activateAccountNonce = Date.now() * 1000 + Math.floor(Math.random() * 1000);

  // Create the message hash for activateAccount
  // Format: keccak256(abi.encode(appIdBytes, payloadData, nonce, chainId))
  // payloadData includes the projectId as first parameter
  const activatePayloadData = ethers.AbiCoder.defaultAbiCoder().encode(
    ['string', 'string'],
    [payload.projectId, 'activateAccount']
  );

  const activateAccountMessageHash = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ['bytes32', 'bytes', 'uint256', 'uint256'],
      [appIdBytes, activatePayloadData, activateAccountNonce, CHAIN_ID]
    )
  );

  const activateAccountSignature = await appOwnerWallet.signMessage(
    ethers.getBytes(activateAccountMessageHash)
  );

  // Output in DTO format
  const activateAccountPayload = {
    nonce: activateAccountNonce,
    signature: activateAccountSignature
  };

  console.log(JSON.stringify(activateAccountPayload, null, 2));

  console.log('\n--- activateAccount Notes ---');
  console.log(`App ID: ${payload.app}`);
  console.log(`Project ID: ${payload.projectId}`);
  console.log(`Chain ID: ${CHAIN_ID}`);
  console.log(`Nonce: ${activateAccountNonce}`);

  // Step 8: Generate payout payload
  console.log('\n--- Step 8: Payout Payload ---');

  // Use one of the receivers from Step 6
  const payoutReceiver = receiversToAdd[0];
  const payoutAmount = ethers.parseUnits("75", 6).toString(); // $75 payout (between basePayout and maxPayout)
  const claimId = ethers.id(`claim-${Date.now()}`); // Generate unique claim ID
  const currentTime = Math.floor(Date.now() / 1000);
  const claimableAfter = currentTime; // Claimable immediately
  const claimDeadline = currentTime + (30 * 24 * 60 * 60); // 30 days deadline

  // Create the message hash for payout signature
  // Matches SmartEscrow.verifyPayoutSignature (lines 759-769)
  // Format: keccak256(abi.encode(app, projectId, claimId, receiver, amount, claimableAfter, claimDeadline))
  const payoutMessageHash = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ['string', 'string', 'bytes32', 'address', 'uint256', 'uint256', 'uint256'],
      [payload.app, payload.projectId, claimId, payoutReceiver, payoutAmount, claimableAfter, claimDeadline]
    )
  );

  const payoutSignature = await appOwnerWallet.signMessage(
    ethers.getBytes(payoutMessageHash)
  );

  // Output in DTO format matching SubmitPayoutDto
  const payoutPayload = {
    payouts: [
      {
        projectId: payload.projectId,
        claimId: claimId,
        receiver: payoutReceiver,
        amount: payoutAmount,
        claimableAfter: claimableAfter,
        claimDeadline: claimDeadline,
        appSignature: payoutSignature
      }
    ]
  };

  console.log(JSON.stringify(payoutPayload, null, 2));

  console.log('\n--- Payout Debug Info ---');
  console.log(`App ID: ${payload.app}`);
  console.log(`Project ID: ${payload.projectId}`);
  console.log(`Claim ID: ${claimId}`);
  console.log(`Receiver: ${payoutReceiver}`);
  console.log(`Amount: ${payoutAmount} (${ethers.formatUnits(payoutAmount, 6)} USDC)`);
  console.log(`Claimable After: ${claimableAfter} (${new Date(claimableAfter * 1000).toISOString()})`);
  console.log(`Claim Deadline: ${claimDeadline} (${new Date(claimDeadline * 1000).toISOString()})`);
  console.log(`Message Hash: ${payoutMessageHash}`);
  console.log(`Signature: ${payoutSignature}`);
  console.log(`Signer: ${appOwnerWallet.address}`);

  // Verify signature
  const recoveredPayoutSigner = ethers.verifyMessage(ethers.getBytes(payoutMessageHash), payoutSignature);
  console.log(`\nRecovered Signer: ${recoveredPayoutSigner}`);
  console.log(`Signature Valid: ${recoveredPayoutSigner === appOwnerWallet.address}`);
}

// Run the script
signCreateAccount().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
