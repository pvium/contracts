import { ethers } from "hardhat";

// Configuration - Update these values
// const TOKEN_ADDRESS = "0x9d0C28036AC12d2150a23DE40Bc4A92f7Aa1A79E"; // Token to swap
// const ETH_AMOUNT = "0.0321"; // Exact amount of ETH you want to receive
// const MAX_TOKEN_AMOUNT = "0"; // Max tokens willing to spend (set to "0" to auto-calculate with 1% buffer)
// Uniswap V2 Router on Base Sepolia
// const UNISWAP_V2_ROUTER = "0x1689E7B1F10000AE47eBfE339a4f69dECd19F602";

const TOKEN_ADDRESS = "0x55d398326f99059fF775485246999027B3197955"; // Token to swap
const ETH_AMOUNT = "0"; // Exact amount of ETH you want to receive
const MAX_TOKEN_AMOUNT = "50.25"; // Max tokens willing to spend (set to "0" to auto-calculate with 1% buffer)
const UNISWAP_V2_ROUTER = "0x10ED43C718714eb63d5aA57B78B54704E256024E";

// Uniswap V2 Router ABI (minimal interface)
const ROUTER_ABI = [
  "function swapTokensForExactETH(uint amountOut, uint amountInMax, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)",
  "function WETH() external pure returns (address)",
  "function getAmountsIn(uint amountOut, address[] memory path) external view returns (uint[] memory amounts)",
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
  console.log("║         Swap Tokens for Exact ETH (Base Sepolia)             ║");
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
  console.log("Current ETH Balance:", ethers.formatEther(ethBalance), "ETH");
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

  // Connect to Uniswap V2 Router
  const router = new ethers.Contract(UNISWAP_V2_ROUTER, ROUTER_ABI, deployer);
  console.log("Uniswap V2 Router:", UNISWAP_V2_ROUTER);

  // Get WETH address
  const wethAddress = await router.WETH();
  console.log("WETH Address:", wethAddress);
  console.log();

  // Set up swap path: Token -> WETH
  const path = [wethAddress, TOKEN_ADDRESS ];
  const ethAmountWei = ethers.parseEther(ETH_AMOUNT);
  const tokenAmountInWei = ethers.parseEther(MAX_TOKEN_AMOUNT);

  console.log("Computing required token amount...");
  console.log("Desired ETH Output:", ETH_AMOUNT, "ETH");

  // Get quote: how many tokens needed for exact ETH output
  const amountsIn = await router.getAmountsIn(tokenAmountInWei, path);
  console.log(tokenAmountInWei, path)
  const requiredTokenAmount = amountsIn[0];


  console.log("Required Token Input:", ethers.formatUnits(requiredTokenAmount, decimals), symbol);
  console.log();

 //  swapETHForExactTokens((uint256 amountOutMin, address[] path, address to, uint256 paymentAmount, uint256 deadline, string memo, uint256 nonce)) args: ({"amountOutMin":"5025000000000000355","path":["0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c","0x55d398326f99059fF775485246999027B3197955"],"to":"0x4d8caa7826e8b10b97ef173a282cbf2d772c1131","paymentAmount":"5000000000000000000","deadline":"1767750573","memo":"36349b ","nonce":"0"})

  return;

  // Determine max token amount willing to spend
  let maxTokenAmountWei: bigint;
  let maxTokenDisplay: string;

  if (MAX_TOKEN_AMOUNT === "0") {
    // Add 1% buffer for slippage
    maxTokenAmountWei = (requiredTokenAmount * 101n) / 100n;
    maxTokenDisplay = ethers.formatUnits(maxTokenAmountWei, decimals);
    console.log("Max Token Amount (with 1% buffer):", maxTokenDisplay, symbol);
  } else {
    maxTokenAmountWei = ethers.parseUnits(MAX_TOKEN_AMOUNT, decimals);
    maxTokenDisplay = MAX_TOKEN_AMOUNT;
    console.log("Max Token Amount (specified):", maxTokenDisplay, symbol);
  }
  console.log();

  // Check token balance
  if (tokenBalance < maxTokenAmountWei) {
    throw new Error(
      `Insufficient token balance. Need up to ${maxTokenDisplay} ${symbol} but have ${ethers.formatUnits(tokenBalance, decimals)} ${symbol}`
    );
  }

  // Check and approve token spending
  console.log("Checking token allowance...");
  const currentAllowance = await token.allowance(deployer.address, UNISWAP_V2_ROUTER);

  if (currentAllowance < maxTokenAmountWei) {
    console.log("Approving tokens...");
    const approveTx = await token.approve(UNISWAP_V2_ROUTER, ethers.MaxUint256);
    console.log("Approval transaction:", approveTx.hash);
    await approveTx.wait();
    console.log("✓ Tokens approved");
  } else {
    console.log("✓ Sufficient allowance already set");
  }
  console.log();

  // Execute swap
  console.log("Executing Swap:");
  console.log("├─ Exact ETH Out:", ETH_AMOUNT, "ETH");
  console.log("├─ Max Token In:", maxTokenDisplay, symbol);
  console.log("└─ Recipient:", deployer.address);
  console.log();

  const deadline = Math.floor(Date.now() / 1000) + 60 * 20; // 20 minutes

  console.log("Sending transaction...");
  const tx = await router.swapTokensForExactETH(
    ethAmountWei,
    maxTokenAmountWei,
    path,
    deployer.address,
    deadline
  );

  console.log("Transaction hash:", tx.hash);
  console.log("Waiting for confirmation...");

  const receipt = await tx.wait();
  console.log("✓ Transaction confirmed in block:", receipt?.blockNumber);
  console.log();

  // Get final balances
  const finalEthBalance = await ethers.provider.getBalance(deployer.address);
  const finalTokenBalance = await token.balanceOf(deployer.address);

  console.log("Final Balances:");
  console.log("├─ ETH:", ethers.formatEther(finalEthBalance), "ETH");
  console.log("└─ Token:", ethers.formatUnits(finalTokenBalance, decimals), symbol);
  console.log();

  console.log("╔════════════════════════════════════════════════════════════════╗");
  console.log("║                    Swap Completed Successfully!               ║");
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
