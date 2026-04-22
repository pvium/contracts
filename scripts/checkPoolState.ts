import { ethers } from "hardhat";

// Configuration
const TOKEN_ADDRESS = "0x7dCEd3bFcC97948a665BB665a5D7eEfdfce39C3A";
const UNISWAP_V2_ROUTER = "0x1689E7B1F10000AE47eBfE339a4f69dECd19F602";
const UNISWAP_V2_FACTORY = "0x7Ae58f10f7849cA6F5fB71b7f45CB416c9204b1e";

const FACTORY_ABI = [
  "function getPair(address tokenA, address tokenB) external view returns (address pair)",
];

const PAIR_ABI = [
  "function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)",
  "function token0() external view returns (address)",
  "function token1() external view returns (address)",
  "function balanceOf(address account) external view returns (uint256)",
  "function totalSupply() external view returns (uint256)",
  "function MINIMUM_LIQUIDITY() external pure returns (uint256)",
];

const ROUTER_ABI = [
  "function WETH() external pure returns (address)",
];

const ERC20_ABI = [
  "function decimals() external view returns (uint8)",
  "function symbol() external view returns (string)",
  "function balanceOf(address account) external view returns (uint256)",
];

async function main() {
  const [deployer] = await ethers.getSigners();

  console.log("╔════════════════════════════════════════════════════════════════╗");
  console.log("║              Uniswap V2 Pool State Diagnostic                 ║");
  console.log("╚════════════════════════════════════════════════════════════════╝");
  console.log();

  const router = new ethers.Contract(UNISWAP_V2_ROUTER, ROUTER_ABI, deployer);
  const factory = new ethers.Contract(UNISWAP_V2_FACTORY, FACTORY_ABI, deployer);
  const token = new ethers.Contract(TOKEN_ADDRESS, ERC20_ABI, deployer);

  const wethAddress = await router.WETH();
  const pairAddress = await factory.getPair(TOKEN_ADDRESS, wethAddress);

  console.log("Addresses:");
  console.log("├─ Token:", TOKEN_ADDRESS);
  console.log("├─ WETH:", wethAddress);
  console.log("└─ Pair:", pairAddress);
  console.log();

  if (pairAddress === ethers.ZeroAddress) {
    console.log("❌ Pair does not exist!");
    console.log("You need to create the pair first by adding initial liquidity.");
    return;
  }

  const pair = new ethers.Contract(pairAddress, PAIR_ABI, deployer);
  const weth = new ethers.Contract(wethAddress, ERC20_ABI, deployer);

  // Get pair info
  const [reserve0, reserve1] = await pair.getReserves();
  const token0 = await pair.token0();
  const token1 = await pair.token1();
  const totalSupply = await pair.totalSupply();
  const myLpBalance = await pair.balanceOf(deployer.address);

  let minLiquidity;
  try {
    minLiquidity = await pair.MINIMUM_LIQUIDITY();
  } catch {
    minLiquidity = 1000n; // Standard Uniswap V2 minimum
  }

  const isToken0 = token0.toLowerCase() === TOKEN_ADDRESS.toLowerCase();
  const tokenReserve = isToken0 ? reserve0 : reserve1;
  const wethReserve = isToken0 ? reserve1 : reserve0;

  const tokenDecimals = await token.decimals();
  const tokenSymbol = await token.symbol();

  console.log("Pair State:");
  console.log("├─ Total LP Supply:", ethers.formatEther(totalSupply));
  console.log("├─ Minimum Liquidity:", ethers.formatEther(minLiquidity));
  console.log("├─ Your LP Balance:", ethers.formatEther(myLpBalance));
  console.log("├─", tokenSymbol, "Reserve:", ethers.formatUnits(tokenReserve, tokenDecimals));
  console.log("└─ WETH Reserve:", ethers.formatEther(wethReserve));
  console.log();

  // Check token balances
  const tokenBalance = await token.balanceOf(deployer.address);
  const wethBalance = await weth.balanceOf(deployer.address);
  const ethBalance = await ethers.provider.getBalance(deployer.address);

  console.log("Your Balances:");
  console.log("├─", tokenSymbol + ":", ethers.formatUnits(tokenBalance, tokenDecimals));
  console.log("├─ WETH:", ethers.formatEther(wethBalance));
  console.log("└─ ETH:", ethers.formatEther(ethBalance));
  console.log();

  // Diagnosis
  console.log("Diagnosis:");

  if (totalSupply === 0n) {
    console.log("✓ Pool is completely empty (total supply = 0)");
    console.log("✓ You can add initial liquidity at any ratio");
    console.log();
    console.log("Recommendation:");
    console.log("Use the addLiquidity.ts script with:");
    console.log("  TOKEN_AMOUNT = \"1000000\" (1M tokens)");
    console.log("  ETH_AMOUNT = \"0.001\"");
  } else if (totalSupply === minLiquidity) {
    console.log("⚠ Pool only has MINIMUM_LIQUIDITY locked");
    console.log("⚠ Reserves are essentially 0, but", minLiquidity, "LP tokens are permanently locked");
    console.log("⚠ This is normal for Uniswap V2 - first liquidity locks 1000 wei of LP tokens");
    console.log();
    console.log("Recommendation:");
    console.log("You can still add liquidity at your desired ratio.");
    console.log("The locked liquidity is negligible (< 0.000000000000001%)");
  } else if (tokenReserve === 0n && wethReserve === 0n) {
    console.log("❌ Unusual state: Total supply > 0 but reserves are 0");
    console.log("This shouldn't happen in normal operation.");
  } else {
    const ratio = Number(tokenReserve) / Number(wethReserve);
    console.log("✓ Pool has liquidity");
    console.log("Current ratio:", ethers.formatUnits(tokenReserve, tokenDecimals), tokenSymbol, "per 1 WETH");
    console.log("Or:", (1 / ratio).toFixed(18), "WETH per", tokenSymbol);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
