import { ethers } from "ethers";

/**
 * Script to sign a setAppAdmin payload for SmartEscrowFactory
 * This generates the app admin signature required for setAppAdmin()
 *
 * Usage:
 * npx ts-node scripts/signSetAppAdmin.ts
 */

// Configuration - UPDATE THESE VALUES
const PRIVATE_KEY = "0xc5db2c24995f712831d2d2200c7d7d89add33495b1c1dda53e2c7f4451fd8d66"; // Current admin private key
const APP_ID = "app_7cef728f3b2ee0cee8aa23f4655a00dd"; // Your app clientId
const NEW_ADMIN_ADDRESS = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8"; // Address to grant/revoke admin rights
const STATUS = true; // true to grant, false to revoke
const FACTORY_ADDRESS = "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0"; // Factory contract address
const CHAIN_ID = 31337; // 31337 = Localhost/Hardhat, 1 = Ethereum, 56 = BSC, 8453 = Base

async function signSetAppAdmin() {
  console.log('=== SmartEscrow Set App Admin Signature Generator ===\n');

  // Create wallet from private key
  const adminWallet = new ethers.Wallet(PRIVATE_KEY);

  console.log('Current Admin Address:', adminWallet.address);
  console.log('Factory Address:', FACTORY_ADDRESS);
  console.log('Chain ID:', CHAIN_ID);
  console.log();

  console.log('--- Configuration ---');
  console.log('App ID:', APP_ID);
  console.log('New Admin Address:', NEW_ADMIN_ADDRESS);
  console.log('Status:', STATUS ? 'GRANT admin rights' : 'REVOKE admin rights');
  console.log();

  // Generate a large random nonce for replay protection
  const nonce = Date.now() * 1000 + Math.floor(Math.random() * 1000);

  // Create the message hash for setAppAdmin
  // Matches SmartEscrowFactory.validateAppAdmin signature verification
  // Format: keccak256(abi.encode(appIdBytes, payloadData, nonce, chainId))
  const abiCoder = ethers.AbiCoder.defaultAbiCoder();
  const appIdBytes = ethers.keccak256(abiCoder.encode(['string'], [APP_ID]));

  // payloadData = abi.encode(address(factory), "setAppAdmin", admin, status)
  const payloadData = abiCoder.encode(
    ['address', 'string', 'address', 'bool'],
    [FACTORY_ADDRESS, 'setAppAdmin', NEW_ADMIN_ADDRESS, STATUS]
  );

  const messageHash = ethers.keccak256(
    abiCoder.encode(
      ['bytes32', 'bytes', 'uint256', 'uint256'],
      [appIdBytes, payloadData, nonce, CHAIN_ID]
    )
  );

  const signature = await adminWallet.signMessage(ethers.getBytes(messageHash));

  console.log('--- Debug Info ---');
  console.log(`appIdBytes: ${appIdBytes}`);
  console.log(`payloadData: ${payloadData}`);
  console.log(`nonce: ${nonce}`);
  console.log(`messageHash: ${messageHash}`);
  console.log(`signature: ${signature}`);
  console.log(`signer: ${adminWallet.address}`);
  console.log();

  // Verify signature
  const recoveredSigner = ethers.verifyMessage(ethers.getBytes(messageHash), signature);
  console.log('--- Signature Verification ---');
  console.log(`Recovered Signer: ${recoveredSigner}`);
  console.log(`Signature Valid: ${recoveredSigner.toLowerCase() === adminWallet.address.toLowerCase()}`);
  console.log();

  // Output in DTO format for API
  const apiPayload = {
    chain: CHAIN_ID.toString(),
    factoryAddress: FACTORY_ADDRESS,
    admin: NEW_ADMIN_ADDRESS,
    status: STATUS,
    nonce: nonce,
    signature: signature
  };

  console.log('--- API Payload (POST /escrow/admins) ---');
  console.log(JSON.stringify(apiPayload, null, 2));
  console.log();
  console.log('NOTE: Each signature is bound to a specific chain and factory address.');
  console.log('You cannot reuse the same signature across different chains or factories.');
  console.log();

  console.log('--- cURL Example ---');
  console.log(`curl -X POST http://localhost:3000/escrow/admins \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -d '${JSON.stringify(apiPayload)}'`);
  console.log();

  console.log('=== Signature Generation Complete ===');
}

// Run the script
signSetAppAdmin().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
