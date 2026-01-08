import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();

  console.log("╔════════════════════════════════════════════════════════════════╗");
  console.log("║              MockERC20 Deployment Script                      ║");
  console.log("╚════════════════════════════════════════════════════════════════╝");
  console.log();
  console.log("Deploying contracts with account:", deployer.address);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("Account balance:", ethers.formatEther(balance), "ETH");
  console.log();

  // Get network info
  const network = await ethers.provider.getNetwork();
  console.log("Network:", network.name);
  console.log("Chain ID:", network.chainId.toString());
  console.log();

  // Deployment parameters
  const TOKEN_NAME = "Mock Token";
  const TOKEN_SYMBOL = "MTK";
  const INITIAL_SUPPLY = ethers.parseUnits("1000000000", 18); // 1 billion tokens

  console.log("Deployment Parameters:");
  console.log("├─ Token Name:", TOKEN_NAME);
  console.log("├─ Token Symbol:", TOKEN_SYMBOL);
  console.log("└─ Initial Supply:", ethers.formatUnits(INITIAL_SUPPLY, 18), TOKEN_SYMBOL);
  console.log();

  // Deploy MockERC20
  console.log("Deploying MockERC20 contract...");
  const MockERC20 = await ethers.getContractFactory("MockERC20");
  const token = await MockERC20.deploy(
    TOKEN_NAME,
    TOKEN_SYMBOL,
    INITIAL_SUPPLY
  );

  await token.waitForDeployment();
  const tokenAddress = await token.getAddress();

  console.log();
  console.log("╔════════════════════════════════════════════════════════════════╗");
  console.log("║                  Deployment Successful!                       ║");
  console.log("╚════════════════════════════════════════════════════════════════╝");
  console.log();
  console.log("MockERC20 deployed to:", tokenAddress);
  console.log();

  // Get token info
  const name = await token.name();
  const symbol = await token.symbol();
  const decimals = await token.decimals();
  const totalSupply = await token.totalSupply();
  const deployerBalance = await token.balanceOf(deployer.address);

  console.log("Token Information:");
  console.log("├─ Name:", name);
  console.log("├─ Symbol:", symbol);
  console.log("├─ Decimals:", Number(decimals));
  console.log("├─ Total Supply:", ethers.formatUnits(totalSupply, decimals), symbol);
  console.log("└─ Deployer Balance:", ethers.formatUnits(deployerBalance, decimals), symbol);
  console.log();

  // Get EIP-712 domain separator
  const domainSeparator = await token.DOMAIN_SEPARATOR();
  console.log("EIP-712 Support:");
  console.log("├─ Domain Separator:", domainSeparator);
  console.log("└─ Permit Support: Enabled (EIP-2612)");
  console.log();

  console.log("Next Steps:");
  console.log("1. Verify the contract:");
  console.log(`   npx hardhat verify --network ${network.name} ${tokenAddress} "${TOKEN_NAME}" "${TOKEN_SYMBOL}" "${INITIAL_SUPPLY.toString()}"`);
  console.log();
  console.log("2. Mint additional tokens (testing only):");
  console.log("   await token.mint(recipientAddress, amount)");
  console.log();
  console.log("3. Use permit for gasless approvals:");
  console.log("   const signature = await owner.signTypedData(domain, permitTypes, permitValue)");
  console.log("   await token.permit(owner, spender, amount, deadline, v, r, s)");
  console.log();

  // Save deployment info
  const deploymentInfo = {
    network: network.name,
    chainId: network.chainId.toString(),
    contract: "MockERC20",
    address: tokenAddress,
    deployer: deployer.address,
    timestamp: new Date().toISOString(),
    parameters: {
      name: TOKEN_NAME,
      symbol: TOKEN_SYMBOL,
      initialSupply: INITIAL_SUPPLY.toString(),
      decimals: Number(decimals)
    },
    features: {
      eip2612: true,
      eip712: true,
      mintable: true
    }
  };

  console.log("Deployment Info (save this):");
  console.log(JSON.stringify(deploymentInfo, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
