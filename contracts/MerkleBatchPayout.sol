// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import "./interfaces/IMerkleBatchPayout.sol";


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

    struct ClaimStats {
        uint total;
        uint successful;
        uint canceled;
        uint totalCount;
        uint successfulCount;
        uint canceledCount;
    }



    // Mapping of batchId => Batch info
    mapping(bytes32 => IMerkleBatchPayout.Batch) public batches;

    // Mapping to track claimed payments: batchId => receiver => claimed
    mapping(bytes32 => mapping(bytes32 => bool)) public claimed;

    // Mapping to track disabled payment: batchId => leaf => disabled
    mapping(bytes32 => mapping(bytes32 => bool)) public disabledClaims;
    mapping(bytes32 => uint256) public withdrawnCanceledFunds;
    mapping(address => mapping(address => ClaimStats)) public payeeStatsPerToken;
    mapping(address => mapping(address=>ClaimStats)) public payerStatsPerToken;

    // Events
    event BatchCreated(
        bytes32 indexed batchHash,
        bytes32 indexed batchId,
        bytes32 merkleRoot,
        address indexed signer,
        address  caller,
        address fundingToken,
        uint256 totalFunded,
        uint256 creatorWithdrawDate
    );

    event PaymentClaimed(
        bytes32 indexed batchId,
        address indexed receiver,
        uint256 amount,
        address indexed token,
        string memoac
    );

    event BatchFunded(
        bytes32 indexed batchId,
        bytes32 indexed batchHash,
        address indexed token,
        uint256 amount
    );

    event BatchWithdrawn(
        bytes32 indexed batchId,
        address indexed signer,
        uint256 amount
    );

     event ClaimDisabled(
        bytes32 indexed batchId,
        bytes32 indexed leaf,
        address indexed receiver,
        uint256 timestamp
    );

    /**
     * @dev Create a new batch with direct token funding
     * @param _batchId Hash of the batch data (for verification)
     * @param timestamp Timestamp used in signature
     * @param signer Address who created this batch
     * @param merkleRoot Merkle root of all payments in this batch
     * @param gracePeriod Duration in seconds after which creator cannot withdraw
     * @param disapprovalDeadline Duration in second before claimDate that creator can withdraw
     * @param fundingToken Token to be used for batch payouts
     * @param amount Amount to fund the batch
     * @param signature Signature of (batchHash, merkleRoot, fundingToken, timestamp)
     */
    function createBatch(
        bytes32 _batchId,
        uint256 timestamp,
        address signer,
        bytes32 merkleRoot,
        uint256 gracePeriod,
        uint256 disapprovalDeadline,
        address fundingToken,
        uint256 amount,
        address withdrawalWallet,
        bytes calldata signature
    ) public  nonReentrant returns(bytes32  batchId) {
        require(signer != address(0), "Invalid signer address");
        require(merkleRoot != bytes32(0), "Invalid merkle root");
        require(fundingToken != address(0), "Invalid funding token");
        require(amount > 0, "Amount must be greater than 0");
        require(signer==msg.sender || signature.length > 0, "Only signer can create batch");
        address withdrawer = withdrawalWallet == address(0x0)?signer:withdrawalWallet ;
        // Generate batchId from signer and batchHash
        bytes32 batchHash = keccak256(abi.encode(_batchId, fundingToken, gracePeriod, disapprovalDeadline, timestamp, block.chainid));
        batchId = keccak256(abi.encodePacked(signer, batchHash));
        require(!batches[batchId].exists, "Batch already exists");

        // Verify signature with Ethereum signed message prefix
        if (signature.length > 0) {
            bytes32 messageHash = keccak256(
                abi.encodePacked(batchHash, merkleRoot, withdrawalWallet)
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
        batches[batchId] = IMerkleBatchPayout.Batch({
            batchHash: batchHash,
            merkleRoot: merkleRoot,
            signer: signer,
            fundingToken: fundingToken,
            totalFunded: amount,
            totalCanceled: 0,
            totalClaimed: 0,
            createdAt: block.timestamp,
            gracePeriod: gracePeriod,
            disapprovalDeadline: disapprovalDeadline,
            exists: true,
            claimCount: 0,
            withdrawalWallet: withdrawer
        });

        emit BatchCreated(batchHash, batchId, merkleRoot, signer, msg.sender, fundingToken, amount, disapprovalDeadline);
    }

    function claimPayment(
        IMerkleBatchPayout.Payment calldata payment,
        bytes32[] calldata merkleProof
    ) public nonReentrant returns (bytes32 leaf) {
        IMerkleBatchPayout.Batch storage batch = batches[payment.batchId];
        require(batch.exists, "Batch does not exist");
       uint claimEnd = payment.claimDate+batch.gracePeriod;
        require(block.timestamp >= payment.claimDate, "Payment not yet claimable");
        if(batch.gracePeriod > 0) {
             require(block.timestamp <= claimEnd, "Payment past claim end date");
        }

        // Construct the leaf hash from payment parameters
        // Include batchId to prevent cross-batch proof reuse
        leaf = keccak256(
            abi.encodePacked(batch.batchHash, payment.receiver, payment.amount, payment.claimDate, payment.memo)
        );

        // Check if already claimed before checking funds (better error message)
        require(!claimed[payment.batchId][leaf], "Payment already claimed");
        require(!disabledClaims[payment.batchId][leaf], "Claim disabled");

        // Verify the Merkle proof
        require(
            MerkleProof.verify(merkleProof, batch.merkleRoot, leaf),
            "Invalid merkle proof"
        );

        uint amount = payment.amount;
        // Check if there are sufficient funds
        require(
            batch.totalClaimed + amount <= batch.totalFunded,
            "Insufficient batch funds"
        );

        // Mark as claimed
        claimed[payment.batchId][leaf] = true;
        batch.totalClaimed += amount;
        batch.claimCount++;

        // Transfer the funds
        IERC20(batch.fundingToken).safeTransfer(payment.receiver, amount);

        emit PaymentClaimed(payment.batchId, payment.receiver, amount, batch.fundingToken, payment.memo);
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
        IMerkleBatchPayout.Batch storage batch = batches[batchId];
        require(batch.exists, "Batch does not exist");

        IERC20(batch.fundingToken).safeTransferFrom(
            msg.sender,
            address(this),
            amount
        );

        batch.totalFunded += amount;

        emit BatchFunded(batchId, batch.batchHash, batch.fundingToken, amount);
    }

    /**
     * @dev Withdraw remaining funds from batch (only batch creator, after creatorWithdrawDate)
     * @param batchId ID of the batch to withdraw from
     */
    function withdrawCanceledFunds(bytes32 batchId) external nonReentrant {
        IMerkleBatchPayout.Batch storage batch = batches[batchId];
        require(batch.exists, "Batch does not exist");
        require(batch.signer == msg.sender || batch.withdrawalWallet == msg.sender, "Only batch creator can withdraw");

       //  require(block.timestamp <= batch.creatorWithdrawDate, "Creator withdraw date exceeded");

        uint256 newCanceledFunds = batch.totalCanceled - withdrawnCanceledFunds[batchId];
        require(newCanceledFunds > 0, "No funds to withdraw");

        withdrawnCanceledFunds[batchId] += newCanceledFunds;
        batch.totalClaimed += newCanceledFunds;
        require(batch.totalClaimed <= batch.totalFunded, "Insufficient batch funds");
        address withdrwalAddress = batch.withdrawalWallet;

        if(withdrwalAddress == address(0x0)) {
            withdrwalAddress = batch.signer;
        }
        // Transfer remaining funds to batch creator
        IERC20(batch.fundingToken).safeTransfer(withdrwalAddress,newCanceledFunds);

        emit BatchWithdrawn(batchId, msg.sender, newCanceledFunds);
    }

      function cancelClaimMulti(
        IMerkleBatchPayout.Payment[] calldata payments,
        bytes32[][] calldata merkleProofs
    ) public nonReentrant {
        require(payments.length == merkleProofs.length, "Invalid proof count");
        for(uint i; i < payments.length; i++ ) {
            _cancelClaim(payments[i], merkleProofs[i]);
        }
      }

  
    function cancelClaim(
        IMerkleBatchPayout.Payment calldata payment,
        bytes32[] calldata merkleProof
    ) public nonReentrant {
        _cancelClaim(payment, merkleProof);
    }

    function _cancelClaim(
        IMerkleBatchPayout.Payment calldata payment,
        bytes32[] calldata merkleProof
    ) private {
        IMerkleBatchPayout.Batch storage batch = batches[payment.batchId];
        require(batch.exists, "Batch does not exist");
        require(batch.signer == msg.sender || batch.withdrawalWallet == msg.sender, "Only batch creator can withdraw");

        if(block.timestamp < payment.claimDate ) {
            require( block.timestamp < payment.claimDate - batch.disapprovalDeadline, "Claim grace period not reached");
        } else {
            require( batch.gracePeriod > 0 && block.timestamp > payment.claimDate + batch.gracePeriod, "Claim grace period not reach");
        }

        // Construct the leaf hash from payment parameters
        // Include batchId to prevent cross-batch proof reuse
        bytes32 leaf = keccak256(
            abi.encodePacked(batch.batchHash, payment.receiver, payment.amount, payment.claimDate, payment.memo)
        );
         require(
            MerkleProof.verify(merkleProof, batch.merkleRoot, leaf),
            "Invalid merkle proof"
        );
         require(!disabledClaims[payment.batchId][leaf], "Claim already disabled");
         require(!claimed[payment.batchId][leaf], "Payment already claimed");
        disabledClaims[payment.batchId][leaf] = true;
        batch.totalCanceled += payment.amount;

    
            // payerStatsPerToken[batch.signer][batch.fundingToken].canceled  += amount;
            payerStatsPerToken[batch.signer][batch.fundingToken].canceledCount++;
            payeeStatsPerToken[payment.receiver][batch.fundingToken].canceledCount++;
            payeeStatsPerToken[payment.receiver][batch.fundingToken].canceled+= payment.amount;
        

        emit ClaimDisabled(payment.batchId, leaf, payment.receiver, block.timestamp);
    }

    /**
     * @dev Get batch information
     * @param batchId ID of the batch
     * @return Batch struct containing batch details
     */
    function getBatch(bytes32 batchId) external view returns (IMerkleBatchPayout.Batch memory) {
        return batches[batchId];
    }

    /**
     * @dev Check if a payment has been claimed
     * @param batchId ID of the batch
     * @param leaf Address of the receiver
     * @return True if claimed, false otherwise
     */
    function isClaimed(
        bytes32 batchId,
        bytes32 leaf
    ) external view returns (bool) {
        return claimed[batchId][leaf];
    }

    /**
     * @dev Get remaining funds in a batch
     * @param batchId ID of the batch
     * @return Remaining unclaimed funds
     */
    function getRemainingFunds(bytes32 batchId) external view returns (uint256) {
        IMerkleBatchPayout.Batch storage batch = batches[batchId];
        require(batch.exists, "Batch does not exist");
        
        return batch.totalFunded - batch.totalClaimed;
    }
}
