// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IEscrowBatchPayout {
    struct EscrowBatch {
        bytes32 batchHash;
        bytes32 externalBatchId;
        address signer;
        address fundingToken;
        uint256 totalFunded;
        uint256 totalClaimed;
        uint256 totalWithdrawn;
        uint256 createdAt;
        uint256 lockDuration;
        bool exists;
        uint256 claimCount;
        address withdrawalWallet;
    }

    struct EscrowPayment {
        // bytes32 escrowBatchId;
        address receiver;
        uint256 amount;
        uint256 claimDate;
        string memo;
    }

     struct PayoutSigner {
        address signer;
        uint256 transactionMax;
        uint256 totalMax;
        uint256 expiration;
        bytes32 salt;
        bytes signature;
    }

    function createEscrow(
        bytes32 externalBatchId,
        uint256 nonce,
        address signer,
        address fundingToken,
        uint256 amount,
        uint256 lockDuration,
        address withdrawalWallet,
        bytes calldata signature
    ) external returns (bytes32);

    function claimPayment(
        EscrowPayment calldata payment,
        bytes32 escrowBatchId,
        bytes32 scheduledBatchHash,
        bytes32 merkleRoot,
        bytes calldata rootSignature,
        bytes32[] calldata merkleProof,
        PayoutSigner calldata signerAuthorization
    ) external returns (bytes32);

    function addFundsToEscrowBatch(bytes32 escrowBatchId, uint256 amount) external;

    function setLockDuration(bytes32 escrowBatchId, uint256 newLockDuration) external;

    function withdrawEscrowFunds(bytes32 escrowBatchId, uint256 amount) external;

    function revokeSigner(bytes32 escrowBatchId, address signer) external;

    function getEscrowBatch(bytes32 escrowBatchId) external view returns (EscrowBatch memory);
}
