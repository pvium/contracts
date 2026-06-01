import { ethers } from "hardhat";
import { deployConfig } from "./deployUniversalDexRouter";

const ESCROW_BATCH_PAYOUT_ABI = [
  'function getEscrowBatch(bytes32 escrowBatchId) view returns ((bytes32 batchHash, bytes32 externalBatchId, address signer, address fundingToken, uint256 totalFunded, uint256 totalClaimed, uint256 totalWithdrawn, uint256 createdAt, uint256 lockDuration, bool exists, uint256 claimCount, address withdrawalWallet))',
  'function claimed(bytes32 escrowBatchId, bytes32 leaf) view returns (bool)',
];

function getEscrowLeaf(
  scheduledBatchHash: string,
  receiverAddress: string,
  amount: string,
  claimDate: string,
  memo: string,
): string {
  return ethers.keccak256(
    ethers.solidityPacked(
      ['bytes32', 'address', 'uint256', 'uint256', 'string'],
      [scheduledBatchHash, receiverAddress, amount, claimDate, memo],
    ),
  );
}

function getRouterRevertMessage(error: unknown): string {
  const err = error as Record<string, unknown>;
  const data = findRevertData(err);
  if (data) {
    try {
      const parsed = new ethers.Interface([
        'error InvalidEscrowBatchPayoutContract()',
        'error UnsupportedEscrowBatchPayoutContract()',
        'error EscrowBatchDoesNotExist()',
        'error Error(string)',
        'error Panic(uint256)',
      ]).parseError(data);

      if (parsed?.name === 'Error') {
        return parsed.args[0];
      }
      if (parsed?.name === 'Panic') {
        return `Panic(${parsed.args[0].toString()})`;
      }
      if (parsed) {
        return parsed.name;
      }
    } catch {
      // Fall through to nested provider message.
    }
  }

  return getNestedMessage(err) || String(error);
}

function findRevertData(
  value: unknown,
  seen = new Set<unknown>(),
): string | undefined {
  if (!value || typeof value !== 'object' || seen.has(value)) {
    return undefined;
  }
  seen.add(value);

  const record = value as Record<string, unknown>;
  if (typeof record.data === 'string' && record.data !== '0x') {
    return record.data;
  }

  for (const nested of Object.values(record)) {
    const data = findRevertData(nested, seen);
    if (data) {
      return data;
    }
  }

  return undefined;
}

function getNestedMessage(
  value: unknown,
  seen = new Set<unknown>(),
): string | undefined {
  if (!value || typeof value !== 'object' || seen.has(value)) {
    return undefined;
  }
  seen.add(value);

  const record = value as Record<string, unknown>;
  for (const key of ['shortMessage', 'reason', 'message']) {
    if (typeof record[key] === 'string') {
      return record[key];
    }
  }

  for (const nested of Object.values(record)) {
    const message = getNestedMessage(nested, seen);
    if (message) {
      return message;
    }
  }

  return undefined;
}

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
 * Update the supported EscrowBatchPayout contract address
 * @param routerAddress Address of the deployed UniversalDexRouter
 * @param escrowBatchPayoutAddress Address of the EscrowBatchPayout contract
 * @param supported Whether to enable (true) or disable (false) support
 */
export async function updateEscrowBatchContract(
  routerAddress: string,
  escrowBatchPayoutAddress: string,
  supported: boolean
) {
  const [signer] = await ethers.getSigners();

  console.log("╔════════════════════════════════════════════════════════════════╗");
  console.log("║      Updating EscrowBatchPayout Contract Support              ║");
  console.log("╚════════════════════════════════════════════════════════════════╝");
  console.log();

  console.log("Signer:", signer.address);
  console.log("Router Address:", routerAddress);
  console.log("EscrowBatchPayout Address:", escrowBatchPayoutAddress);
  console.log("Action:", supported ? "Enable Support" : "Disable Support");
  console.log();

  const universalDexRouter = await ethers.getContractAt(
    "UniversalDexRouter",
    routerAddress
  );

  const ADMIN_ROLE = await universalDexRouter.ADMIN_ROLE();
  const hasAdminRole = await universalDexRouter.hasRole(ADMIN_ROLE, signer.address);

  if (!hasAdminRole) {
    throw new Error(`Signer ${signer.address} does not have ADMIN_ROLE`);
  }

  console.log("✓ Signer has ADMIN_ROLE");
  console.log();

  const currentSupport = await universalDexRouter.supportEscrowBatchPayoutContracts(
    escrowBatchPayoutAddress
  );
  console.log("Current Support Status:", currentSupport);

  if (currentSupport === supported) {
    console.log(`⚠ EscrowBatchPayout contract is already ${supported ? "supported" : "not supported"}`);
    return;
  }

  console.log("Updating support status...");
  const tx = await universalDexRouter.setSupportedEscrowBatchPayoutContract(
    escrowBatchPayoutAddress,
    supported
  );

  console.log("Transaction hash:", tx.hash);
  console.log("Waiting for confirmation...");

  await tx.wait();

  console.log("✓ Support status updated successfully");
  console.log();

  const newSupport = await universalDexRouter.supportEscrowBatchPayoutContracts(
    escrowBatchPayoutAddress
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
 * Check if an EscrowBatchPayout contract is supported
 * @param routerAddress Address of the deployed UniversalDexRouter
 * @param escrowBatchPayoutAddress Address of the EscrowBatchPayout contract
 */
export async function checkEscrowBatchSupport(
  routerAddress: string,
  escrowBatchPayoutAddress: string
) {
  const universalDexRouter = await ethers.getContractAt(
    "UniversalDexRouter",
    routerAddress
  );

  const isSupported = await universalDexRouter.supportEscrowBatchPayoutContracts(
    escrowBatchPayoutAddress
  );

  console.log("EscrowBatchPayout Contract:", escrowBatchPayoutAddress);
  console.log("Support Status:", isSupported ? "✓ Supported" : "✗ Not Supported");

  return isSupported;
}

export async function claimEscrowPayment(
  routerAddress: string,
  escrowBatchPayoutAddress: string,
  escrowBatchId: string,
  scheduledBatchHash: string,
  merkleRoot: string,
  receiverAddress: string,
  amount: string,
  claimDate: string,
  memo: string,
  rootSignature: string,
  merkleProof: string[],
) {
  const [signer] = await ethers.getSigners();

  console.log(
    '╔════════════════════════════════════════════════════════════════╗',
  );
  console.log(
    '║              Claiming Escrow Payment Through Router           ║',
  );
  console.log(
    '╚════════════════════════════════════════════════════════════════╝',
  );
  console.log();

  console.log('Signer:', signer.address);
  console.log('Router Address:', routerAddress);
  console.log('EscrowBatchPayout Address:', escrowBatchPayoutAddress);
  console.log('Escrow Batch ID:', escrowBatchId);
  console.log('Scheduled Batch Hash:', scheduledBatchHash);
  console.log('Merkle Root:', merkleRoot);
  console.log('Receiver:', receiverAddress);
  console.log('Amount:', amount);
  console.log('Claim Date:', claimDate);
  console.log('Memo:', memo);
  console.log('Root Signature:', rootSignature);
  console.log('Merkle Proof:', merkleProof);
  console.log();

  const universalDexRouter = await ethers.getContractAt(
    'UniversalDexRouter',
    routerAddress,
  );

  const isSupported =
    await universalDexRouter.supportEscrowBatchPayoutContracts(
      escrowBatchPayoutAddress,
    );

  if (!isSupported) {
    throw new Error(
      `EscrowBatchPayout contract ${escrowBatchPayoutAddress} is not supported`,
    );
  }

  console.log('✓ EscrowBatchPayout contract is supported');
  const escrowBatchPayout = new ethers.Contract(
    escrowBatchPayoutAddress,
    ESCROW_BATCH_PAYOUT_ABI,
    ethers.provider,
  );
  const batch = await escrowBatchPayout.getEscrowBatch(escrowBatchId);
  const leaf = getEscrowLeaf(
    scheduledBatchHash,
    receiverAddress,
    amount,
    claimDate,
    memo,
  );
  const alreadyClaimed = await escrowBatchPayout.claimed(escrowBatchId, leaf);

  console.log('Direct Escrow Batch Exists:', batch.exists);
  console.log('Direct Escrow Batch Hash:', batch.batchHash);
  console.log('Direct Escrow Funding Token:', batch.fundingToken);
  console.log('Derived Leaf:', leaf);
  console.log('Already Claimed:', alreadyClaimed);
  console.log();

  try {
    const estimatedGas = await universalDexRouter.claimEscrowPayment.estimateGas(
      escrowBatchPayoutAddress,
      escrowBatchId,
      scheduledBatchHash,
      merkleRoot,
      receiverAddress,
      amount,
      claimDate,
      memo,
      rootSignature,
      merkleProof,
    );
    console.log('Estimated Gas:', estimatedGas.toString());
  } catch (error) {
    throw new Error(
      `claimEscrowPayment gas estimation reverted: ${getRouterRevertMessage(error)}`,
    );
  }

  console.log('Claiming payment...');

  // const tx = await universalDexRouter.claimEscrowPayment(
  //   escrowBatchPayoutAddress,
  //   escrowBatchId,
  //   scheduledBatchHash,
  //   merkleRoot,
  //   receiverAddress,
  //   amount,
  //   claimDate,
  //   memo,
  //   rootSignature,
  //   merkleProof,
  // );

  // console.log('Transaction hash:', tx.hash);
  // console.log('Waiting for confirmation...');

  // const receipt = await tx.wait();

  // console.log('✓ Escrow payment claimed successfully');
  // console.log('Block number:', receipt?.blockNumber);
}

function parseMerkleProof(value?: string): string[] {
  if (!value || value.trim() === '' || value.trim() === '[]') {
    return [];
  }

  const parsed = JSON.parse(value);
  if (
    !Array.isArray(parsed) ||
    parsed.some((item) => typeof item !== 'string')
  ) {
    throw new Error('MERKLE_PROOF must be a JSON array of bytes32 strings');
  }

  return parsed;
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
 * Update escrow batch contract using the network's deployConfig
 * @param routerAddress Address of the deployed UniversalDexRouter
 * @param supported Whether to enable or disable support
 */
export async function updateEscrowBatchFromConfig(
  routerAddress: string,
  supported: boolean
) {
  const network = await ethers.provider.getNetwork();
  const chainId = Number(network.chainId);
  const config = deployConfig[chainId];

  if (!config?.escrowBatchContract) {
    throw new Error(`No EscrowBatchPayout contract configured for chain ID ${chainId}`);
  }

  console.log("Using EscrowBatchPayout from deployConfig:");
  console.log("Chain ID:", chainId);
  console.log("Address:", config.escrowBatchContract);
  console.log();

  await updateEscrowBatchContract(routerAddress, config.escrowBatchContract, supported);
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

/**
 * Enable a new EscrowBatchPayout contract and optionally disable the previous one.
 * The router supports multiple contracts, so "setting" a new one means enabling the
 * new address. Pass oldEscrowBatchPayoutAddress if you also want to disable the prior contract.
 */
export async function setNewEscrowBatchContract(
  routerAddress: string,
  newEscrowBatchPayoutAddress: string,
  oldEscrowBatchPayoutAddress?: string
) {
  console.log("╔════════════════════════════════════════════════════════════════╗");
  console.log("║              Setting New Escrow Batch Contract                ║");
  console.log("╚════════════════════════════════════════════════════════════════╝");
  console.log();

  if (
    oldEscrowBatchPayoutAddress &&
    oldEscrowBatchPayoutAddress.toLowerCase() ===
      newEscrowBatchPayoutAddress.toLowerCase()
  ) {
    throw new Error("OLD_ESCROW_ADDRESS and NEW_ESCROW_ADDRESS must be different");
  }

  await updateEscrowBatchContract(routerAddress, newEscrowBatchPayoutAddress, true);

  if (oldEscrowBatchPayoutAddress) {
    console.log();
    console.log("Disabling previous EscrowBatchPayout contract...");
    await updateEscrowBatchContract(routerAddress, oldEscrowBatchPayoutAddress, false);
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
    console.log(
      '  OPERATION=update-escrow ROUTER_ADDRESS=<address> ESCROW_ADDRESS=<address> SUPPORTED=<true|false>',
    );
    console.log(
      '  OPERATION=update-escrow-config ROUTER_ADDRESS=<address> SUPPORTED=<true|false>',
    );
    console.log(
      '  OPERATION=set-new-escrow ROUTER_ADDRESS=<address> NEW_ESCROW_ADDRESS=<address> [OLD_ESCROW_ADDRESS=<address>]',
    );
    console.log("  OPERATION=update-fee-receiver ROUTER_ADDRESS=<address> FEE_RECEIVER=<address>");
    console.log("  OPERATION=check-role ROUTER_ADDRESS=<address> ADDRESS=<address> ROLE=<ADMIN|DEFAULT_ADMIN>");
    console.log("  OPERATION=check-merkle ROUTER_ADDRESS=<address> MERKLE_ADDRESS=<address>");
    console.log(
      '  OPERATION=check-escrow ROUTER_ADDRESS=<address> ESCROW_ADDRESS=<address>',
    );
    console.log(
      "  OPERATION=claim-escrow ROUTER_ADDRESS=<address> [ESCROW_BATCH_PAYOUT_ADDRESS=<address> ESCROW_BATCH_ID=<bytes32> SCHEDULED_BATCH_HASH=<bytes32> MERKLE_ROOT=<bytes32> RECEIVER_ADDRESS=<address> CLAIM_AMOUNT=<uint256> CLAIM_DATE=<uint256> MEMO=<string> ROOT_SIGNATURE=<bytes> MERKLE_PROOF='[]']",
    );
    console.log();
    console.log("Examples:");
    console.log("  OPERATION=info ROUTER_ADDRESS=0x123... npx hardhat run scripts/operateUniversalDexRouter.ts");
    console.log("  OPERATION=update-merkle ROUTER_ADDRESS=0x123... MERKLE_ADDRESS=0x456... SUPPORTED=true npx hardhat run scripts/operateUniversalDexRouter.ts");
    console.log("  OPERATION=update-merkle-config ROUTER_ADDRESS=0x123... SUPPORTED=true npx hardhat run scripts/operateUniversalDexRouter.ts --network basetest");
    console.log("  OPERATION=set-new-merkle ROUTER_ADDRESS=0x123... NEW_MERKLE_ADDRESS=0x456... OLD_MERKLE_ADDRESS=0x789... npx hardhat run scripts/operateUniversalDexRouter.ts");
    console.log(
      '  OPERATION=set-new-escrow ROUTER_ADDRESS=0x123... NEW_ESCROW_ADDRESS=0x456... OLD_ESCROW_ADDRESS=0x789... npx hardhat run scripts/operateUniversalDexRouter.ts',
    );
    console.log(
      '  OPERATION=claim-escrow ROUTER_ADDRESS=0x123... npx hardhat run scripts/operateUniversalDexRouter.ts --network <network>',
    );
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
    case 'info':
      await getRouterInfo(routerAddress);
      break;

    case 'update-merkle': {
      const merkleAddress = process.env.MERKLE_ADDRESS;
      const supported = process.env.SUPPORTED === 'true';

      if (!merkleAddress) {
        throw new Error('MERKLE_ADDRESS environment variable is required');
      }

      await updateMerkleBatchContract(routerAddress, merkleAddress, supported);
      break;
    }

    case 'update-merkle-config': {
      const supported = process.env.SUPPORTED === 'true';
      await updateMerkleBatchFromConfig(routerAddress, supported);
      break;
    }

    case 'set-new-merkle': {
      const newMerkleAddress = process.env.NEW_MERKLE_ADDRESS;
      const oldMerkleAddress = process.env.OLD_MERKLE_ADDRESS;

      if (!newMerkleAddress) {
        throw new Error('NEW_MERKLE_ADDRESS environment variable is required');
      }

      await setNewMerkleBatchContract(
        routerAddress,
        newMerkleAddress,
        oldMerkleAddress,
      );
      break;
    }

    case 'update-escrow': {
      const escrowAddress = process.env.ESCROW_ADDRESS;
      const supported = process.env.SUPPORTED === 'true';

      if (!escrowAddress) {
        throw new Error('ESCROW_ADDRESS environment variable is required');
      }

      await updateEscrowBatchContract(routerAddress, escrowAddress, supported);
      break;
    }

    case 'update-escrow-config': {
      const supported = process.env.SUPPORTED === 'true';
      await updateEscrowBatchFromConfig(routerAddress, supported);
      break;
    }

    case 'set-new-escrow': {
      const newEscrowAddress = process.env.NEW_ESCROW_ADDRESS;
      const oldEscrowAddress = process.env.OLD_ESCROW_ADDRESS;

      if (!newEscrowAddress) {
        throw new Error('NEW_ESCROW_ADDRESS environment variable is required');
      }

      await setNewEscrowBatchContract(
        routerAddress,
        newEscrowAddress,
        oldEscrowAddress,
      );
      break;
    }

    case 'update-fee-receiver': {
      const feeReceiver = process.env.FEE_RECEIVER;

      if (!feeReceiver) {
        throw new Error('FEE_RECEIVER environment variable is required');
      }

      await updateFeeReceiver(routerAddress, feeReceiver);
      break;
    }

    case 'check-role': {
      const address = process.env.ADDRESS;
      const role = (process.env.ROLE || 'ADMIN') as 'ADMIN' | 'DEFAULT_ADMIN';

      if (!address) {
        throw new Error('ADDRESS environment variable is required');
      }

      await checkRole(routerAddress, address, role);
      break;
    }

    case 'check-merkle': {
      const merkleAddress = process.env.MERKLE_ADDRESS;

      if (!merkleAddress) {
        throw new Error('MERKLE_ADDRESS environment variable is required');
      }

      await checkMerkleBatchSupport(routerAddress, merkleAddress);
      break;
    }

    case 'check-escrow': {
      const escrowAddress = process.env.ESCROW_ADDRESS;

      if (!escrowAddress) {
        throw new Error('ESCROW_ADDRESS environment variable is required');
      }

      await checkEscrowBatchSupport(routerAddress, escrowAddress);
      break;
    }

    case 'claim-escrow': {
      const escrowBatchPayoutAddress =
        process.env.ESCROW_BATCH_PAYOUT_ADDRESS ||
        '0xD8b18a25E2E9cAD74174670Ae2aF6392406e75C6';
      const escrowBatchId =
        process.env.ESCROW_BATCH_ID ||
        '0x077793dcbb4b07586bdf80752c3c6f2daede6c80745597e6943bd88ed8f0bfb5';
      const scheduledBatchHash =
        process.env.SCHEDULED_BATCH_HASH ||
        '0x24dc3e86f773c7e2f773f967fde4e1e1a921bfbce0666622dd4226e11122aba6';
      const merkleRoot =
        process.env.MERKLE_ROOT ||
        '0x8be385f099a11caa35ac9ba0ec212fc4457b6e4a413765265a5ffac41f9b28c3';
      const receiverAddress =
        process.env.RECEIVER_ADDRESS ||
        '0xa7cabe96d97044f74be883d7cf33dd63f574c84e';
      const amount = process.env.CLAIM_AMOUNT || '2000000000000000000';
      const claimDate = process.env.CLAIM_DATE || '1780200000';
      const memo = process.env.MEMO || '';
      const rootSignature =
        process.env.ROOT_SIGNATURE ||
        '0xe77948b2a434a14d595c3337cb80466ee4fcfa9a81bb5913d580eafe963eb8b91256a0aba7caf3294212c828039f06eb4170ad54c5c0726bc3d97f2d45122b111b';
      const merkleProof = parseMerkleProof(process.env.MERKLE_PROOF);

      await claimEscrowPayment(
        routerAddress,
        escrowBatchPayoutAddress,
        escrowBatchId,
        scheduledBatchHash,
        merkleRoot,
        receiverAddress,
        amount,
        claimDate,
        memo,
        rootSignature,
        merkleProof,
      );
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
