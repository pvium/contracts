import { ethers } from "hardhat";

// Configuration - Update these values
const TOKEN_ADDRESS = "0x7dCEd3bFcC97948a665BB665a5D7eEfdfce39C3A"; // Your token address
const UNISWAP_V2_ROUTER = "0x1689E7B1F10000AE47eBfE339a4f69dECd19F602";
const UNISWAP_V2_FACTORY = "0x7Ae58f10f7849cA6F5fB71b7f45CB416c9204b1e";

// Remove all liquidity (100%)
const LIQUIDITY_PERCENTAGE = 100; // Set to lower value to remove partial liquidity

// ABI Interfaces
const FACTORY_ABI = [
  "function getPair(address tokenA, address tokenB) external view returns (address pair)",
];

const PAIR_ABI = [
  "function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)",
  "function token0() external view returns (address)",
  "function token1() external view returns (address)",
  "function balanceOf(address account) external view returns (uint256)",
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function totalSupply() external view returns (uint256)",
];

const ROUTER_ABI = [
  "function removeLiquidityETH(address token, uint liquidity, uint amountTokenMin, uint amountETHMin, address to, uint deadline) external returns (uint amountToken, uint amountETH)",
  "function WETH() external pure returns (address)",
];

const ERC20_ABI = [
  "function decimals() external view returns (uint8)",
  "function symbol() external view returns (string)",
  "function name() external view returns (string)",
];

async function main() {
  const [deployer] = await ethers.getSigners();

  console.log("╔════════════════════════════════════════════════════════════════╗");
  console.log("║         Remove Liquidity from Uniswap V2 (Base Sepolia)      ║");
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
  const wethAddress = await router.WETH();

  console.log("Token:", symbol);
  console.log("WETH Address:", wethAddress);
  console.log();

  // Get pair address
  const pairAddress = await factory.getPair(TOKEN_ADDRESS, wethAddress);
  console.log("Pair Address:", pairAddress);

  if (pairAddress === ethers.ZeroAddress) {
    throw new Error("Liquidity pool does not exist");
  }

  const pair = new ethers.Contract(pairAddress, PAIR_ABI, deployer);

  // Get LP token balance
  const lpBalance = await pair.balanceOf(deployer.address);
  console.log("LP Token Balance:", ethers.formatEther(lpBalance));

  if (lpBalance === 0n) {
    throw new Error("No LP tokens to remove");
  }

  // Calculate liquidity to remove
  const liquidityToRemove = (lpBalance * BigInt(LIQUIDITY_PERCENTAGE)) / 100n;
  console.log(`Removing ${LIQUIDITY_PERCENTAGE}% of liquidity:`, ethers.formatEther(liquidityToRemove), "LP tokens");
  console.log();

  // Approve LP tokens
  console.log("Approving LP tokens...");
  const approveTx = await pair.approve(UNISWAP_V2_ROUTER, liquidityToRemove);
  await approveTx.wait();
  console.log("✓ LP tokens approved");
  console.log();

  // Remove liquidity
  const amountTokenMin = 0n; // Accept any amount (you can add slippage protection here)
  const amountETHMin = 0n;
  const deadline = Math.floor(Date.now() / 1000) + 60 * 1; // 20 minutes

  console.log("Removing liquidity...");

  // Get current gas price and increase it
  const feeData = await ethers.provider.getFeeData();
  const gasPrice = feeData.gasPrice ? (feeData.gasPrice * 120n) / 100n : undefined; // 20% higher

  const tx = await router.removeLiquidityETH(
    TOKEN_ADDRESS,
    liquidityToRemove,
    amountTokenMin,
    amountETHMin,
    deployer.address,
    deadline,
    { gasPrice }
  );

  console.log("Transaction hash:", tx.hash);
  console.log("Waiting for confirmation (this may take 1-2 minutes on Base Sepolia)...");

  try {
    const receipt = await Promise.race([
      tx.wait(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Timeout")), 180000) // 3 min timeout
      )
    ]);
    console.log("✓ Transaction confirmed in block:", receipt?.blockNumber);
  } catch (error: any) {
    if (error.message === "Timeout") {
      console.log("⚠ Transaction is taking longer than expected");
      console.log("Check transaction status manually at:");
      console.log(`https://sepolia.basescan.org/tx/${tx.hash}`);
      console.log("\nTransaction was sent successfully but confirmation is pending.");
      return;
    }
    throw error;
  }
  console.log();

  console.log("╔════════════════════════════════════════════════════════════════╗");
  console.log("║                 Liquidity Removed Successfully!               ║");
  console.log("╚════════════════════════════════════════════════════════════════╝");
  console.log();
  console.log("View on BaseScan:");
  console.log(`https://sepolia.basescan.org/tx/${tx.hash}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
