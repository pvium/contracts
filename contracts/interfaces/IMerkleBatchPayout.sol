// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IMerkleBatchPayout {
    struct Batch {
        bytes32 batchHash;
        bytes32 merkleRoot;
        address signer;
        address fundingToken;
        uint256 totalFunded;
        uint256 totalCanceled;
        uint256 totalClaimed;
        uint256 createdAt;
        uint256 gracePeriod; // seconds after claimDate user can claim
        uint256 disapprovalDeadline; // seconds before claimDate that the payment can be canceld
        bool exists;
        uint256 claimCount;
        address withdrawalWallet;
    }

    struct Payment {
        bytes32 batchId;
        bytes32 merkleRoot;
        address receiver;
       //  address fundingToken;
        uint256 amount;
        uint256 claimDate;
       //  uint256 claimEnd;
        string memo;
    }

    function createBatch(
        bytes32 batchHash,
        uint256 timestamp,
        address signer,
        bytes32 merkleRoot,
        uint256 gracePeriod,// seconds after claimDate user can claim
        uint256 disapprovalDeadline, //
        address fundingToken,
        uint256 amount,
        address withdrawalWallet,
        bytes calldata signature
    ) external payable returns (bytes32);

    function claimPayment(
        Payment calldata payment,
        bytes32[] calldata merkleProof
    ) external returns(bytes32);

    function cancelClaim(
        Payment calldata payment,
        bytes32[] calldata merkleProof
    ) external;

    function cancelClaimMulti(
        Payment[] calldata payments,
        bytes32[][] calldata merkleProofs
    ) external;

    function withdrawCanceledFunds(bytes32 batchId) external;

    function addFundsToBatch(bytes32 batchId, uint256 amount) external;

    function getBatch(bytes32 batchId) external view returns (Batch memory);
}
