import { ethers } from "hardhat";

/**
 * Chain-specific configuration for V2 swaps
 */
interface ChainConfig {
  chainId: number;
  name: string;
  universalDexRouter: string;
  tokenOut: string; // Single configurable token output per chain
  wethAddress: string;
  receiver?: string;
}

const CHAIN_CONFIGS: { [chainId: number]: ChainConfig } = {
  // Ethereum Mainnet
  31337: {
    chainId: 31337,
    name: "Hardhat",
    universalDexRouter: "0xbe31BE82b488321b7acFAc3bd41998C9843B2e71", // TODO: Add deployed address
    tokenOut: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", // USDC
    wethAddress: "", // WETH on BSC Mainnet
  },
  // Base Mainnet
  8453: {
    chainId: 8453,
    name: "Base Mainnet",
    universalDexRouter: "", // TODO: Add deployed address
    tokenOut: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", // USDC
     wethAddress: "", // WETH on BSC Mainnet
  },
  56: {
    chainId: 56,
    name: "BSC",
    universalDexRouter: "0xbe31BE82b488321b7acFAc3bd41998C9843B2e71", 
    wethAddress: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c", // WBNB on BSC Mainnet
    tokenOut: "0x55d398326f99059fF775485246999027B3197955", // USDT
    receiver: "0x4d8caa7826e8b10b97ef173a282cbf2d772c1131"
  },
};

/**
 * Execute ETH -> exact token swap using UniversalDexRouter (V2)
 */
async function swapETHForExactToken(
  routerAddress: string,
  tokenIn: string,
  tokenOut: string,
  amountOut: bigint,
  recipient: string,
  paymentAmount: bigint,
  memo: string,
  slippageBps: number = 100 // 1% slippage tolerance
) {
  const router = await ethers.getContractAt("UniversalDexRouter", routerAddress);

  // Get quote for exact output using UniversalDexRouter's quoteForExactOutputV2
  const path = [tokenIn, tokenOut];
  console.log("\n=== Getting Quote ===");
  console.log(`Path: ${tokenIn} -> ${tokenOut}`);
  console.log(`Desired output: ${ethers.formatUnits(amountOut, 18)} tokens`);

  const amounts = await router.quoteForExactOutputV2(amountOut, path);
  const requiredEthInput = amounts[0];

  console.log(`Required ETH input: ${ethers.formatEther(requiredEthInput)} ETH`);

  // Add slippage tolerance to the amount we send
  const ethToSend = (requiredEthInput * BigInt(10000 + slippageBps)) / BigInt(10000);
  console.log(`ETH to send (with ${slippageBps / 100}% slippage): ${ethers.formatEther(ethToSend)} ETH`);

  console.log("\n=== Swap Parameters ===");
  console.log(`Token Out: ${tokenOut}`);
  console.log(`Exact Amount Out: ${ethers.formatUnits(amountOut, 18)} tokens`);
  console.log(`Payment Amount: ${ethers.formatUnits(paymentAmount, 18)} tokens`);
  console.log(`Recipient: ${recipient}`);
  console.log(`Memo: ${memo}`);

  const deadline = Math.floor(Date.now() / 1000) + 1200; // 20 minutes

  const params = {
    amountOutMin: amountOut,
    path: [tokenIn, tokenOut], // Empty path for V2 - router will determine
    to: recipient,
    paymentAmount,
    deadline,
    memo,
  };

  console.log("\nExecuting V2 swap...\n");

  const tx = await router.swapETHForExactTokens(params, {
    value: ethToSend,
  });

  console.log(`Transaction hash: ${tx.hash}`);
  const receipt = await tx.wait();
  console.log(`Transaction confirmed in block ${receipt!.blockNumber}`);

  // Parse events
  const swapFeeEvent = receipt!.logs.find(
    (log: any) => log.topics[0] === ethers.id("SwapFee(address,uint256,uint256)")
  );
  const swapExecutedEvent = receipt!.logs.find(
    (log: any) =>
      log.topics[0] ===
      ethers.id(
        "SwapExecuted(address,address,address,address,uint256,uint256,uint256,string)"
      )
  );

  if (swapFeeEvent && swapExecutedEvent) {
    const feeLog = router.interface.parseLog({
      topics: swapFeeEvent.topics as string[],
      data: swapFeeEvent.data,
    });
    const swapLog = router.interface.parseLog({
      topics: swapExecutedEvent.topics as string[],
      data: swapExecutedEvent.data,
    });

    console.log("\n=== Swap Results ===");
    console.log(`Swap ID: ${feeLog!.args.swapId}`);
    console.log(`Actual ETH Used: ${ethers.formatEther(swapLog!.args.amountIn)} ETH`);
    console.log(`Tokens Received: ${ethers.formatUnits(swapLog!.args.amountOut, 18)}`);
    console.log(`Fee Collected: ${ethers.formatUnits(feeLog!.args.fee, 18)} tokens`);
    console.log(
      `ETH Refunded: ${ethers.formatEther(ethToSend - swapLog!.args.amountIn)} ETH`
    );
  }

  return receipt;
}

/**
 * Main execution function
 */
async function main() {
  const [signer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();
  const chainId = Number(network.chainId);

  console.log(`\n=== Swap ETH for Exact Token (V2) ===`);
  console.log(`Network: ${network.name} (Chain ID: ${chainId})`);
  console.log(`Signer: ${signer.address}\n`);

  const config = CHAIN_CONFIGS[chainId];
  if (!config) {
    throw new Error(`Chain ID ${chainId} not supported`);
  }

  if (!config.universalDexRouter) {
    throw new Error(
      `UniversalDexRouter not deployed on ${config.name}. Please update CHAIN_CONFIGS.`
    );
  }
/*
swapETHForExactTokens((uint256 amountOutMin, address[] path, address to, uint256 paymentAmount, uint256 deadline, string memo, uint256 nonce))
 args: ({"amountOutMin":"5014999999999999680","path":["0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c","0x55d398326f99059fF775485246999027B3197955"],"to":"0x4d8caa7826e8b10b97ef173a282cbf2d772c1131","paymentAmount":"5000000000000000000","deadline":"1767780653","memo":"36349b ","nonce":"0"})

*/
  // Example: Swap ETH for exactly 100 USDC
  const amountOut = ethers.parseUnits("5.0000025", 18); // 100 USDC (6 decimals)
  const paymentAmount = ethers.parseUnits("5", 18); // Pay 95 USDC to recipient (5 USDC fee)
  const recipient = "0x4d8caa7826e8b10b97ef173a282cbf2d772c1131"; // Send to self for testing
  const memo = "36349b";

  await swapETHForExactToken(
    config.universalDexRouter,
    config.wethAddress,
    config.tokenOut,
    amountOut,
    recipient,
    paymentAmount,
    memo,
    100 // 1% slippage tolerance
  );
}

// Execute main function
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
