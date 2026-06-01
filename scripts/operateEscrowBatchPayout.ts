import { artifacts, ethers } from "hardhat";

type EscrowPaymentInput = {
  receiver: string;
  amount: string;
  claimDate: string;
  memo: string;
};

const ZERO_BYTES32 = "0x0000000000000000000000000000000000000000000000000000000000000000";
const ERC20_ABI = [
  "function balanceOf(address account) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
];
const ERC20_INTERFACE = new ethers.Interface(ERC20_ABI);
const SECP256K1_HALF_ORDER = BigInt(
  "0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0"
);

function getEscrowLeaf(
  scheduledBatchHash: string,
  payment: EscrowPaymentInput
): string {
  return ethers.keccak256(
    ethers.solidityPacked(
      ["bytes32", "address", "uint256", "uint256", "string"],
      [
        scheduledBatchHash,
        payment.receiver,
        payment.amount,
        payment.claimDate,
        payment.memo,
      ]
    )
  );
}

function getRootSigner(batchHash: string, merkleRoot: string, rootSignature: string): string {
  const digest = ethers.keccak256(
    ethers.solidityPacked(["bytes32", "bytes32"], [batchHash, merkleRoot])
  );
  return ethers.recoverAddress(digest, rootSignature);
}

function assertOpenZeppelinRecoverable(signature: string) {
  const parsed = ethers.Signature.from(signature);
  const s = BigInt(parsed.s);

  if (s > SECP256K1_HALF_ORDER) {
    throw new Error(
      "Preflight failed: Invalid root signature. OpenZeppelin ECDSA rejects high-s signatures; re-sign with a canonical low-s signature."
    );
  }
  if (parsed.v !== 27 && parsed.v !== 28) {
    throw new Error(
      `Preflight failed: Invalid root signature v value (${parsed.v}); expected 27 or 28`
    );
  }
}

function hashPair(left: string, right: string): string {
  const [first, second] =
    BigInt(left) <= BigInt(right) ? [left, right] : [right, left];

  return ethers.keccak256(ethers.concat([first, second]));
}

function verifyMerkleProof(leaf: string, merkleRoot: string, merkleProof: string[]): boolean {
  const computedRoot = merkleProof.reduce(
    (computedHash, proofElement) => hashPair(computedHash, proofElement),
    leaf
  );

  return computedRoot.toLowerCase() === merkleRoot.toLowerCase();
}

function getRevertMessage(error: unknown): string {
  const err = error as Record<string, unknown>;
  const data = findRevertData(err);
  if (data) {
    try {
      const parsed = new ethers.Interface([
        "error Error(string)",
        "error Panic(uint256)",
        "error ECDSAInvalidSignature()",
        "error ECDSAInvalidSignatureLength(uint256 length)",
        "error ECDSAInvalidSignatureS(bytes32 s)",
        "error SafeERC20FailedOperation(address token)",
        "error AddressEmptyCode(address target)",
      ]).parseError(data);
      if (parsed?.name === "Error") {
        return parsed.args[0];
      }
      if (parsed?.name === "Panic") {
        return `Panic(${parsed.args[0].toString()})`;
      }
      if (parsed) {
        return `${parsed.name}(${parsed.args.map((arg) => arg.toString()).join(", ")})`;
      }
    } catch {
      // Fall through to provider messages when revert data is not ABI encoded.
    }
  }

  return getNestedMessage(err) || String(error);
}

function findRevertData(value: unknown, seen = new Set<unknown>()): string | undefined {
  if (!value || typeof value !== "object" || seen.has(value)) {
    return undefined;
  }
  seen.add(value);

  const record = value as Record<string, unknown>;
  if (typeof record.data === "string" && record.data !== "0x") {
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

function getNestedMessage(value: unknown, seen = new Set<unknown>()): string | undefined {
  if (!value || typeof value !== "object" || seen.has(value)) {
    return undefined;
  }
  seen.add(value);

  const record = value as Record<string, unknown>;
  for (const key of ["shortMessage", "reason", "message"]) {
    if (typeof record[key] === "string") {
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

async function printBytecodeMatch(contractAddress: string) {
  const artifact = await artifacts.readArtifact("EscrowBatchPayout");
  const deployedCode = await ethers.provider.getCode(contractAddress);
  const localDeployedBytecode = artifact.deployedBytecode;
  const normalizedDeployedCode = stripSolidityMetadata(deployedCode);
  const normalizedLocalBytecode = stripSolidityMetadata(localDeployedBytecode);
  const matchesLocalArtifact =
    deployedCode.toLowerCase() === localDeployedBytecode.toLowerCase();
  const executableCodeMatches =
    normalizedDeployedCode.toLowerCase() === normalizedLocalBytecode.toLowerCase();

  console.log("Deployed Bytecode Matches Local Artifact:", matchesLocalArtifact);
  console.log("Executable Bytecode Matches Local Artifact:", executableCodeMatches);
  console.log("Deployed Bytecode Hash:", ethers.keccak256(deployedCode));
  console.log("Local Artifact Bytecode Hash:", ethers.keccak256(localDeployedBytecode));
  console.log("Deployed Executable Bytecode Hash:", ethers.keccak256(normalizedDeployedCode));
  console.log("Local Executable Bytecode Hash:", ethers.keccak256(normalizedLocalBytecode));
  if (!matchesLocalArtifact) {
    console.log("Deployed Bytecode Length:", deployedCode.length);
    console.log("Local Artifact Bytecode Length:", localDeployedBytecode.length);
    console.log("Deployed Executable Bytecode Length:", normalizedDeployedCode.length);
    console.log("Local Executable Bytecode Length:", normalizedLocalBytecode.length);
  }
}

function stripSolidityMetadata(bytecode: string): string {
  if (!bytecode.startsWith("0x") || bytecode.length < 6) {
    return bytecode;
  }

  const metadataLength = Number.parseInt(bytecode.slice(-4), 16) * 2;
  const metadataStart = bytecode.length - 4 - metadataLength;
  if (metadataStart <= 2 || metadataStart >= bytecode.length - 4) {
    return bytecode;
  }

  return bytecode.slice(0, metadataStart);
}

async function preflightTokenTransfer(
  tokenAddress: string,
  fromAddress: string,
  toAddress: string,
  amount: string
) {
  const data = ERC20_INTERFACE.encodeFunctionData("transfer", [
    toAddress,
    amount,
  ]);

  try {
    const result = await ethers.provider.call({
      from: fromAddress,
      to: tokenAddress,
      data,
    });

    if (result !== "0x") {
      const [success] = ERC20_INTERFACE.decodeFunctionResult("transfer", result);
      if (!success) {
        throw new Error("ERC20 transfer returned false");
      }
    }

    console.log("ERC20 Transfer Simulation:", "passed");
  } catch (error) {
    throw new Error(`Preflight failed: ERC20 transfer simulation reverted: ${getRevertMessage(error)}`);
  }
}

export async function getEscrowBatch(
  escrowBatchPayoutAddress: string,
  escrowBatchId: string
) {
  console.log("╔════════════════════════════════════════════════════════════════╗");
  console.log("║                  EscrowBatchPayout Batch Info                 ║");
  console.log("╚════════════════════════════════════════════════════════════════╝");
  console.log();

  console.log("EscrowBatchPayout Address:", escrowBatchPayoutAddress);
  console.log("Escrow Batch ID:", escrowBatchId);
  console.log();

  const escrowBatchPayout = await ethers.getContractAt(
    "EscrowBatchPayout",
    escrowBatchPayoutAddress
  );
  await printBytecodeMatch(escrowBatchPayoutAddress);
  console.log();

  const batch = await escrowBatchPayout.getEscrowBatch(escrowBatchId);

  console.log("Batch Hash:", batch.batchHash);
  console.log("External Batch ID:", batch.externalBatchId);
  console.log("Signer:", batch.signer);
  console.log("Funding Token:", batch.fundingToken);
  console.log("Total Funded:", batch.totalFunded.toString());
  console.log("Total Claimed:", batch.totalClaimed.toString());
  console.log("Total Withdrawn:", batch.totalWithdrawn.toString());
  console.log("Created At:", batch.createdAt.toString());
  console.log("Lock Duration:", batch.lockDuration.toString());
  console.log("Exists:", batch.exists);
  console.log("Claim Count:", batch.claimCount.toString());
  console.log("Withdrawal Wallet:", batch.withdrawalWallet);

  return batch;
}

export async function claimPayment(
  escrowBatchPayoutAddress: string,
  payment: EscrowPaymentInput,
  escrowBatchId: string,
  scheduledBatchHash: string,
  merkleRoot: string,
  rootSignature: string,
  merkleProof: string[],
  forceSend = false,
  gasLimit = "300000"
) {
  const [signer] = await ethers.getSigners();

  console.log("╔════════════════════════════════════════════════════════════════╗");
  console.log("║                 Claiming EscrowBatchPayout Payment            ║");
  console.log("╚════════════════════════════════════════════════════════════════╝");
  console.log();

  console.log("Signer:", signer.address);
  console.log("EscrowBatchPayout Address:", escrowBatchPayoutAddress);
  console.log("Escrow Batch ID:", escrowBatchId);
  console.log("Scheduled Batch Hash:", scheduledBatchHash);
  console.log("Merkle Root:", merkleRoot);
  console.log("Receiver:", payment.receiver);
  console.log("Amount:", payment.amount);
  console.log("Claim Date:", payment.claimDate);
  console.log("Memo:", payment.memo);
  console.log("Root Signature:", rootSignature);
  console.log("Merkle Proof:", merkleProof);
  console.log();

  const escrowBatchPayout = await ethers.getContractAt(
    "EscrowBatchPayout",
    escrowBatchPayoutAddress
  );
  await printBytecodeMatch(escrowBatchPayoutAddress);
  console.log();

  const batch = await escrowBatchPayout.getEscrowBatch(escrowBatchId);
  if (!batch.exists) {
    throw new Error(`Escrow batch ${escrowBatchId} does not exist`);
  }

  const leaf = getEscrowLeaf(scheduledBatchHash, payment);
  const claimed = await escrowBatchPayout.claimed(escrowBatchId, leaf);
  const currentBlock = await ethers.provider.getBlock("latest");
  const isZeroMerkleRoot = merkleRoot.toLowerCase() === ZERO_BYTES32;
  const recoveredSigner = isZeroMerkleRoot
    ? "skipped for bytes32(0) merkle root"
    : getRootSigner(batch.batchHash, merkleRoot, rootSignature);

  console.log("Batch Hash:", batch.batchHash);
  console.log("Batch Signer:", batch.signer);
  console.log("Recovered Root Signer:", recoveredSigner);
  console.log("Derived Leaf:", leaf);
  console.log("Already Claimed:", claimed);
  console.log("Latest Block Timestamp:", currentBlock?.timestamp);
  console.log();

  if (isZeroMerkleRoot) {
    console.log("Zero Merkle Root Mode:", "enabled");
    console.log("Skipping local root signature and Merkle proof checks.");
    console.log();
  }
  if (!isZeroMerkleRoot && rootSignature === "0x") {
    throw new Error("Preflight failed: Root signature required");
  }
  if (!isZeroMerkleRoot) {
    assertOpenZeppelinRecoverable(rootSignature);
  }
  if ((currentBlock?.timestamp || 0) < Number(payment.claimDate)) {
    throw new Error("Preflight failed: Payment not yet claimable");
  }
  if (!isZeroMerkleRoot && recoveredSigner.toLowerCase() !== batch.signer.toLowerCase()) {
    throw new Error("Preflight failed: Invalid root signature");
  }
  if (claimed) {
    throw new Error("Preflight failed: Payment already claimed");
  }
  if (!isZeroMerkleRoot && !verifyMerkleProof(leaf, merkleRoot, merkleProof)) {
    throw new Error("Preflight failed: Invalid merkle proof");
  }

  const totalCommitted =
    BigInt(batch.totalClaimed.toString()) +
    BigInt(batch.totalWithdrawn.toString()) +
    BigInt(payment.amount);
  if (totalCommitted > BigInt(batch.totalFunded.toString())) {
    throw new Error("Preflight failed: Insufficient escrow funds");
  }

  const fundingToken = new ethers.Contract(batch.fundingToken, ERC20_ABI, ethers.provider);
  const escrowTokenBalance = await fundingToken.balanceOf(escrowBatchPayoutAddress);
  console.log("Escrow Token Balance:", escrowTokenBalance.toString());
  if (BigInt(escrowTokenBalance.toString()) < BigInt(payment.amount)) {
    throw new Error(
      `Preflight failed: Escrow contract token balance is too low (${escrowTokenBalance.toString()})`
    );
  }
  await preflightTokenTransfer(
    batch.fundingToken,
    escrowBatchPayoutAddress,
    payment.receiver,
    payment.amount
  );
  console.log();

  try {
    const estimatedGas = await escrowBatchPayout.claimPayment.estimateGas(
      {
        receiver: payment.receiver,
        amount: payment.amount,
        claimDate: payment.claimDate,
        memo: payment.memo,
      },
      escrowBatchId,
      scheduledBatchHash,
      merkleRoot,
      rootSignature,
      merkleProof
    );
    console.log("Estimated Gas:", estimatedGas.toString());
    console.log();
  } catch (error) {
    if (!forceSend) {
      throw new Error(`claimPayment gas estimation reverted: ${getRevertMessage(error)}`);
    }

    console.log("Gas estimation reverted:", getRevertMessage(error));
    console.log("Force Send:", "enabled");
    console.log("Manual Gas Limit:", gasLimit);
    console.log("The transaction is expected to revert unless the node estimation is wrong.");
    console.log();
  }

  const txOverrides = forceSend ? { gasLimit } : {};
  const tx = await escrowBatchPayout.claimPayment(
    {
      receiver: payment.receiver,
      amount: payment.amount,
      claimDate: payment.claimDate,
      memo: payment.memo,
    },
    escrowBatchId,
    scheduledBatchHash,
    merkleRoot,
    rootSignature,
    merkleProof,
    txOverrides
  );

  console.log("Transaction hash:", tx.hash);
  console.log("Waiting for confirmation...");

  const receipt = await tx.wait();

  console.log("✓ Payment claimed successfully");
  console.log("Block number:", receipt?.blockNumber);

  return receipt;
}

function parseMerkleProof(value?: string): string[] {
  if (!value || value.trim() === "" || value.trim() === "[]") {
    return [];
  }

  const parsed = JSON.parse(value);
  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string")) {
    throw new Error("MERKLE_PROOF must be a JSON array of bytes32 strings");
  }

  return parsed;
}

async function main() {
  const operation = process.env.OPERATION;

  if (!operation) {
    console.log("Usage:");
    console.log("  npx hardhat run scripts/operateEscrowBatchPayout.ts --network <network>");
    console.log();
    console.log("Available operations (set via environment variables):");
    console.log("  OPERATION=get-batch ESCROW_BATCH_PAYOUT_ADDRESS=<address> ESCROW_BATCH_ID=<bytes32>");
    console.log("  OPERATION=claim-payment ESCROW_BATCH_PAYOUT_ADDRESS=<address> ESCROW_BATCH_ID=<bytes32> SCHEDULED_BATCH_HASH=<bytes32> MERKLE_ROOT=<bytes32> RECEIVER_ADDRESS=<address> CLAIM_AMOUNT=<uint256> CLAIM_DATE=<uint256> MEMO=<string> ROOT_SIGNATURE=<bytes> MERKLE_PROOF='[]' [FORCE_SEND=true GAS_LIMIT=300000]");
    console.log();
    console.log("Examples:");
    console.log("  OPERATION=get-batch ESCROW_BATCH_PAYOUT_ADDRESS=0x123... ESCROW_BATCH_ID=0xabc... npx hardhat run scripts/operateEscrowBatchPayout.ts --network <network>");
    console.log("  OPERATION=claim-payment ESCROW_BATCH_PAYOUT_ADDRESS=0x123... ESCROW_BATCH_ID=0xabc... SCHEDULED_BATCH_HASH=0xdef... MERKLE_ROOT=0x456... RECEIVER_ADDRESS=0x789... CLAIM_AMOUNT=1000000000000000000 CLAIM_DATE=1780267981 MEMO='' ROOT_SIGNATURE=0xsig... MERKLE_PROOF='[]' npx hardhat run scripts/operateEscrowBatchPayout.ts --network <network>");
    process.exit(1);
  }

  const network = await ethers.provider.getNetwork();
  console.log("Network:", network.name);
  console.log("Chain ID:", network.chainId.toString());
  console.log();

  switch (operation) {
    case "get-batch": {
      const escrowBatchPayoutAddress = process.env.ESCROW_BATCH_PAYOUT_ADDRESS;
      const escrowBatchId = process.env.ESCROW_BATCH_ID;

      if (!escrowBatchPayoutAddress) {
        throw new Error("ESCROW_BATCH_PAYOUT_ADDRESS environment variable is required");
      }
      if (!escrowBatchId) {
        throw new Error("ESCROW_BATCH_ID environment variable is required");
      }

      await getEscrowBatch(escrowBatchPayoutAddress, escrowBatchId);
      break;
    }

    case "claim-payment": {
      const escrowBatchPayoutAddress =
        process.env.ESCROW_BATCH_PAYOUT_ADDRESS ||
        "0xD8b18a25E2E9cAD74174670Ae2aF6392406e75C6";
      const escrowBatchId =
        process.env.ESCROW_BATCH_ID ||
        "0x077793dcbb4b07586bdf80752c3c6f2daede6c80745597e6943bd88ed8f0bfb5";
      const scheduledBatchHash =
        process.env.SCHEDULED_BATCH_HASH ||
        "0xef2e1dc88c9262b67df33c5c53e60921ce4b55402979bf4abcc8d80d8166d253";
      const merkleRoot =
        process.env.MERKLE_ROOT ||
        "0xa87f6f1a9d322f1f190b35275f8fbd0e407335f114c5f850b145216195dc1cbe";
      const receiverAddress =
        process.env.RECEIVER_ADDRESS ||
        "0xa7cabe96d97044f74be883d7cf33dd63f574c84e";
      const amount = process.env.CLAIM_AMOUNT || "2000000000000000000";
      const claimDate = process.env.CLAIM_DATE || "1780113600";
      const memo = process.env.MEMO || "";
      const rootSignature =
        process.env.ROOT_SIGNATURE ||
        "0x1e615e21ca62071e40f6008774bc7bd4fb5cd8e28b8e0481dd9365b8cb7bd4d26255d87e99b98933b229e78537176ac1f47602f073234120a006e6f42747fa801c";
      const merkleProof = parseMerkleProof(process.env.MERKLE_PROOF);
      const forceSend = process.env.FORCE_SEND === "true";
      const gasLimit = process.env.GAS_LIMIT || "300000";

      await claimPayment(
        escrowBatchPayoutAddress,
        {
          receiver: receiverAddress,
          amount,
          claimDate,
          memo,
        },
        escrowBatchId,
        scheduledBatchHash,
        merkleRoot,
        rootSignature,
        merkleProof,
        forceSend,
        gasLimit
      );
      break;
    }

    default:
      throw new Error(`Unknown operation: ${operation}`);
  }
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
