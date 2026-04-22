import { ethers } from "hardhat";

/**
 * Utility script to operate MockERC20 tokens
 *
 * Operations:
 * 1. Check token balance
 * 2. Transfer tokens
 *
 * Usage:
 * npx hardhat run scripts/operateMockERC20.ts --network <network-name>
 */

// Configuration - UPDATE THESE VALUES
const OPERATION = "checkBalance"; // "checkBalance" or "transfer"
const TOKEN_ADDRESS = "0x5FbDB2315678afecb367f032d93F642f64180aa3"; // MockERC20 token address

// For checkBalance operation
const CHECK_ADDRESS = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8"; // Address to check balance for

// For transfer operation
const TO_ADDRESS = "0x71De2e55987713aDadfA22a3A93007d2d2B9E6fa"; // Recipient address
const TRANSFER_AMOUNT = ethers.parseUnits("1000", 6); // Amount to transfer (adjust decimals)

/**
 * Check the token balance of a given address
 * @param tokenAddress - The ERC20 token contract address
 * @param walletAddress - The wallet address to check balance for
 */
async function checkBalance(tokenAddress: string, walletAddress: string) {
    console.log("=== Check Token Balance ===\n");
    console.log("Token Address:", tokenAddress);
    console.log("Wallet Address:", walletAddress);
    console.log();

    // Get token contract
    const token = await ethers.getContractAt("MockERC20", tokenAddress);

    // Get token info
    const name = await token.name();
    const symbol = await token.symbol();
    const decimals = await token.decimals();

    console.log("--- Token Info ---");
    console.log("Name:", name);
    console.log("Symbol:", symbol);
    console.log("Decimals:", decimals);
    console.log();

    // Check balance
    const balance = await token.balanceOf(walletAddress);
    const formattedBalance = ethers.formatUnits(balance, decimals);

    console.log("--- Balance ---");
    console.log(`Raw Balance: ${balance.toString()}`);
    console.log(`Formatted Balance: ${formattedBalance} ${symbol}`);

    return {
        balance: balance.toString(),
        formattedBalance,
        symbol,
        decimals: Number(decimals),
    };
}

/**
 * Transfer tokens from the deployer to a recipient
 * @param tokenAddress - The ERC20 token contract address
 * @param toAddress - The recipient address
 * @param amount - The amount to transfer (in smallest units)
 */
async function transferTokens(tokenAddress: string, toAddress: string, amount: bigint) {
    console.log("=== Transfer Tokens ===\n");

    // Get deployer account
    const [deployer] = await ethers.getSigners();
    console.log("Transfer from:", deployer.address);
    console.log("Transfer to:", toAddress);
    console.log();

    // Get token contract
    const token = await ethers.getContractAt("MockERC20", tokenAddress);

    // Get token info
    const symbol = await token.symbol();
    const decimals = await token.decimals();

    // Check balance before
    const balanceBefore = await token.balanceOf(deployer.address);
    console.log(`Sender balance before: ${ethers.formatUnits(balanceBefore, decimals)} ${symbol}`);

    // Transfer tokens
    const formattedAmount = ethers.formatUnits(amount, decimals);
    console.log(`\nTransferring ${formattedAmount} ${symbol}...`);
    const tx = await token.transfer(toAddress, amount);
    await tx.wait();
    console.log("Transfer successful!");
    console.log("Transaction hash:", tx.hash);

    // Check balances after
    const senderBalanceAfter = await token.balanceOf(deployer.address);
    const recipientBalance = await token.balanceOf(toAddress);
    console.log(`\n--- Balances After Transfer ---`);
    console.log(`Sender balance: ${ethers.formatUnits(senderBalanceAfter, decimals)} ${symbol}`);
    console.log(`Recipient balance: ${ethers.formatUnits(recipientBalance, decimals)} ${symbol}`);

    return {
        txHash: tx.hash,
        senderBalanceAfter: senderBalanceAfter.toString(),
        recipientBalance: recipientBalance.toString(),
    };
}

async function main() {
    if (OPERATION === "checkBalance") {
        await checkBalance(TOKEN_ADDRESS, CHECK_ADDRESS);
    } else if (OPERATION === "transfer") {
        await transferTokens(TOKEN_ADDRESS, TO_ADDRESS, TRANSFER_AMOUNT);
    } else {
        console.error(`Unknown operation: ${OPERATION}`);
        console.log('Available operations: "checkBalance", "transfer"');
        process.exit(1);
    }
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error("Error:", error);
        process.exit(1);
    });
