import { ethers } from "hardhat";
import { deployConfig } from "./deployUniversalDexRouter";

/**
 * Update the supported MerkleBatchPayout contract address
 * @param routerAddress Address of the deployed UniversalDexRouter
 * @param merkleBatchPayoutAddress Address of the MerkleBatchPayout contract
 * @param supported Whether to enable (true) or disable (false) support
 */
export async function updateMerkleBatchContract(
  routerAddress: string,
  merkleBatchPayoutAddress: string,
  supported: boolean
) {
  const [signer] = await ethers.getSigners();

  console.log("╔════════════════════════════════════════════════════════════════╗");
  console.log("║      Updating MerkleBatchPayout Contract Support              ║");
  console.log("╚════════════════════════════════════════════════════════════════╝");
  console.log();

  console.log("Signer:", signer.address);
  console.log("Router Address:", routerAddress);
  console.log("MerkleBatchPayout Address:", merkleBatchPayoutAddress);
  console.log("Action:", supported ? "Enable Support" : "Disable Support");
  console.log();

  const universalDexRouter = await ethers.getContractAt(
    "UniversalDexRouter",
    routerAddress
  );

  // Check if signer has admin role
  const ADMIN_ROLE = await universalDexRouter.ADMIN_ROLE();
  const hasAdminRole = await universalDexRouter.hasRole(ADMIN_ROLE, signer.address);

  if (!hasAdminRole) {
    throw new Error(`Signer ${signer.address} does not have ADMIN_ROLE`);
  }

  console.log("✓ Signer has ADMIN_ROLE");
  console.log();

  // Check current support status
  const currentSupport = await universalDexRouter.supportMerkleBatchPayoutContracts(
    merkleBatchPayoutAddress
  );
  console.log("Current Support Status:", currentSupport);

  if (currentSupport === supported) {
    console.log(`⚠ MerkleBatchPayout contract is already ${supported ? "supported" : "not supported"}`);
    return;
  }

  // Update support
  console.log("Updating support status...");
  const tx = await universalDexRouter.setSupportedMerkleBatchPayoutContract(
    merkleBatchPayoutAddress,
    supported
  );

  console.log("Transaction hash:", tx.hash);
  console.log("Waiting for confirmation...");

  await tx.wait();

  console.log("✓ Support status updated successfully");
  console.log();

  // Verify update
  const newSupport = await universalDexRouter.supportMerkleBatchPayoutContracts(
    merkleBatchPayoutAddress
  );
  console.log("New Support Status:", newSupport);
  console.log();

  console.log("╔════════════════════════════════════════════════════════════════╗");
  console.log("║                   Update Successful!                          ║");
  console.log("╚════════════════════════════════════════════════════════════════╝");
}

/**
 * Update the fee receiver address
 * @param routerAddress Address of the deployed UniversalDexRouter
 * @param newFeeReceiver New fee receiver address
 */
export async function updateFeeReceiver(
  routerAddress: string,
  newFeeReceiver: string
) {
  const [signer] = await ethers.getSigners();

  console.log("╔════════════════════════════════════════════════════════════════╗");
  console.log("║             Updating Fee Receiver Address                     ║");
  console.log("╚════════════════════════════════════════════════════════════════╝");
  console.log();

  console.log("Signer:", signer.address);
  console.log("Router Address:", routerAddress);
  console.log("New Fee Receiver:", newFeeReceiver);
  console.log();

  const universalDexRouter = await ethers.getContractAt(
    "UniversalDexRouter",
    routerAddress
  );

  // Check if signer has admin role
  const ADMIN_ROLE = await universalDexRouter.ADMIN_ROLE();
  const hasAdminRole = await universalDexRouter.hasRole(ADMIN_ROLE, signer.address);

  if (!hasAdminRole) {
    throw new Error(`Signer ${signer.address} does not have ADMIN_ROLE`);
  }

  console.log("✓ Signer has ADMIN_ROLE");
  console.log();

  // Check current fee receiver
  const currentFeeReceiver = await universalDexRouter.feeReceiver();
  console.log("Current Fee Receiver:", currentFeeReceiver);

  if (currentFeeReceiver.toLowerCase() === newFeeReceiver.toLowerCase()) {
    console.log("⚠ Fee receiver is already set to this address");
    return;
  }

  // Update fee receiver
  console.log("Updating fee receiver...");
  const tx = await universalDexRouter.setFeeReceiver(newFeeReceiver);

  console.log("Transaction hash:", tx.hash);
  console.log("Waiting for confirmation...");

  await tx.wait();

  console.log("✓ Fee receiver updated successfully");
  console.log();

  // Verify update
  const verifiedFeeReceiver = await universalDexRouter.feeReceiver();
  console.log("New Fee Receiver:", verifiedFeeReceiver);
  console.log();

  console.log("╔════════════════════════════════════════════════════════════════╗");
  console.log("║                   Update Successful!                          ║");
  console.log("╚════════════════════════════════════════════════════════════════╝");
}

/**
 * Get current router configuration
 * @param routerAddress Address of the deployed UniversalDexRouter
 */
export async function getRouterInfo(routerAddress: string) {
  console.log("╔════════════════════════════════════════════════════════════════╗");
  console.log("║           UniversalDexRouter Configuration                    ║");
  console.log("╚════════════════════════════════════════════════════════════════╝");
  console.log();

  const universalDexRouter = await ethers.getContractAt(
    "UniversalDexRouter",
    routerAddress
  );

  const router = await universalDexRouter.router();
  const weth = await universalDexRouter.WETH();
  const feeReceiver = await universalDexRouter.feeReceiver();
  const maxFeeBps = await universalDexRouter.maxFeeBps();

  console.log("Contract Address:", routerAddress);
  console.log("DEX Router:", router);
  console.log("WETH:", weth);
  console.log("Fee Receiver:", feeReceiver);
  console.log("Max Fee (BPS):", maxFeeBps.toString(), `(${(Number(maxFeeBps) / 100).toFixed(2)}%)`);
  console.log();

  // Get role information
  const DEFAULT_ADMIN_ROLE = await universalDexRouter.DEFAULT_ADMIN_ROLE();
  const ADMIN_ROLE = await universalDexRouter.ADMIN_ROLE();

  console.log("Role Identifiers:");
  console.log("├─ DEFAULT_ADMIN_ROLE:", DEFAULT_ADMIN_ROLE);
  console.log("└─ ADMIN_ROLE:", ADMIN_ROLE);
  console.log();

  // Check network-specific MerkleBatchPayout support
  const network = await ethers.provider.getNetwork();
  const chainId = Number(network.chainId);
  // const config = deployConfig[chainId];

  // if (config?.merkleBatchContract) {
  //   console.log("Network Configuration (Chain ID:", chainId + ")");
  //   console.log("├─ Expected MerkleBatchPayout:", config.merkleBatchContract);

  //   const isSupported = await universalDexRouter.supportMerkleBatchPayoutContracts(
  //     config.merkleBatchContract
  //   );
  //   console.log("└─ Support Status:", isSupported ? "✓ Supported" : "✗ Not Supported");
  //   console.log();
  // }

  return {
    contractAddress: routerAddress,
    router,
    weth,
    feeReceiver,
    maxFeeBps: maxFeeBps.toString(),
  };
}

/**
 * Check if an address has a specific role
 * @param routerAddress Address of the deployed UniversalDexRouter
 * @param address Address to check
 * @param roleName Name of the role ("ADMIN" or "DEFAULT_ADMIN")
 */
export async function checkRole(
  routerAddress: string,
  address: string,
  roleName: "ADMIN" | "DEFAULT_ADMIN" = "ADMIN"
) {
  const universalDexRouter = await ethers.getContractAt(
    "UniversalDexRouter",
    routerAddress
  );

  const role = roleName === "ADMIN"
    ? await universalDexRouter.ADMIN_ROLE()
    : await universalDexRouter.DEFAULT_ADMIN_ROLE();

  const hasRole = await universalDexRouter.hasRole(role, address);

  console.log(`Address ${address} ${hasRole ? "HAS" : "DOES NOT HAVE"} ${roleName}_ROLE`);

  return hasRole;
}

/**
 * Check if a MerkleBatchPayout contract is supported
 * @param routerAddress Address of the deployed UniversalDexRouter
 * @param merkleBatchPayoutAddress Address of the MerkleBatchPayout contract
 */
export async function checkMerkleBatchSupport(
  routerAddress: string,
  merkleBatchPayoutAddress: string
) {
  const universalDexRouter = await ethers.getContractAt(
    "UniversalDexRouter",
    routerAddress
  );

  const isSupported = await universalDexRouter.supportMerkleBatchPayoutContracts(
    merkleBatchPayoutAddress
  );

  console.log("MerkleBatchPayout Contract:", merkleBatchPayoutAddress);
  console.log("Support Status:", isSupported ? "✓ Supported" : "✗ Not Supported");

  return isSupported;
}

/**
 * Update merkle batch contract using the network's deployConfig
 * @param routerAddress Address of the deployed UniversalDexRouter
 * @param supported Whether to enable or disable support
 */
export async function updateMerkleBatchFromConfig(
  routerAddress: string,
  supported: boolean
) {
  const network = await ethers.provider.getNetwork();
  const chainId = Number(network.chainId);
  const config = deployConfig[chainId];

  if (!config?.merkleBatchContract) {
    throw new Error(`No MerkleBatchPayout contract configured for chain ID ${chainId}`);
  }

  console.log("Using MerkleBatchPayout from deployConfig:");
  console.log("Chain ID:", chainId);
  console.log("Address:", config.merkleBatchContract);
  console.log();

  await updateMerkleBatchContract(routerAddress, config.merkleBatchContract, supported);
}

/**
 * Enable a new MerkleBatchPayout contract and optionally disable the previous one.
 * The router supports multiple contracts, so "setting" a new one means enabling the
 * new address. Pass oldMerkleBatchPayoutAddress if you also want to disable the prior contract.
 */
export async function setNewMerkleBatchContract(
  routerAddress: string,
  newMerkleBatchPayoutAddress: string,
  oldMerkleBatchPayoutAddress?: string
) {
  console.log("╔════════════════════════════════════════════════════════════════╗");
  console.log("║              Setting New Merkle Batch Contract                ║");
  console.log("╚════════════════════════════════════════════════════════════════╝");
  console.log();

  if (
    oldMerkleBatchPayoutAddress &&
    oldMerkleBatchPayoutAddress.toLowerCase() ===
      newMerkleBatchPayoutAddress.toLowerCase()
  ) {
    throw new Error("OLD_MERKLE_ADDRESS and NEW_MERKLE_ADDRESS must be different");
  }

  await updateMerkleBatchContract(routerAddress, newMerkleBatchPayoutAddress, true);

  if (oldMerkleBatchPayoutAddress) {
    console.log();
    console.log("Disabling previous MerkleBatchPayout contract...");
    await updateMerkleBatchContract(routerAddress, oldMerkleBatchPayoutAddress, false);
  }
}

// Main function for CLI usage
async function main() {
  const operation = process.env.OPERATION;

  if (!operation) {
    console.log("Usage:");
    console.log("  npx hardhat run scripts/operateUniversalDexRouter.ts --network <network>");
    console.log();
    console.log("Available operations (set via environment variables):");
    console.log("  OPERATION=info ROUTER_ADDRESS=<address>");
    console.log("  OPERATION=update-merkle ROUTER_ADDRESS=<address> MERKLE_ADDRESS=<address> SUPPORTED=<true|false>");
    console.log("  OPERATION=update-merkle-config ROUTER_ADDRESS=<address> SUPPORTED=<true|false>");
    console.log("  OPERATION=set-new-merkle ROUTER_ADDRESS=<address> NEW_MERKLE_ADDRESS=<address> [OLD_MERKLE_ADDRESS=<address>]");
    console.log("  OPERATION=update-fee-receiver ROUTER_ADDRESS=<address> FEE_RECEIVER=<address>");
    console.log("  OPERATION=check-role ROUTER_ADDRESS=<address> ADDRESS=<address> ROLE=<ADMIN|DEFAULT_ADMIN>");
    console.log("  OPERATION=check-merkle ROUTER_ADDRESS=<address> MERKLE_ADDRESS=<address>");
    console.log();
    console.log("Examples:");
    console.log("  OPERATION=info ROUTER_ADDRESS=0x123... npx hardhat run scripts/operateUniversalDexRouter.ts");
    console.log("  OPERATION=update-merkle ROUTER_ADDRESS=0x123... MERKLE_ADDRESS=0x456... SUPPORTED=true npx hardhat run scripts/operateUniversalDexRouter.ts");
    console.log("  OPERATION=update-merkle-config ROUTER_ADDRESS=0x123... SUPPORTED=true npx hardhat run scripts/operateUniversalDexRouter.ts --network basetest");
    console.log("  OPERATION=set-new-merkle ROUTER_ADDRESS=0x123... NEW_MERKLE_ADDRESS=0x456... OLD_MERKLE_ADDRESS=0x789... npx hardhat run scripts/operateUniversalDexRouter.ts");
    process.exit(1);
  }

  const routerAddress = process.env.ROUTER_ADDRESS;

  if (!routerAddress) {
    throw new Error("ROUTER_ADDRESS environment variable is required");
  }

  const network = await ethers.provider.getNetwork();
  console.log("Network:", network.name);
  console.log("Chain ID:", network.chainId.toString());
  console.log();

  switch (operation) {
    case "info":
      await getRouterInfo(routerAddress);
      break;

    case "update-merkle": {
      const merkleAddress = process.env.MERKLE_ADDRESS;
      const supported = process.env.SUPPORTED === "true";

      if (!merkleAddress) {
        throw new Error("MERKLE_ADDRESS environment variable is required");
      }

      await updateMerkleBatchContract(routerAddress, merkleAddress, supported);
      break;
    }

    case "update-merkle-config": {
      const supported = process.env.SUPPORTED === "true";
      await updateMerkleBatchFromConfig(routerAddress, supported);
      break;
    }

    case "set-new-merkle": {
      const newMerkleAddress = process.env.NEW_MERKLE_ADDRESS;
      const oldMerkleAddress = process.env.OLD_MERKLE_ADDRESS;

      if (!newMerkleAddress) {
        throw new Error("NEW_MERKLE_ADDRESS environment variable is required");
      }

      await setNewMerkleBatchContract(
        routerAddress,
        newMerkleAddress,
        oldMerkleAddress
      );
      break;
    }

    case "update-fee-receiver": {
      const feeReceiver = process.env.FEE_RECEIVER;

      if (!feeReceiver) {
        throw new Error("FEE_RECEIVER environment variable is required");
      }

      await updateFeeReceiver(routerAddress, feeReceiver);
      break;
    }

    case "check-role": {
      const address = process.env.ADDRESS;
      const role = (process.env.ROLE || "ADMIN") as "ADMIN" | "DEFAULT_ADMIN";

      if (!address) {
        throw new Error("ADDRESS environment variable is required");
      }

      await checkRole(routerAddress, address, role);
      break;
    }

    case "check-merkle": {
      const merkleAddress = process.env.MERKLE_ADDRESS;

      if (!merkleAddress) {
        throw new Error("MERKLE_ADDRESS environment variable is required");
      }

      await checkMerkleBatchSupport(routerAddress, merkleAddress);
      break;
    }

    default:
      throw new Error(`Unknown operation: ${operation}`);
  }
}

// Only run main if this file is executed directly
if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}


/**
 * 
 * FundingSigParams [
  '0x803f034f89a54160909e809ec1af42e000000000000000000000000000000000',
  '0x73998073a749a87c1a2cfffc56846d4d9fc5d93b50893a29c15e89d986302565',
  '0x7dCEd3bFcC97948a665BB665a5D7eEfdfce39C3A',
  10000000000000000000n,
  1775838920
]
 */
