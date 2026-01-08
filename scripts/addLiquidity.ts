import { ethers } from "hardhat";

// Configuration - Update these values
const TOKEN_ADDRESS = "0x9d0C28036AC12d2150a23DE40Bc4A92f7Aa1A79E"; // Replace with your token address
const TOKEN_AMOUNT = "0"; // Amount of tokens to add (set to "0" to auto-calculate based on ETH_AMOUNT)
const ETH_AMOUNT = "0.0321"; // Amount of ETH to add

// Uniswap V2 Router on Base Sepolia
const UNISWAP_V2_ROUTER = "0x1689E7B1F10000AE47eBfE339a4f69dECd19F602";
const UNISWAP_V2_FACTORY = "0x7Ae58f10f7849cA6F5fB71b7f45CB416c9204b1e";

// Uniswap V2 Factory ABI (minimal interface)
const FACTORY_ABI = [
  "function getPair(address tokenA, address tokenB) external view returns (address pair)",
];

// Uniswap V2 Pair ABI (minimal interface)
const PAIR_ABI = [
  "function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)",
  "function token0() external view returns (address)",
  "function token1() external view returns (address)",
];

// Uniswap V2 Router ABI (minimal interface)
const ROUTER_ABI = [
  "function addLiquidityETH(address token, uint amountTokenDesired, uint amountTokenMin, uint amountETHMin, address to, uint deadline) external payable returns (uint amountToken, uint amountETH, uint liquidity)",
  "function WETH() external pure returns (address)",
  "function quote(uint amountA, uint reserveA, uint reserveB) external pure returns (uint amountB)",
];

// ERC20 ABI (minimal interface)
const ERC20_ABI = [
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function allowance(address owner, address spender) external view returns (uint256)",
  "function balanceOf(address account) external view returns (uint256)",
  "function decimals() external view returns (uint8)",
  "function symbol() external view returns (string)",
  "function name() external view returns (string)",
];

async function main() {
  const [deployer] = await ethers.getSigners();

  console.log("╔════════════════════════════════════════════════════════════════╗");
  console.log("║            Add Liquidity to Uniswap V2 (Base Sepolia)        ║");
  console.log("╚════════════════════════════════════════════════════════════════╝");
  console.log();

  // Get network info
  const network = await ethers.provider.getNetwork();
  console.log("Network:", network.name);
  console.log("Chain ID:", network.chainId.toString());
  console.log("Deployer:", deployer.address);
  console.log();

  // Check ETH balance
  const ethBalance = await ethers.provider.getBalance(deployer.address);
  console.log("ETH Balance:", ethers.formatEther(ethBalance), "ETH");

  if (ethBalance < ethers.parseEther(ETH_AMOUNT)) {
    throw new Error("Insufficient ETH balance");
  }
  console.log();

  // Connect to token
  console.log("Token Address:", TOKEN_ADDRESS);
  const token = new ethers.Contract(TOKEN_ADDRESS, ERC20_ABI, deployer);

  const name = await token.name();
  const symbol = await token.symbol();
  const decimals = await token.decimals();
  const tokenBalance = await token.balanceOf(deployer.address);

  console.log("Token Information:");
  console.log("├─ Name:", name);
  console.log("├─ Symbol:", symbol);
  console.log("├─ Decimals:", Number(decimals));
  console.log("└─ Balance:", ethers.formatUnits(tokenBalance, decimals), symbol);
  console.log();

  // Connect to Uniswap V2 Router and Factory
  const router = new ethers.Contract(UNISWAP_V2_ROUTER, ROUTER_ABI, deployer);
  const factory = new ethers.Contract(UNISWAP_V2_FACTORY, FACTORY_ABI, deployer);
  console.log("Uniswap V2 Router:", UNISWAP_V2_ROUTER);
  console.log("Uniswap V2 Factory:", UNISWAP_V2_FACTORY);
  console.log();

  // Determine token amount to use
  let tokenAmountWei: bigint;
  let tokenAmountDisplay: string;

  if (TOKEN_AMOUNT === "0") {
    console.log("Computing required token amount based on ETH amount...");

    // Get WETH address
    const wethAddress = await router.WETH();
    console.log("WETH Address:", wethAddress);

    // Get pair address
    const pairAddress = await factory.getPair(TOKEN_ADDRESS, wethAddress);
    console.log("Pair Address:", pairAddress);

    if (pairAddress === ethers.ZeroAddress) {
      throw new Error("Liquidity pool does not exist. Please specify TOKEN_AMOUNT manually for initial liquidity.");
    }

    // Get reserves
    const pair = new ethers.Contract(pairAddress, PAIR_ABI, deployer);
    const [reserve0, reserve1] = await pair.getReserves();
    const token0 = await pair.token0();

    // Determine which reserve is the token and which is WETH
    const isToken0 = token0.toLowerCase() === TOKEN_ADDRESS.toLowerCase();
    const tokenReserve = isToken0 ? reserve0 : reserve1;
    const wethReserve = isToken0 ? reserve1 : reserve0;

    console.log("Pool Reserves:");
    console.log("├─ Token Reserve:", ethers.formatUnits(tokenReserve, decimals), symbol);
    console.log("└─ WETH Reserve:", ethers.formatEther(wethReserve), "WETH");
    console.log();

    // Calculate required token amount: tokenAmount = (ethAmount * tokenReserve) / wethReserve
    const ethAmountWei = ethers.parseEther(ETH_AMOUNT);
    tokenAmountWei = (ethAmountWei * tokenReserve) / wethReserve;
    tokenAmountDisplay = ethers.formatUnits(tokenAmountWei, decimals);

    console.log("✓ Computed Token Amount:", tokenAmountDisplay, symbol);
    console.log();
  } else {
    tokenAmountWei = ethers.parseUnits(TOKEN_AMOUNT, decimals);
    tokenAmountDisplay = TOKEN_AMOUNT;
    console.log("Using specified TOKEN_AMOUNT:", tokenAmountDisplay, symbol);
    console.log();
  }

  if (tokenBalance < tokenAmountWei) {
    throw new Error(`Insufficient token balance. Need ${tokenAmountDisplay} ${symbol} but have ${ethers.formatUnits(tokenBalance, decimals)} ${symbol}`);
  }

  // Check and approve token spending
  console.log("Checking token allowance...");
  const currentAllowance = await token.allowance(deployer.address, UNISWAP_V2_ROUTER);

  if (currentAllowance < tokenAmountWei) {
    console.log("Approving tokens...");
    const approveTx = await token.approve(UNISWAP_V2_ROUTER, ethers.MaxUint256);
    console.log("Approval transaction:", approveTx.hash);
    await approveTx.wait();
    console.log("✓ Tokens approved");
  } else {
    console.log("✓ Sufficient allowance already set");
  }
  console.log();

  // Add liquidity
  console.log("Adding Liquidity:");
  console.log("├─ Token Amount:", tokenAmountDisplay, symbol);
  console.log("├─ ETH Amount:", ETH_AMOUNT, "ETH");
  console.log("└─ Slippage: 0.5%");
  console.log();

  const amountTokenMin = (tokenAmountWei * 995n) / 1000n; // 0.5% slippage
  const amountETHMin = (ethers.parseEther(ETH_AMOUNT) * 995n) / 1000n; // 0.5% slippage
  const deadline = Math.floor(Date.now() / 1000) + 60 * 20; // 20 minutes

  console.log("Sending transaction...");
  const tx = await router.addLiquidityETH(
    TOKEN_ADDRESS,
    tokenAmountWei,
    amountTokenMin,
    amountETHMin,
    deployer.address,
    deadline,
    { value: ethers.parseEther(ETH_AMOUNT) }
  );

  console.log("Transaction hash:", tx.hash);
  console.log("Waiting for confirmation...");

  const receipt = await tx.wait();
  console.log("✓ Transaction confirmed in block:", receipt?.blockNumber);
  console.log();

  console.log("╔════════════════════════════════════════════════════════════════╗");
  console.log("║                    Liquidity Added Successfully!              ║");
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
