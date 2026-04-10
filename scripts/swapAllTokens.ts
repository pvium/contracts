import { ethers } from "hardhat";

// Configuration
const TOKEN_ADDRESS = "0x7dCEd3bFcC97948a665BB665a5D7eEfdfce39C3A";
const UNISWAP_V2_ROUTER = "0x1689E7B1F10000AE47eBfE339a4f69dECd19F602";
const UNISWAP_V2_FACTORY = "0x7Ae58f10f7849cA6F5fB71b7f45CB416c9204b1e";

// Sell this many tokens to drain the pool
const TOKENS_TO_SELL = "100000000"; // 100 million tokens - adjust if needed

const FACTORY_ABI = [
  "function getPair(address tokenA, address tokenB) external view returns (address pair)",
];

const PAIR_ABI = [
  "function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)",
  "function token0() external view returns (address)",
  "function token1() external view returns (address)",
];

const ROUTER_ABI = [
  "function swapExactTokensForETH(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)",
  "function WETH() external pure returns (address)",
];

const ERC20_ABI = [
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function balanceOf(address account) external view returns (uint256)",
  "function decimals() external view returns (uint8)",
  "function symbol() external view returns (string)",
];

async function main() {
  const [deployer] = await ethers.getSigners();

  console.log("╔════════════════════════════════════════════════════════════════╗");
  console.log("║         Sell Tokens to Drain Pool WETH Reserves              ║");
  console.log("╚════════════════════════════════════════════════════════════════╝");
  console.log();

  const network = await ethers.provider.getNetwork();
  console.log("Network:", network.name);
  console.log("Chain ID:", network.chainId.toString());
  console.log("Deployer:", deployer.address);
  console.log();

  // Connect to contracts
  const token = new ethers.Contract(TOKEN_ADDRESS, ERC20_ABI, deployer);
  const router = new ethers.Contract(UNISWAP_V2_ROUTER, ROUTER_ABI, deployer);
  const factory = new ethers.Contract(UNISWAP_V2_FACTORY, FACTORY_ABI, deployer);

  const symbol = await token.symbol();
  const decimals = await token.decimals();
  const tokenBalance = await token.balanceOf(deployer.address);
  const wethAddress = await router.WETH();

  console.log("Token:", symbol);
  console.log("Your Balance:", ethers.formatUnits(tokenBalance, decimals), symbol);
  console.log();

  // Get pool reserves
  const pairAddress = await factory.getPair(TOKEN_ADDRESS, wethAddress);
  if (pairAddress === ethers.ZeroAddress) {
    console.log("❌ Pool does not exist");
    return;
  }

  const pair = new ethers.Contract(pairAddress, PAIR_ABI, deployer);
  const [reserve0, reserve1] = await pair.getReserves();
  const token0 = await pair.token0();
  const isToken0 = token0.toLowerCase() === TOKEN_ADDRESS.toLowerCase();
  const tokenReserve = isToken0 ? reserve0 : reserve1;
  const wethReserve = isToken0 ? reserve1 : reserve0;

  console.log("Current Pool Reserves:");
  console.log("├─", symbol + ":", ethers.formatUnits(tokenReserve, decimals));
  console.log("└─ WETH:", ethers.formatEther(wethReserve));
  console.log();

  const amountToSell = ethers.parseUnits(TOKENS_TO_SELL, decimals);

  if (tokenBalance < amountToSell) {
    console.log("❌ Insufficient token balance");
    console.log("Need:", TOKENS_TO_SELL, symbol);
    console.log("Have:", ethers.formatUnits(tokenBalance, decimals), symbol);
    return;
  }

  // Approve tokens
  console.log("Approving", TOKENS_TO_SELL, symbol + "...");
  const approveTx = await token.approve(UNISWAP_V2_ROUTER, amountToSell);
  await approveTx.wait();
  console.log("✓ Tokens approved");
  console.log();

  // Swap tokens for ETH
  const path = [TOKEN_ADDRESS, wethAddress];
  const amountOutMin = 0n; // Accept any amount (we're draining the pool)
  const deadline = Math.floor(Date.now() / 1000) + 60 * 20; // 20 minutes

  console.log("Selling", TOKENS_TO_SELL, symbol, "to drain WETH from pool...");
  console.log("⚠ This will drain most WETH reserves from the pool");
  console.log();

  // Get current gas price and increase it
  const feeData = await ethers.provider.getFeeData();
  const gasPrice = feeData.gasPrice ? (feeData.gasPrice * 120n) / 100n : undefined; // 20% higher

  const tx = await router.swapExactTokensForETH(
    amountToSell,
    amountOutMin,
    path,
    deployer.address,
    deadline,
    { gasPrice }
  );

  console.log("Transaction hash:", tx.hash);
  console.log("Waiting for confirmation...");

  const receipt = await tx.wait();
  console.log("✓ Transaction confirmed in block:", receipt?.blockNumber);
  console.log();

  // Check new pool reserves
  const [newReserve0, newReserve1] = await pair.getReserves();
  const newTokenReserve = isToken0 ? newReserve0 : newReserve1;
  const newWethReserve = isToken0 ? newReserve1 : newReserve0;

  console.log("New Pool Reserves:");
  console.log("├─", symbol + ":", ethers.formatUnits(newTokenReserve, decimals));
  console.log("└─ WETH:", ethers.formatEther(newWethReserve));
  console.log();

  // Check new balances
  const newTokenBalance = await token.balanceOf(deployer.address);
  const ethBalance = await ethers.provider.getBalance(deployer.address);

  console.log("Your Balances:");
  console.log("├─", symbol + ":", ethers.formatUnits(newTokenBalance, decimals));
  console.log("└─ ETH:", ethers.formatEther(ethBalance));
  console.log();

  console.log("╔════════════════════════════════════════════════════════════════╗");
  console.log("║                   Swap Completed Successfully!                ║");
  console.log("╚════════════════════════════════════════════════════════════════╝");
  console.log();
  console.log("View on BaseScan:");
  console.log(`https://sepolia.basescan.org/tx/${tx.hash}`);
  console.log();
  console.log("Next Steps:");
  console.log("1. Remove your LP tokens with removeLiquidity.ts");
  console.log("2. Add fresh liquidity at 1:1M ratio with addLiquidity.ts");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
