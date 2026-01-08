import { ethers } from "hardhat";

// TokenRelay contract address
const TOKEN_RELAY_ADDRESS = "0x1b36D86396510Ba0C5732B7E81dC5A4233727a3a";

// Token to add as supported
 const MOCK_ERC20_ADDRESS = "0x7dCEd3bFcC97948a665BB665a5D7eEfdfce39C3A"; //USDC
//const MOCK_ERC20_ADDRESS = "0x9d0C28036AC12d2150a23DE40Bc4A92f7Aa1A79E"; //USDT

async function main() {
  const [deployer] = await ethers.getSigners();

  console.log("╔════════════════════════════════════════════════════════════════╗");
  console.log("║           TokenRelay Management Script                       ║");
  console.log("╚════════════════════════════════════════════════════════════════╝");
  console.log();
  console.log("Managing TokenRelay with account:", deployer.address);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("Account balance:", ethers.formatEther(balance), "ETH");
  console.log();

  // Get network info
  const network = await ethers.provider.getNetwork();
  console.log("Network:", network.name);
  console.log("Chain ID:", network.chainId.toString());
  console.log();

  // Connect to TokenRelay contract
  console.log("Connecting to TokenRelay at:", TOKEN_RELAY_ADDRESS);
  const TokenRelay = await ethers.getContractFactory("TokenRelay");
  const relay = TokenRelay.attach(TOKEN_RELAY_ADDRESS);
  console.log();

  // Add token to supported list
  // console.log("Adding token to supported list...");
  // const tx = await relay.addSupportedToken(MOCK_ERC20_ADDRESS);
  // console.log("Transaction hash:", tx.hash);

  // console.log("Waiting for confirmation...");
  // const receipt = await tx.wait();
  // console.log("Transaction confirmed in block:", receipt.blockNumber);
  // console.log();

  // Verify token was added
  const isNowSupported = await relay.isTokenSupported(MOCK_ERC20_ADDRESS);
  console.log("╔════════════════════════════════════════════════════════════════╗");
  console.log("║                    Operation Successful!                      ║");
  console.log("╚════════════════════════════════════════════════════════════════╝");
  console.log();
  console.log("Token Status After Update:");
  console.log("├─ Token Address:", MOCK_ERC20_ADDRESS);
  console.log("└─ Is Supported:", isNowSupported);
  console.log();

  if (isNowSupported) {
    console.log("✓ Token successfully added to supported tokens list");
  } else {
    console.log("❌ Token was not added. Please check transaction logs.");
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
