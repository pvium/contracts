import { ethers } from "hardhat";

// Token address
const TOKEN_ADDRESS = "0x7dCEd3bFcC97948a665BB665a5D7eEfdfce39C3A";

// Owner and spender addresses
const OWNER_ADDRESS = "0x0fBC18fCDfB93306152F45afB68dfb04F5711221";
const SPENDER_ADDRESS = "0x1b36D86396510Ba0C5732B7E81dC5A4233727a3a"; // TokenRelay

async function main() {
  const [deployer] = await ethers.getSigners();

  console.log("╔════════════════════════════════════════════════════════════════╗");
  console.log("║              ERC20 Token Management Script                    ║");
  console.log("╚════════════════════════════════════════════════════════════════╝");
  console.log();

  // Get network info
  const network = await ethers.provider.getNetwork();
  console.log("Network:", network.name);
  console.log("Chain ID:", network.chainId.toString());
  console.log();

  // Connect to token
  console.log("Token Address:", TOKEN_ADDRESS);
  const token = await ethers.getContractAt("MockERC20", TOKEN_ADDRESS);
  console.log();

  // Get token info
  const name = await token.name();
  const symbol = await token.symbol();
  const decimals = await token.decimals();
  const totalSupply = await token.totalSupply();

  console.log("Token Information:");
  console.log("├─ Name:", name);
  console.log("├─ Symbol:", symbol);
  console.log("├─ Decimals:", Number(decimals));
  console.log("└─ Total Supply:", ethers.formatUnits(totalSupply, decimals), symbol);
  console.log();

  // Get owner balance
  const ownerBalance = await token.balanceOf(OWNER_ADDRESS);
  console.log("Owner Balance:");
  console.log("├─ Address:", OWNER_ADDRESS);
  console.log("└─ Balance:", ethers.formatUnits(ownerBalance, decimals), symbol);
  console.log();

  // Get allowance
  const allowance = await token.allowance(OWNER_ADDRESS, SPENDER_ADDRESS);
  console.log("Allowance:");
  console.log("├─ Owner:", OWNER_ADDRESS);
  console.log("├─ Spender:", SPENDER_ADDRESS);
  console.log("└─ Allowance:", ethers.formatUnits(allowance, decimals), symbol);
  console.log();

  // Show if permit is supported
  try {
    const domainSeparator = await token.DOMAIN_SEPARATOR();
    const nonce = await token.nonces(OWNER_ADDRESS);
    console.log("EIP-2612 Permit Support:");
    console.log("├─ Domain Separator:", domainSeparator);
    console.log("└─ Owner Nonce:", nonce.toString());
    console.log();
  } catch (e) {
    console.log("EIP-2612 Permit: Not supported");
    console.log();
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
