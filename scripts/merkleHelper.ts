import { ethers } from "hardhat";
import { MerkleTree } from "merkletreejs";
import keccak256 from "keccak256";

/**
 * Payment entry for a batch
 */
export interface PaymentEntry {
  receiverAddress: string;
  amount: string; // Use string to handle big numbers
  claimableDate: number; // Unix timestamp
  memo: string;
}

/**
 * Generate a leaf hash from payment parameters
 * Must match the contract's leaf generation: keccak256(abi.encodePacked(...))
 * Includes batchId to prevent cross-batch proof reuse
 */
export function generateLeafHash(batchId: string, entry: PaymentEntry): Buffer {
  const encoded = ethers.solidityPacked(
    ["bytes32", "address", "uint256", "uint256", "string"],
    [batchId, entry.receiverAddress, entry.amount, entry.claimableDate, entry.memo]
  );
  return Buffer.from(keccak256(encoded));
}

/**
 * Generate Merkle tree from payment entries
 * Note: batchId must be known before generating the tree
 */
export function generateMerkleTree(batchId: string, payments: PaymentEntry[]): MerkleTree {
  const leaves = payments.map((payment) => generateLeafHash(batchId, payment));
  const tree = new MerkleTree(leaves, keccak256, { sortPairs: true });
  return tree;
}

/**
 * Get Merkle root from tree
 */
export function getMerkleRoot(tree: MerkleTree): string {
  return "0x" + tree.getRoot().toString("hex");
}

/**
 * Get Merkle proof for a specific payment
 */
export function getMerkleProof(
  tree: MerkleTree,
  batchId: string,
  payment: PaymentEntry
): string[] {
  const leaf = generateLeafHash(batchId, payment);
  const proof = tree.getHexProof(leaf);
  return proof;
}

/**
 * Verify a Merkle proof
 */
export function verifyMerkleProof(
  proof: string[],
  root: string,
  batchId: string,
  payment: PaymentEntry
): boolean {
  const leaf = generateLeafHash(batchId, payment);
  const tree = new MerkleTree([], keccak256, { sortPairs: true });
  return tree.verify(proof, leaf, root);
}

/**
 * Generate batch hash from payment entries and salt
 */
export function generateBatchHash(
  payments: PaymentEntry[],
  salt: string
): string {
  const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
    [
      "bytes32",
      "tuple(address receiverAddress, uint256 amount, uint256 claimableDate, string memo)[]",
    ],
    [
      ethers.id(salt), // Convert salt to bytes32
      payments.map((p) => ({
        receiverAddress: p.receiverAddress,
        amount: p.amount,
        claimableDate: p.claimableDate,
        memo: p.memo,
      })),
    ]
  );
  return ethers.keccak256(encoded);
}

/**
 * Sign batch hash with signer
 */
export async function signBatchHash(
  batchHash: string,
  merkleRoot: string,
  fundingToken: string,
  fundingAmount: bigint,
  timestamp: number,
  signer: ethers.Signer
): Promise<string> {
  const packed = ethers.solidityPacked(
    ["bytes32", "bytes32", "address", "uint256", "uint256"],
    [batchHash, merkleRoot, fundingToken, fundingAmount, timestamp]
  );
  const messageHash = ethers.keccak256(packed);
  // Note: ethers.Signer.signMessage automatically prefixes with "\x19Ethereum Signed Message:\n32"
  const signature = await signer.signMessage(ethers.getBytes(messageHash));
  return signature;
}

/**
 * Generate complete batch data for contract interaction
 */
export async function generateBatchData(
  payments: PaymentEntry[],
  salt: string,
  signer: ethers.Signer,
  fundingToken: string,
  fundingAmount: bigint,
  timestamp: number,
  chainId: number
) {
  // Generate batch hash
  const batchHash = generateBatchHash(payments, salt);

  // Get signer address
  const signerAddress = await signer.getAddress();

  // Calculate batchId (needed for leaf generation)
  const batchId = ethers.keccak256(
    ethers.solidityPacked(["address", "bytes32", "uint256"], [signerAddress, batchHash, chainId])
  );

  // Generate merkle tree (now with batchId)
  const tree = generateMerkleTree(batchId, payments);
  const merkleRoot = getMerkleRoot(tree);

  // Sign the batch
  const signature = await signBatchHash(
    batchHash,
    merkleRoot,
    fundingToken,
    fundingAmount,
    timestamp,
    signer
  );

  return {
    batchHash,
    merkleRoot,
    signature,
    signerAddress,
    batchId,
    tree,
  };
}

/**
 * Get proof for a specific payment in a batch
 */
export function getPaymentProof(
  tree: MerkleTree,
  batchId: string,
  payment: PaymentEntry
): string[] {
  return getMerkleProof(tree, batchId, payment);
}

/**
 * Example usage
 */
export async function exampleUsage() {
  // Example payments
  const payments: PaymentEntry[] = [
    {
      receiverAddress: "0x1234567890123456789012345678901234567890",
      amount: ethers.parseEther("100").toString(),
      claimableDate: Math.floor(Date.now() / 1000) + 86400, // 1 day from now
      memo: "Payment 1",
    },
    {
      receiverAddress: "0x2234567890123456789012345678901234567890",
      amount: ethers.parseEther("200").toString(),
      claimableDate: Math.floor(Date.now() / 1000) + 86400 * 2, // 2 days from now
      memo: "Payment 2",
    },
    {
      receiverAddress: "0x3234567890123456789012345678901234567890",
      amount: ethers.parseEther("150").toString(),
      claimableDate: Math.floor(Date.now() / 1000) + 86400 * 3, // 3 days from now
      memo: "Payment 3",
    },
  ];

  // Get signer (in real usage, this would be your wallet)
  const [signer] = await ethers.getSigners();

  // Contract address (replace with actual deployed address)
  const contractAddress = "0x0000000000000000000000000000000000000000";
  const chainId = 1; // Mainnet

  // Calculate total funding amount
  const totalFundingAmount = payments.reduce(
    (sum, payment) => sum + BigInt(payment.amount),
    0n
  );

  // Generate batch data
  const batchData = await generateBatchData(
    payments,
    "unique-salt-123",
    signer,
    contractAddress,
    totalFundingAmount,
    Math.floor(Date.now() / 1000),
    chainId
  );

  console.log("Batch ID:", batchData.batchId);
  console.log("Merkle Root:", batchData.merkleRoot);
  console.log("Batch Hash:", batchData.batchHash);
  console.log("Signature:", batchData.signature);

  // Get proof for first payment
  const proof = getPaymentProof(batchData.tree, batchData.batchId, payments[0]);
  console.log("Proof for payment 1:", proof);

  // Verify proof
  const isValid = verifyMerkleProof(proof, batchData.merkleRoot, batchData.batchId, payments[0]);
  console.log("Proof valid:", isValid);

  return {
    payments,
    batchData,
    proofs: payments.map((p) => getPaymentProof(batchData.tree, batchData.batchId, p)),
  };
}

// Export for use in other scripts
export default {
  generateLeafHash,
  generateMerkleTree,
  getMerkleRoot,
  getMerkleProof,
  verifyMerkleProof,
  generateBatchHash,
  signBatchHash,
  generateBatchData,
  getPaymentProof,
  exampleUsage,
};
