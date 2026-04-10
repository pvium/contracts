// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IMerkleBatchPayout {
    struct Batch {
        bytes32 merkleRoot;
        address signer;
        address fundingToken;
        uint256 totalFunded;
        uint256 totalClaimed;
        uint256 createdAt;
        uint256 creatorWithdrawDate;
        bool exists;
    }

    function createBatch(
        bytes32 batchHash,
        uint256 timestamp,
        address signer,
        bytes32 merkleRoot,
        uint256 creatorWithdrawDate,
        address fundingToken,
        uint256 amount,
        bytes calldata signature
    ) external payable;

    function claimPayment(
        bytes32 batchId,
        address receiverAddress,
        uint256 amount,
        uint256 claimDate,
        string calldata memo,
        bytes32[] calldata merkleProof
    ) external;

    function addFundsToBatch(bytes32 batchId, uint256 amount) external;

    function getBatch(bytes32 batchId) external view returns (Batch memory);
}
