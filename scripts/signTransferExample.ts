/**
 * Example script showing how to sign a transfer request for the TokenRelay contract
 * Uses ethers.js v6
 *
 * Note: The TokenRelay contract uses AccessControl for role-based permissions:
 * - ADMIN_ROLE: Can manage supported tokens, fee percentage, and minimum amounts
 * - DAO_ROLE: Can set the maximum allowed fee percentage
 * - DEFAULT_ADMIN_ROLE: Can grant/revoke other roles
 */

import { ethers, Wallet } from 'ethers';

// EIP-712 Domain
// NOTE: name and version must match what was passed to the contract constructor
const domain = {
    name: 'TokenRelay',              // Must match constructor parameter
    version: '1',                     // Must match constructor parameter
    chainId: 1,                       // Replace with your chain ID
    verifyingContract: '0x...',       // Replace with deployed contract address
};

// EIP-712 Types
const types = {
    TransferRequest: [
        { name: 'token', type: 'address' },
        { name: 'amount', type: 'uint256' },
        { name: 'receiver', type: 'address' },
        { name: 'maxFee', type: 'uint256' },
        { name: 'signer', type: 'address' },
        { name: 'nonce', type: 'uint256' },
        { name: 'deadline', type: 'uint256' },
    ],
};

/**
 * Sign a transfer request
 * @param {Object} wallet - ethers.js Wallet instance
 * @param {Object} transferRequest - The transfer request data
 * @returns {Promise<string>} The signature
 */
async function signTransferRequest(wallet, transferRequest) {
    const signature = await wallet.signTypedData(domain, types, transferRequest);
    return signature;
}

// Example usage
async function main() {
    // Create a wallet (in production, use a secure method to get the private key)
    const privateKey = '0x...'; // User's private key
    const wallet = new ethers.Wallet(privateKey);

    // Get the current nonce from the contract
    // IMPORTANT: User MUST sign with the current nonce
    const currentNonce = 0; // Fetch from contract: await relayContract.getNonce(wallet.address)

    // Create the transfer request
    // NOTE: nonce is included in the signature, but NOT passed to relayTransfer()
    const transferRequest = {
        token: '0x...', // Token contract address
        amount: ethers.parseUnits('100', 18), // 100 tokens (adjust decimals)
        receiver: '0x...', // Receiver address
        maxFee: ethers.parseUnits('1', 18), // Maximum fee willing to pay (1 token)
        signer: wallet.address,
        nonce: currentNonce,
        deadline: Math.floor(Date.now() / 1000) + 3600, // 1 hour from now
    };

    // Sign the request
    const signature = await signTransferRequest(wallet, transferRequest);

    console.log('Transfer Request:', transferRequest);
    console.log('Signature:', signature);

    // The relayer would then call:
    // NOTE: nonce is NOT passed as parameter - contract gets it from nonces[signer]
    // await relayContract.relayTransfer(
    //     transferRequest.token,
    //     transferRequest.amount,
    //     transferRequest.receiver,
    //     transferRequest.maxFee,
    //     transferRequest.signer,
    //     transferRequest.deadline,
    //     signature
    // );
}

// Uncomment to run
// main().catch(console.error);

// Export for ES modules
export { signTransferRequest, domain, types };
