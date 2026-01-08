import { toUtf8Bytes } from "ethers";
import { ethers } from "hardhat";

const deployConfig: Record<number, { uniswapV2Router: string; wethAddress: string; feeReciever: string   }>= {
  84532: { // Base Sepolia
    uniswapV2Router: "0x1689E7B1F10000AE47eBfE339a4f69dECd19F602",
    wethAddress: "0x4200000000000000000000000000000000000006",
    feeReciever:  "0x3fd6ecdcd225c3de0e073b337c4cbac5342e2ac8"
  },
  8453: {
    uniswapV2Router: "0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24", // Uniswap V2 Router on Base Mainnet
    wethAddress: "0x4200000000000000000000000000000000000006", // WETH on Base Mainnet
    feeReciever:  "0x8f2909dAE5B09D976c27B3eA3e1A8312646B099F"  
  },
  56: {
    uniswapV2Router: "0x10ED43C718714eb63d5aA57B78B54704E256024E", // PancakeSwap V2 Router on BSC Mainnet
    wethAddress: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c", // WBNB on BSC Mainnet
    feeReciever: "0x8f2909dAE5B09D976c27B3eA3e1A8312646B099F"
  }
}

async function main() {
  const [deployer] = await ethers.getSigners();

  console.log("╔════════════════════════════════════════════════════════════════╗");
  console.log("║         Deploying UniversalDexRouter to Base Sepolia         ║");
  console.log("╚════════════════════════════════════════════════════════════════╝");
  console.log();

  // Get network info
  const network = await ethers.provider.getNetwork();
  console.log("Network:", network.name);
  console.log("Chain ID:", network.chainId.toString());
  console.log("Deployer:", deployer.address);
  console.log();

  // Check balance
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("Deployer Balance:", ethers.formatEther(balance), "ETH");
  console.log();
  let conf = deployConfig[Number(network.chainId.toString())];
  if (!conf) {
    conf = deployConfig[84532];
  }
  console.log("Using configuration for chain ID:", conf);

  
  const UNISWAP_V2_ROUTER = conf.uniswapV2Router; // Uniswap V2 Router
  const WETH_ADDRESS = conf.wethAddress // WETH on Base Sepolia

  // Fee receiver - Update this to your desired address
  const FEE_RECEIVER = conf.feeReciever// Leave empty to use deployer address

  // Set fee receiver to deployer if not specified
  const feeReceiver = FEE_RECEIVER || deployer.address;

  console.log("Constructor Parameters:");
  console.log("├─ Router:", UNISWAP_V2_ROUTER);
  console.log("├─ WETH:", WETH_ADDRESS);
  console.log("├─ Fee Receiver:", feeReceiver);
  console.log("├─ Default Admin:", deployer.address);
  console.log("└─ Admin:", deployer.address);
  console.log();

  // Deploy UniversalDexRouter
  console.log("Deploying UniversalDexRouter...");
  const UniversalDexRouter = await ethers.getContractFactory("UniversalDexRouter");

  const router = await UniversalDexRouter.deploy(
    UNISWAP_V2_ROUTER,
    WETH_ADDRESS,
    feeReceiver,
    deployer.address, // defaultAdmin
    deployer.address  // admin
  );

  await router.waitForDeployment();
  const routerAddress = await router.getAddress();

  console.log("✓ UniversalDexRouter deployed to:", routerAddress);
  console.log();
  console.log("KECC", ethers.keccak256(
    toUtf8Bytes(
      "SwapExecuted(address,address,address,address,uint256,uint256,uint256,string)"
    )
  ));

  // Verify deployment
  console.log("Verifying deployment...");
  const deployedRouter = await router.router();
  const deployedWETH = await router.WETH();
  const deployedFeeReceiver = await router.feeReceiver();

  console.log("Deployed Contract State:");
  console.log("├─ Router:", deployedRouter);
  console.log("├─ WETH:", deployedWETH);
  console.log("└─ Fee Receiver:", deployedFeeReceiver);
  console.log();

  // Check roles
  const DEFAULT_ADMIN_ROLE = await router.DEFAULT_ADMIN_ROLE();
  const ADMIN_ROLE = await router.ADMIN_ROLE();

  const hasDefaultAdmin = await router.hasRole(DEFAULT_ADMIN_ROLE, deployer.address);
  const hasAdmin = await router.hasRole(ADMIN_ROLE, deployer.address);

  console.log("Role Assignments:");
  console.log("├─ DEFAULT_ADMIN_ROLE:", hasDefaultAdmin ? "✓" : "✗");
  console.log("└─ ADMIN_ROLE:", hasAdmin ? "✓" : "✗");
  console.log();

  console.log("╔════════════════════════════════════════════════════════════════╗");
  console.log("║                   Deployment Successful!                      ║");
  console.log("╚════════════════════════════════════════════════════════════════╝");
  console.log();

  console.log("Contract Address:", routerAddress);
  console.log();
  console.log("View on BaseScan:");
  console.log(`https://sepolia.basescan.org/address/${routerAddress}`);
  console.log();

  console.log("To verify on BaseScan, run:");
  console.log(`npx hardhat verify --network basetest ${routerAddress} "${UNISWAP_V2_ROUTER}" "${WETH_ADDRESS}" "${feeReceiver}" "${deployer.address}" "${deployer.address}"`);
  console.log();

  console.log("Save this information:");
  console.log("UNIVERSAL_DEX_ROUTER_ADDRESS=" + routerAddress);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
