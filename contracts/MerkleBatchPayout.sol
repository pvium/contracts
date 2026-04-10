// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";


/**
 * @title MerkleBatchPayout
 * @dev A contract for creating and claiming batch payouts using Merkle proofs
 */
contract MerkleBatchPayout is ReentrancyGuard {
    using SafeERC20 for IERC20;

    // Struct for swap configuration when funding a batch
    struct BatchPaySummary {
        uint256 amountIn;
        uint256 amountOut;
        address[] path;
    }

    // Batch information
    struct Batch {
        bytes32 merkleRoot;
        address signer;
        address fundingToken; // Token used to fund this batch
        uint256 totalFunded; // Total amount funded for this batch
        uint256 totalClaimed; // Total amount claimed from this batch
        uint256 createdAt;
        uint256 creatorWithdrawDate; // After this date, creator can withdraw remaining funds
        bool exists;
    }

    // Mapping of batchId => Batch info
    mapping(bytes32 => Batch) public batches;

    // Mapping to track claimed payments: batchId => receiver => claimed
    mapping(bytes32 => mapping(address => bool)) public claimed;

    // Events
    event BatchCreated(
        bytes32 indexed batchHash,
        bytes32 indexed batchId,
        bytes32 merkleRoot,
        address indexed signer,
        address fundingToken,
        uint256 totalFunded,
        uint256 creatorWithdrawDate
    );

    event PaymentClaimed(
        bytes32 indexed batchId,
        address indexed receiver,
        uint256 amount,
        address indexed token,
        string memo
    );

    event BatchFunded(
        bytes32 indexed batchId,
        address indexed token,
        uint256 amount
    );

    event BatchWithdrawn(
        bytes32 indexed batchId,
        address indexed signer,
        uint256 amount
    );

    /**
     * @dev Create a new batch with direct token funding
     * @param batchHash Hash of the batch data (for verification)
     * @param timestamp Timestamp used in signature
     * @param signer Address who created this batch
     * @param merkleRoot Merkle root of all payments in this batch
     * @param creatorWithdrawDate Timestamp after which creator can withdraw remaining funds
     * @param fundingToken Token to be used for batch payouts
     * @param amount Amount to fund the batch
     * @param signature Signature of (batchHash, merkleRoot, fundingToken, timestamp)
     */
    function createBatch(
        bytes32 batchHash,
        uint256 timestamp,
        address signer,
        bytes32 merkleRoot,
        uint256 creatorWithdrawDate,
        address fundingToken,
        uint256 amount,
        bytes calldata signature
    ) external  nonReentrant {
        require(signer != address(0), "Invalid signer address");
        require(merkleRoot != bytes32(0), "Invalid merkle root");
        require(fundingToken != address(0), "Invalid funding token");
        require(amount > 0, "Amount must be greater than 0");
        require(creatorWithdrawDate > block.timestamp, "Creator withdraw date must be in future");
        require(signer==msg.sender || signature.length > 0, "Only signer can create batch");

        // Generate batchId from signer and batchHash
        bytes32 batchId = keccak256(abi.encodePacked(signer, batchHash, block.chainid));
        require(!batches[batchId].exists, "Batch already exists");

        // Verify signature: raw signature without Ethereum prefix
        if (signature.length > 0) {
            bytes32 messageHash = keccak256(
                abi.encodePacked(batchHash, merkleRoot, fundingToken, amount, timestamp)
            );
            address recoveredSigner = ECDSA.recover(messageHash, signature);
            require(recoveredSigner == signer, "Invalid signature");
        }

        // Transfer funding tokens from creator
        IERC20(fundingToken).safeTransferFrom(
            msg.sender,
            address(this),
            amount
        );
       
        // Create the batch
        batches[batchId] = Batch({
            merkleRoot: merkleRoot,
            signer: signer,
            fundingToken: fundingToken,
            totalFunded: amount,
            totalClaimed: 0,
            createdAt: block.timestamp,
            creatorWithdrawDate: creatorWithdrawDate,
            exists: true
        });

        emit BatchCreated(batchHash, batchId, merkleRoot, signer, fundingToken, amount, creatorWithdrawDate);
    }

    /**
     * @dev Internal function to execute swap for batch funding
     * @param summary Swap configuration
     * @param deadline Swap deadline
     * @param expectedOutputToken Expected output token
     * @return amountOut Amount received from swap
     */
    // function _executeSwapForBatch(
    //     BatchPaySummary calldata summary,
    //     uint256 deadline,
    //     address expectedOutputToken
    // ) internal returns (uint256 amountOut) {
    //     require(summary.path.length >= 2, "Invalid swap path");
    //     require(
    //         summary.path[summary.path.length - 1] == expectedOutputToken,
    //         "Swap output mismatch"
    //     );

    //     address tokenIn = summary.path[0];

    //     // Handle ETH input
    //     if (tokenIn == WETH && msg.value > 0) {
    //         // Swap ETH for exact tokens
    //         uint[] memory amounts = IUniswapV2Router(router)
    //             .swapETHForExactTokens{value: summary.amountIn}(
    //             summary.amountOut,
    //             summary.path,
    //             address(this),
    //             deadline
    //         );

    //         // Refund unused ETH
    //         if (amounts[0] < summary.amountIn) {
    //             (bool success, ) = payable(msg.sender).call{
    //                 value: summary.amountIn - amounts[0]
    //             }("");
    //             require(success, "ETH refund failed");
    //         }

    //         amountOut = amounts[amounts.length - 1];
    //     } else {
    //         // Swap tokens for exact tokens
    //         IERC20(tokenIn).safeTransferFrom(
    //             msg.sender,
    //             address(this),
    //             summary.amountIn
    //         );
    //         IERC20(tokenIn).safeIncreaseAllowance(router, summary.amountIn);

    //         uint[] memory amounts = IUniswapV2Router(router)
    //             .swapTokensForExactTokens(
    //             summary.amountOut,
    //             summary.amountIn,
    //             summary.path,
    //             address(this),
    //             deadline
    //         );

    //         // Refund unused tokens
    //         if (amounts[0] < summary.amountIn) {
    //             IERC20(tokenIn).safeTransfer(
    //                 msg.sender,
    //                 summary.amountIn - amounts[0]
    //             );
    //         }

    //         // Revoke approval
    //         IERC20(tokenIn).approve(router, 0);

    //         amountOut = amounts[amounts.length - 1];
    //     }
    // }

    /**
     * @dev Claim a payment from a batch using Merkle proof
     * @param batchId ID of the batch to claim from
     * @param receiverAddress Address of the payment receiver
     * @param amount Amount to be claimed
     * @param claimDate Unix timestamp when payment becomes claimable
     * @param memo Memo string for the payment
     * @param merkleProof Merkle proof validating this payment
     */
    function claimPayment(
        bytes32 batchId,
        address receiverAddress,
        uint256 amount,
        uint256 claimDate,
        string calldata memo,
        bytes32[] calldata merkleProof
    ) external nonReentrant {
        Batch storage batch = batches[batchId];
        require(batch.exists, "Batch does not exist");
        require(!claimed[batchId][receiverAddress], "Payment already claimed");
        require(block.timestamp >= claimDate, "Payment not yet claimable");
        require(
            batch.totalClaimed + amount <= batch.totalFunded,
            "Insufficient batch funds"
        );

        // Construct the leaf hash from payment parameters
        // Include batchId to prevent cross-batch proof reuse
        bytes32 leaf = keccak256(
            abi.encodePacked(batchId, receiverAddress, amount, claimDate, memo)
        );

        // Verify the Merkle proof
        require(
            MerkleProof.verify(merkleProof, batch.merkleRoot, leaf),
            "Invalid merkle proof"
        );

        // Mark as claimed
        claimed[batchId][receiverAddress] = true;
        batch.totalClaimed += amount;

        // Transfer the funds
        IERC20(batch.fundingToken).safeTransfer(receiverAddress, amount);

        emit PaymentClaimed(batchId, receiverAddress, amount, batch.fundingToken, memo);
    }

    /**
     * @dev Add additional funds to an existing batch
     * @param batchId ID of the batch to fund
     * @param amount Amount to add
     */
    function addFundsToBatch(
        bytes32 batchId,
        uint256 amount
    ) external nonReentrant {
        Batch storage batch = batches[batchId];
        require(batch.exists, "Batch does not exist");

        IERC20(batch.fundingToken).safeTransferFrom(
            msg.sender,
            address(this),
            amount
        );

        batch.totalFunded += amount;

        emit BatchFunded(batchId, batch.fundingToken, amount);
    }

    /**
     * @dev Withdraw remaining funds from batch (only batch creator, after creatorWithdrawDate)
     * @param batchId ID of the batch to withdraw from
     */
    function withdrawRemainingFunds(bytes32 batchId) external nonReentrant {
        Batch storage batch = batches[batchId];
        require(batch.exists, "Batch does not exist");
        require(batch.signer == msg.sender, "Only batch creator can withdraw");
        require(block.timestamp >= batch.creatorWithdrawDate, "Creator withdraw date not reached yet");

        uint256 remainingFunds = batch.totalFunded - batch.totalClaimed;
        require(remainingFunds > 0, "No funds to withdraw");

        // Update claimed to prevent re-withdrawal
        batch.totalClaimed = batch.totalFunded;

        // Transfer remaining funds to batch creator
        IERC20(batch.fundingToken).safeTransfer(msg.sender, remainingFunds);

        emit BatchWithdrawn(batchId, msg.sender, remainingFunds);
    }

    /**
     * @dev Get batch information
     * @param batchId ID of the batch
     * @return Batch struct containing batch details
     */
    function getBatch(bytes32 batchId) external view returns (Batch memory) {
        return batches[batchId];
    }

    /**
     * @dev Check if a payment has been claimed
     * @param batchId ID of the batch
     * @param receiver Address of the receiver
     * @return True if claimed, false otherwise
     */
    function isClaimed(
        bytes32 batchId,
        address receiver
    ) external view returns (bool) {
        return claimed[batchId][receiver];
    }

    /**
     * @dev Get remaining funds in a batch
     * @param batchId ID of the batch
     * @return Remaining unclaimed funds
     */
    function getRemainingFunds(bytes32 batchId) external view returns (uint256) {
        Batch storage batch = batches[batchId];
        require(batch.exists, "Batch does not exist");
        return batch.totalFunded - batch.totalClaimed;
    }
}
