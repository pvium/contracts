// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import "./interfaces/IEscrowBatchPayout.sol";

/**
 * @title EscrowBatchPayout
 * @dev Funds an escrow batch once and allows the payout signer to authorize
 *      many off-chain Merkle roots against that escrow without pre-registering them.
 */
contract EscrowBatchPayout is ReentrancyGuard {
    using SafeERC20 for IERC20;

    mapping(bytes32 => IEscrowBatchPayout.EscrowBatch) public escrowBatches;
    mapping(bytes32 => mapping(bytes32 => bool)) public claimed;
    mapping(bytes32 => mapping(address => bool)) public revokedSigners;
    mapping(bytes32 => mapping(address => uint256)) public signerSpent;

    event EscrowBatchCreated(
        bytes32 indexed escrowBatchHash,
        bytes32 indexed escrowBatchId,
        address indexed signer,
        address caller,
        address fundingToken,
        uint256 totalFunded,
        uint256 lockDuration
    );

    event EscrowBatchFunded(
        bytes32 indexed escrowBatchId,
        bytes32 indexed escrowBatchHash,
        address indexed token,
        uint256 amount
    );

    event EscrowPaymentClaimed(
        bytes32 indexed escrowBatchId,
        address indexed receiver,
        uint256 amount,
        address token,
        string memo,
        address authorizedSigner
    );

    event SignerRevoked(
        bytes32 indexed escrowBatchId,
        address indexed signer,
        address indexed caller
    );

    event EscrowFundsWithdrawn(
        bytes32 indexed escrowBatchId,
        address indexed caller,
        address indexed withdrawalWallet,
        uint256 amount
    );

    event EscrowLockDurationSet(
        bytes32 indexed escrowBatchId,
        uint256 previousLockDuration,
        uint256 newLockDuration
    );

    function createEscrow(
        bytes32 externalBatchId,
        uint256 nonce,
        address signer,
        address fundingToken,
        uint256 amount,
        uint256 lockDuration,
        address withdrawalWallet,
        bytes calldata signature
    ) external nonReentrant returns (bytes32 escrowBatchId) {
        require(externalBatchId != bytes32(0), "Invalid external batch id");
        require(signer != address(0), "Invalid signer address");
        require(fundingToken != address(0), "Invalid funding token");
        require(amount > 0, "Amount must be greater than 0");
        require(lockDuration > 0, "Invalid lock duration");
        require(signer == msg.sender || signature.length > 0, "Only signer can create escrow");

        bytes32 escrowBatchHash = keccak256(
            abi.encode(externalBatchId, fundingToken, lockDuration, nonce, block.chainid)
        );
        escrowBatchId = keccak256(abi.encodePacked(signer, escrowBatchHash));
        require(!escrowBatches[escrowBatchId].exists, "Escrow batch already exists");

        if (signature.length > 0) {
            bytes32 messageHash = keccak256(
                abi.encodePacked(escrowBatchHash, withdrawalWallet)
            );
            address recoveredSigner = ECDSA.recover(messageHash, signature);
            require(recoveredSigner == signer, "Invalid signature");
        }

        IERC20(fundingToken).safeTransferFrom(msg.sender, address(this), amount);

        address withdrawer = withdrawalWallet == address(0) ? signer : withdrawalWallet;
        escrowBatches[escrowBatchId] = IEscrowBatchPayout.EscrowBatch({
            batchHash: escrowBatchHash,
            externalBatchId: externalBatchId,
            signer: signer,
            fundingToken: fundingToken,
            totalFunded: amount,
            totalClaimed: 0,
            totalWithdrawn: 0,
            createdAt: block.timestamp,
            lockDuration: lockDuration,
            exists: true,
            claimCount: 0,
            withdrawalWallet: withdrawer
        });

        emit EscrowBatchCreated(
            escrowBatchHash,
            escrowBatchId,
            signer,
            msg.sender,
            fundingToken,
            amount,
            lockDuration
        );
    }

    function claimPayment(
        IEscrowBatchPayout.EscrowPayment calldata payment,
        bytes32 escrowBatchId,
        bytes32 scheduledBatchHash,
        bytes32 merkleRoot,
        bytes calldata rootSignature,
        bytes32[] calldata merkleProof,
        IEscrowBatchPayout.PayoutSigner calldata signerAuthorization
    ) external nonReentrant returns (bytes32 leaf) {
        IEscrowBatchPayout.EscrowBatch storage batch = escrowBatches[
            escrowBatchId
        ];
        require(batch.exists, "Escrow batch does not exist");
        require(merkleRoot != bytes32(0), "Invalid merkle root");
        require(rootSignature.length > 0, "Root signature required");
        require(block.timestamp >= payment.claimDate, "Payment not yet claimable");
        bytes32 rootMessageHash = keccak256(
                abi.encodePacked(batch.batchHash, merkleRoot)
        );
        address recoveredRootSigner = ECDSA.recover(rootMessageHash, rootSignature);
        address authorizedSigner;
        if(signerAuthorization.signature.length > 0) {
            require(!revokedSigners[escrowBatchId][signerAuthorization.signer], "Signer authorization revoked");
            require(block.timestamp < signerAuthorization.expiration, "Signer authorization expired");
            bytes32 authMessageHash = keccak256(
                abi.encodePacked(
                    escrowBatchId,
                    signerAuthorization.signer,
                    signerAuthorization.transactionMax,
                    signerAuthorization.totalMax,
                    signerAuthorization.expiration,
                    signerAuthorization.salt
                )
            );
            address recoveredAuthSigner = ECDSA.recover(authMessageHash, signerAuthorization.signature);
            require(recoveredAuthSigner == batch.signer, "Invalid signer authorization");
            require(payment.amount <= signerAuthorization.transactionMax, "Payment exceeds transaction limit");
            require(
                signerSpent[escrowBatchId][signerAuthorization.signer] + payment.amount <= signerAuthorization.totalMax,
                "Payment exceeds signer total allowance"
            );

            require(recoveredRootSigner == signerAuthorization.signer, "Invalid root signature");
            authorizedSigner = signerAuthorization.signer;
        } else {
            require(recoveredRootSigner == batch.signer, "Invalid root signature");
        }


        leaf = keccak256(
            abi.encodePacked(
                scheduledBatchHash,
                payment.receiver,
                payment.amount,
                payment.claimDate,
                payment.memo
            )
        );
        require(!claimed[escrowBatchId][leaf], "Payment already claimed");
        require(
            MerkleProof.verify(merkleProof, merkleRoot, leaf),
            "Invalid merkle proof"
        );
        require(
            batch.totalClaimed + batch.totalWithdrawn + payment.amount <= batch.totalFunded,
            "Insufficient escrow funds"
        );

        claimed[escrowBatchId][leaf] = true;
        batch.totalClaimed += payment.amount;
        batch.claimCount++;
        if (authorizedSigner != address(0)) {
            signerSpent[escrowBatchId][authorizedSigner] += payment.amount;
        }

        IERC20(batch.fundingToken).safeTransfer(payment.receiver, payment.amount);

        emit EscrowPaymentClaimed(
            escrowBatchId,
            payment.receiver,
            payment.amount,
            batch.fundingToken,
            payment.memo,
            authorizedSigner
        );
    }

    function revokeSigner(bytes32 escrowBatchId, address signer) external {
        IEscrowBatchPayout.EscrowBatch storage batch = escrowBatches[
            escrowBatchId
        ];
        require(batch.exists, "Escrow batch does not exist");
        require(
            batch.signer == msg.sender || batch.withdrawalWallet == msg.sender,
            "Only escrow creator can revoke signer"
        );
        require(signer != address(0), "Invalid signer address");
        require(!revokedSigners[escrowBatchId][signer], "Signer already revoked");

        revokedSigners[escrowBatchId][signer] = true;

        emit SignerRevoked(escrowBatchId, signer, msg.sender);
    }

    function setLockDuration(
        bytes32 escrowBatchId,
        uint256 newLockDuration
    ) external {
        IEscrowBatchPayout.EscrowBatch storage batch = escrowBatches[
            escrowBatchId
        ];
        require(batch.exists, "Escrow batch does not exist");
        require(
            batch.signer == msg.sender || batch.withdrawalWallet == msg.sender,
            "Only escrow creator can set lock duration"
        );
        require(
            newLockDuration > batch.lockDuration,
            "Lock duration can only increase"
        );

        uint256 previousLockDuration = batch.lockDuration;
        batch.lockDuration = newLockDuration;

        emit EscrowLockDurationSet(
            escrowBatchId,
            previousLockDuration,
            newLockDuration
        );
    }

    function withdrawEscrowFunds(
        bytes32 escrowBatchId,
        uint256 amount
    ) external nonReentrant {
        IEscrowBatchPayout.EscrowBatch storage batch = escrowBatches[
            escrowBatchId
        ];
        require(batch.exists, "Escrow batch does not exist");
        require(
            batch.signer == msg.sender || batch.withdrawalWallet == msg.sender,
            "Only escrow creator can withdraw"
        );
        require(
            block.timestamp > batch.createdAt + batch.lockDuration,
            "Escrow still locked"
        );
        require(amount > 0, "Amount must be greater than 0");

        uint256 remainingFunds = batch.totalFunded -
            batch.totalClaimed -
            batch.totalWithdrawn;
        require(amount <= remainingFunds, "Insufficient escrow funds");

        batch.totalWithdrawn += amount;

        IERC20(batch.fundingToken).safeTransfer(batch.withdrawalWallet, amount);

        emit EscrowFundsWithdrawn(
            escrowBatchId,
            msg.sender,
            batch.withdrawalWallet,
            amount
        );
    }

    function addFundsToEscrowBatch(
        bytes32 escrowBatchId,
        uint256 amount
    ) external nonReentrant {
        IEscrowBatchPayout.EscrowBatch storage batch = escrowBatches[
            escrowBatchId
        ];
        require(batch.exists, "Escrow batch does not exist");
        require(amount > 0, "Amount must be greater than 0");

        IERC20(batch.fundingToken).safeTransferFrom(
            msg.sender,
            address(this),
            amount
        );
        batch.totalFunded += amount;

        emit EscrowBatchFunded(
            escrowBatchId,
            batch.batchHash,
            batch.fundingToken,
            amount
        );
    }

    function getEscrowBatch(
        bytes32 escrowBatchId
    ) external view returns (IEscrowBatchPayout.EscrowBatch memory) {
        return escrowBatches[escrowBatchId];
    }

    function isClaimed(
        bytes32 escrowBatchId,
        bytes32 leaf
    ) external view returns (bool) {
        return claimed[escrowBatchId][leaf];
    }

    function getRemainingFunds(
        bytes32 escrowBatchId
    ) external view returns (uint256) {
        IEscrowBatchPayout.EscrowBatch storage batch = escrowBatches[
            escrowBatchId
        ];
        require(batch.exists, "Escrow batch does not exist");
        return batch.totalFunded - batch.totalClaimed - batch.totalWithdrawn;
    }
}
