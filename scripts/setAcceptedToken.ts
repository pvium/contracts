import { ethers } from "hardhat";

async function main() {
//   const [routerArg, tokenArg, acceptedArg] = process.argv.slice(2);
  const routerAddress = "0x36b248D633f8656E81B92f91f4666d452aB6C9F0"
  const tokenAddress = "0x7dCEd3bFcC97948a665BB665a5D7eEfdfce39C3A";
  const accepted = true;

  if (!routerAddress || !tokenAddress) {
    console.log("Usage:");
    console.log("ROUTER_ADDRESS=<router> TOKEN_ADDRESS=<token> ACCEPTED=true npx hardhat run scripts/setAcceptedToken.ts --network <network>");
    console.log("Or, if your Hardhat version supports script args:");
    console.log("npx hardhat run scripts/setAcceptedToken.ts --network <network> -- <routerAddress> <tokenAddress> [accepted]");
    process.exit(1);
  }

  const [signer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();

  console.log("╔════════════════════════════════════════════════════════════════╗");
  console.log("║          UniversalDexRouter Accepted Token Update            ║");
  console.log("╚════════════════════════════════════════════════════════════════╝");
  console.log();
  console.log("Network:", network.name);
  console.log("Chain ID:", network.chainId.toString());
  console.log("Signer:", signer.address);
  console.log("Router:", routerAddress);
  console.log("Token:", tokenAddress);
  console.log("Accepted:", accepted);
  console.log();

  const balance = await ethers.provider.getBalance(signer.address);
  console.log("Signer Balance:", ethers.formatEther(balance), "ETH");
  console.log();

  const UniversalDexRouter = await ethers.getContractFactory("UniversalDexRouter");
  const router = UniversalDexRouter.attach(routerAddress);

  const currentStatus = await router.acceptedTokens(tokenAddress);
  console.log("Current accepted status:", currentStatus);

  if (currentStatus === accepted) {
    console.log("No update required.");
    return;
  }

  console.log("Sending transaction...");
  const tx = await router.setAcceptedToken(tokenAddress, accepted);
  console.log("Transaction hash:", tx.hash);

  const receipt = await tx.wait();
  console.log("Confirmed in block:", receipt?.blockNumber);

  const updatedStatus = await router.acceptedTokens(tokenAddress);
  console.log();
  console.log("Updated accepted status:", updatedStatus);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });