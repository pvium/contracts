// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

/**
 * @title MultiSigWallet
 * @notice A multi-signature wallet where a required number of owners must confirm
 *         a transaction before it can be executed.
 */
contract MultiSigWallet is ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ─────────────────────────────── Events ────────────────────────────────

    event Deposit(address indexed sender, uint256 amount);
    event TransactionSubmitted(
        uint256 indexed txId,
        address indexed proposer,
        address indexed to,
        uint256 value,
        address token,
        bytes data
    );
    event TransactionConfirmed(uint256 indexed txId, address indexed owner);
    event ConfirmationRevoked(uint256 indexed txId, address indexed owner);
    event TransactionExecuted(uint256 indexed txId);
    event WithdrawalBySignatures(
        address indexed token,
        WithdrawalItem[] items,
        bytes32 indexed receipt,
        uint256 indexed batchId
    );
    event OwnerAdded(address indexed owner);
    event OwnerRemoved(address indexed owner);
    event RequirementChanged(uint256 requiredConfirmations, uint256 requiredOwnerChange, uint256 requiredRequirementChange);
    event ByteCodeDeployed(address indexed deployed, uint256 indexed batchId);

    // ─────────────────────────────── Storage ───────────────────────────────

    struct Transaction {
        address to;
        uint256 value;       // ETH value (0 for ERC-20-only txs)
        address token;       // address(0) for pure ETH withdrawals
        uint256 tokenAmount; // 0 for pure ETH withdrawals
        bytes data;          // arbitrary call data
        bool executed;
        uint256 confirmations;
    }

    struct WithdrawalItem {
        address to;
        uint256 value;
    }

    address[] public owners;
    mapping(address => bool) public isOwner;
    uint256 public requiredConfirmations;     // minimum confirmations to execute a transaction
    uint256 public requiredOwnerChange;       // minimum signatures to add or remove an owner
    uint256 public requiredRequirementChange; // minimum signatures to change any required threshold

    Transaction[] public transactions;
    // txId => owner => confirmed
    mapping(uint256 => mapping(address => bool)) public confirmed;

    bytes32[] public withdrawalReceipts;
    mapping(bytes32 => bool) public isReceiptUsed;
    uint256[] public withdrawalBatchIds;
    mapping(uint256 => bool) public isBatchIdUsed;

    // ─────────────────────────────── Modifiers ─────────────────────────────

    modifier onlyOwner() {
        require(isOwner[msg.sender], "MultiSig: not an owner");
        _;
    }

    modifier txExists(uint256 txId) {
        require(txId < transactions.length, "MultiSig: tx does not exist");
        _;
    }

    modifier notExecuted(uint256 txId) {
        require(!transactions[txId].executed, "MultiSig: already executed");
        _;
    }

    modifier notConfirmed(uint256 txId) {
        require(!confirmed[txId][msg.sender], "MultiSig: already confirmed");
        _;
    }

    // ─────────────────────────────── Constructor ───────────────────────────

    /**
     * @param _owners                    List of initial owner addresses (must be unique, non-zero).
     * @param _requiredConfirmations     Number of confirmations required to execute a transaction.
     * @param _requiredOwnerChange       Number of signatures required to add or remove an owner.
     * @param _requiredRequirementChange Number of signatures required to change any required threshold.
     */
    constructor(
        address[] memory _owners,
        uint256 _requiredConfirmations,
        uint256 _requiredOwnerChange,
        uint256 _requiredRequirementChange
    ) {
        require(_owners.length > 0, "MultiSig: no owners");
        require(
            _requiredConfirmations > 0 && _requiredConfirmations < _owners.length,
            "MultiSig: invalid requiredConfirmations"
        );
        require(
            _requiredOwnerChange > 0 && _requiredOwnerChange < _owners.length,
            "MultiSig: invalid requiredOwnerChange"
        );
        require(
            _requiredRequirementChange > 0 && _requiredRequirementChange < _owners.length,
            "MultiSig: invalid requiredRequirementChange"
        );

        for (uint256 i = 0; i < _owners.length; i++) {
            address owner = _owners[i];
            require(owner != address(0), "MultiSig: zero address owner");
            require(!isOwner[owner], "MultiSig: duplicate owner");
            isOwner[owner] = true;
            owners.push(owner);
            emit OwnerAdded(owner);
        }

        requiredConfirmations = _requiredConfirmations;
        requiredOwnerChange = _requiredOwnerChange;
        requiredRequirementChange = _requiredRequirementChange;
        emit RequirementChanged(_requiredConfirmations, _requiredOwnerChange, _requiredRequirementChange);
    }

    // ─────────────────────────────── Receive ETH ───────────────────────────

    receive() external payable {
        if (msg.value > 0) emit Deposit(msg.sender, msg.value);
    }

    // ─────────────────────────────── Submit ────────────────────────────────

    /**
     * @notice Submit an ETH withdrawal transaction.
     * @param to     Recipient address.
     * @param value  Amount of ETH (in wei) to send.
     * @param data   Optional call data.
     */
    function submitETHTransaction(
        address to,
        uint256 value,
        bytes calldata data
    ) external onlyOwner returns (uint256 txId) {
        require(to != address(0), "MultiSig: zero address");
        require(value > 0, "MultiSig: value must be > 0");
        require(address(this).balance >= value, "MultiSig: insufficient ETH");
        txId = _submit(to, value, address(0), 0, data);
    }

    /**
     * @notice Submit an ERC-20 token withdrawal transaction.
     * @param to          Recipient address.
     * @param token       ERC-20 token contract address.
     * @param tokenAmount Amount of tokens to transfer.
     * @param data        Optional call data.
     */
    function submitTokenTransaction(
        address to,
        address token,
        uint256 tokenAmount,
        bytes calldata data
    ) external onlyOwner returns (uint256 txId) {
        require(to != address(0), "MultiSig: zero address");
        require(token != address(0), "MultiSig: zero token address");
        require(tokenAmount > 0, "MultiSig: amount must be > 0");
        require(
            IERC20(token).balanceOf(address(this)) >= tokenAmount,
            "MultiSig: insufficient token balance"
        );
        txId = _submit(to, 0, token, tokenAmount, data);
    }

    /**
     * @notice Submit a generic contract call (no asset transfer, just calldata).
     * @param to   Target contract address.
     * @param data Encoded call data.
     */
    function submitCall(
        address to,
        bytes calldata data
    ) external onlyOwner returns (uint256 txId) {
        require(to != address(0), "MultiSig: zero address");
        txId = _submit(to, 0, address(0), 0, data);
    }

    // ─────────────────────────────── Confirm ───────────────────────────────

    /**
     * @notice Confirm a pending transaction.
     */
    function confirm(
        uint256 txId
    ) external onlyOwner txExists(txId) notExecuted(txId) notConfirmed(txId) {
        confirmed[txId][msg.sender] = true;
        transactions[txId].confirmations++;
        emit TransactionConfirmed(txId, msg.sender);
    }

    /**
     * @notice Revoke a previously given confirmation.
     */
    function revokeConfirmation(
        uint256 txId
    ) external onlyOwner txExists(txId) notExecuted(txId) {
        require(confirmed[txId][msg.sender], "MultiSig: not confirmed");
        confirmed[txId][msg.sender] = false;
        transactions[txId].confirmations--;
        emit ConfirmationRevoked(txId, msg.sender);
    }

    // ─────────────────────────────── Execute ───────────────────────────────

    /**
     * @notice Execute a transaction once it has enough confirmations.
     */
    function execute(
        uint256 txId
    ) external onlyOwner txExists(txId) notExecuted(txId) nonReentrant {
        Transaction storage txn = transactions[txId];
        require(
            txn.confirmations >= requiredConfirmations,
            "MultiSig: not enough confirmations"
        );

        txn.executed = true;

        if (txn.token != address(0)) {
            // ERC-20 transfer
            IERC20(txn.token).safeTransfer(txn.to, txn.tokenAmount);
        }

        if (txn.value > 0 || txn.data.length > 0) {
            // ETH transfer or generic call
            (bool success, ) = txn.to.call{value: txn.value}(txn.data);
            require(success, "MultiSig: execution failed");
        }

        emit TransactionExecuted(txId);
    }

    /**
     * @notice Deploy a contract from raw bytecode after verifying owner signatures.
     * @param bytecode  Deployment bytecode (constructor + runtime).
     * @param value     ETH (in wei) to send to the constructor (0 for none).
     * @param batchId   Unique batch identifier for replay protection.
     * @param signatures Owner signatures over the action receipt.
     */
    function executeByteCode(
        bytes calldata bytecode,
        uint256 value,
        uint256 batchId,
        bytes[] calldata signatures
    ) external onlyOwner nonReentrant returns (address deployed) {
        require(bytecode.length > 0, "MultiSig: empty bytecode");
        require(!isBatchIdUsed[batchId], "MultiSig: batchId already used");
        if (value > 0) {
            require(address(this).balance >= value, "MultiSig: insufficient ETH");
        }

        bytes32 receipt = keccak256(
            abi.encode(
                address(this),
                block.chainid,
                "executeByteCode",
                keccak256(bytecode),
                value,
                batchId
            )
        );
        require(!isReceiptUsed[receipt], "MultiSig: receipt already used");

        bytes32 digest = MessageHashUtils.toEthSignedMessageHash(receipt);
        _verifyOwnerSignaturesThreshold(digest, signatures, requiredConfirmations);

        isReceiptUsed[receipt] = true;
        isBatchIdUsed[batchId] = true;

        bytes memory _bytecode = bytecode;
        assembly {
            deployed := create(value, add(_bytecode, 0x20), mload(_bytecode))
        }
        require(deployed != address(0), "MultiSig: deployment failed");

        emit ByteCodeDeployed(deployed, batchId);
    }

    /**
     * @notice Withdraw ETH/ERC20 by verifying all owners signatures in a single call.
     * @param token Asset to withdraw (address(0) for ETH, ERC-20 address otherwise).
     * @param items Recipient/value pairs.
     * @param batchId Batch identifier to bind signatures to a specific withdrawal request.
     * @param signatures Signatures from all owners over the withdrawal receipt.
     */
    function withdrawWithOwnerSignatures(
        address token,
        WithdrawalItem[] calldata items,
        uint256 batchId,
        bytes[] calldata signatures
    ) external onlyOwner nonReentrant returns (bytes32 receipt) {
        require(items.length > 0, "MultiSig: empty recipients");
        require(!isBatchIdUsed[batchId], "MultiSig: batchId already used");

        uint256 totalValue = 0;
        for (uint256 i = 0; i < items.length; i++) {
            require(items[i].to != address(0), "MultiSig: zero address");
            require(items[i].value > 0, "MultiSig: value must be > 0");
            totalValue += items[i].value;
        }
        if (token == address(0)) {
            require(address(this).balance >= totalValue, "MultiSig: insufficient ETH");
        } else {
            require(
                IERC20(token).balanceOf(address(this)) >= totalValue,
                "MultiSig: insufficient token balance"
            );
        }

        receipt = keccak256(
            abi.encode(
                address(this),
                block.chainid,
                token,
                items,
                batchId
            )
        );
        require(!isReceiptUsed[receipt], "MultiSig: receipt already used");

        bytes32 digest = MessageHashUtils.toEthSignedMessageHash(receipt);
        _verifyOwnerSignaturesThreshold(digest, signatures, requiredConfirmations);

        
        isReceiptUsed[receipt] = true;
        withdrawalReceipts.push(receipt);
        isBatchIdUsed[batchId] = true;
        withdrawalBatchIds.push(batchId);

        if (token == address(0)) {
            for (uint256 i = 0; i < items.length; i++) {
                (bool success, ) = payable(items[i].to).call{value: items[i].value}("");
                require(success, "MultiSig: withdrawal failed");
            }
        } else {
            for (uint256 i = 0; i < items.length; i++) {
                IERC20(token).safeTransfer(items[i].to, items[i].value);
            }
        }

        emit WithdrawalBySignatures(token, items, receipt, batchId);
    }

    // ─────────────────────────────── Governance ────────────────────────────

    /**
     * @notice Add a new owner. Requires `requiredOwnerChange` valid owner signatures.
     * @param newOwner   Address of the new owner to add.
     * @param batchId    Unique batch identifier for replay protection.
     * @param signatures Owner signatures over the action receipt.
     */
    function addOwnerWithSignatures(
        address newOwner,
        uint256 batchId,
        bytes[] calldata signatures
    ) external onlyOwner {
        require(newOwner != address(0), "MultiSig: zero address");
        require(!isOwner[newOwner], "MultiSig: already an owner");
        require(!isBatchIdUsed[batchId], "MultiSig: batchId already used");

        bytes32 receipt = keccak256(
            abi.encode(address(this), block.chainid, "addOwner", newOwner, batchId)
        );
        require(!isReceiptUsed[receipt], "MultiSig: receipt already used");

        bytes32 digest = MessageHashUtils.toEthSignedMessageHash(receipt);
        _verifyOwnerSignaturesThreshold(digest, signatures, requiredOwnerChange);

        isReceiptUsed[receipt] = true;
        isBatchIdUsed[batchId] = true;
        isOwner[newOwner] = true;
        owners.push(newOwner);
        emit OwnerAdded(newOwner);
    }

    /**
     * @notice Remove an existing owner. Requires `requiredOwnerChange` valid owner signatures.
     * @param ownerToRemove Address of the owner to remove.
     * @param batchId       Unique batch identifier for replay protection.
     * @param signatures    Owner signatures over the action receipt.
     */
    function removeOwnerWithSignatures(
        address ownerToRemove,
        uint256 batchId,
        bytes[] calldata signatures
    ) external onlyOwner {
        require(isOwner[ownerToRemove], "MultiSig: not an owner");
        require(!isBatchIdUsed[batchId], "MultiSig: batchId already used");

        uint256 newOwnerCount = owners.length - 1;
        require(newOwnerCount > requiredConfirmations, "MultiSig: would break requiredConfirmations");
        require(newOwnerCount > requiredOwnerChange, "MultiSig: would break requiredOwnerChange");
        require(newOwnerCount > requiredRequirementChange, "MultiSig: would break requiredRequirementChange");

        bytes32 receipt = keccak256(
            abi.encode(address(this), block.chainid, "removeOwner", ownerToRemove, batchId)
        );
        require(!isReceiptUsed[receipt], "MultiSig: receipt already used");

        bytes32 digest = MessageHashUtils.toEthSignedMessageHash(receipt);
        _verifyOwnerSignaturesThreshold(digest, signatures, requiredOwnerChange);

        isReceiptUsed[receipt] = true;
        isBatchIdUsed[batchId] = true;
        isOwner[ownerToRemove] = false;
        for (uint256 i = 0; i < owners.length; i++) {
            if (owners[i] == ownerToRemove) {
                owners[i] = owners[owners.length - 1];
                owners.pop();
                break;
            }
        }
        emit OwnerRemoved(ownerToRemove);
    }

    /**
     * @notice Change all three required thresholds. Requires `requiredRequirementChange` valid owner signatures.
     * @param newRequiredConfirmations     New threshold for transaction execution.
     * @param newRequiredOwnerChange       New threshold for owner add/remove.
     * @param newRequiredRequirementChange New threshold for requirement changes.
     * @param batchId                      Unique batch identifier for replay protection.
     * @param signatures                   Owner signatures over the action receipt.
     */
    function changeRequirementsWithSignatures(
        uint256 newRequiredConfirmations,
        uint256 newRequiredOwnerChange,
        uint256 newRequiredRequirementChange,
        uint256 batchId,
        bytes[] calldata signatures
    ) external onlyOwner {
        require(!isBatchIdUsed[batchId], "MultiSig: batchId already used");
        uint256 ownerCount = owners.length;
        require(
            newRequiredConfirmations > 0 && newRequiredConfirmations < ownerCount,
            "MultiSig: invalid requiredConfirmations"
        );
        require(
            newRequiredOwnerChange > 0 && newRequiredOwnerChange < ownerCount,
            "MultiSig: invalid requiredOwnerChange"
        );
        require(
            newRequiredRequirementChange > 0 && newRequiredRequirementChange < ownerCount,
            "MultiSig: invalid requiredRequirementChange"
        );

        bytes32 receipt = keccak256(
            abi.encode(
                address(this),
                block.chainid,
                "changeRequirements",
                newRequiredConfirmations,
                newRequiredOwnerChange,
                newRequiredRequirementChange,
                batchId
            )
        );
        require(!isReceiptUsed[receipt], "MultiSig: receipt already used");

        bytes32 digest = MessageHashUtils.toEthSignedMessageHash(receipt);
        _verifyOwnerSignaturesThreshold(digest, signatures, requiredRequirementChange);

        isReceiptUsed[receipt] = true;
        isBatchIdUsed[batchId] = true;
        requiredConfirmations = newRequiredConfirmations;
        requiredOwnerChange = newRequiredOwnerChange;
        requiredRequirementChange = newRequiredRequirementChange;
        emit RequirementChanged(newRequiredConfirmations, newRequiredOwnerChange, newRequiredRequirementChange);
    }

    // ─────────────────────────────── View helpers ──────────────────────────

    function getOwners() external view returns (address[] memory) {
        return owners;
    }

    function getTransactionCount() external view returns (uint256) {
        return transactions.length;
    }

    function getTransaction(
        uint256 txId
    )
        external
        view
        returns (
            address to,
            uint256 value,
            address token,
            uint256 tokenAmount,
            bytes memory data,
            bool executed,
            uint256 confirmationCount
        )
    {
        Transaction storage txn = transactions[txId];
        return (
            txn.to,
            txn.value,
            txn.token,
            txn.tokenAmount,
            txn.data,
            txn.executed,
            txn.confirmations
        );
    }

    function isConfirmed(
        uint256 txId,
        address owner
    ) external view returns (bool) {
        return confirmed[txId][owner];
    }

    function getWithdrawalReceipts() external view returns (bytes32[] memory) {
        return withdrawalReceipts;
    }

    function getWithdrawalBatchIds() external view returns (uint256[] memory) {
        return withdrawalBatchIds;
    }

    // ─────────────────────────────── Internal ──────────────────────────────

    function _submit(
        address to,
        uint256 value,
        address token,
        uint256 tokenAmount,
        bytes calldata data
    ) internal returns (uint256 txId) {
        txId = transactions.length;
        transactions.push(
            Transaction({
                to: to,
                value: value,
                token: token,
                tokenAmount: tokenAmount,
                data: data,
                executed: false,
                confirmations: 0
            })
        );
        emit TransactionSubmitted(txId, msg.sender, to, value, token, data);
    }

    /**
     * @dev Verifies that `signatures` contains at least `requiredCount` valid, unique owner signatures.
     */
    function _verifyOwnerSignaturesThreshold(
        bytes32 digest,
        bytes[] calldata signatures,
        uint256 requiredCount
    ) internal view {
        require(signatures.length >= requiredCount, "MultiSig: insufficient signatures");
        require(signatures.length <= owners.length, "MultiSig: too many signatures");
        address[] memory seenSigners = new address[](signatures.length);
        for (uint256 i = 0; i < signatures.length; i++) {
            address signer = ECDSA.recover(digest, signatures[i]);
            require(isOwner[signer], "MultiSig: invalid signer");
            for (uint256 j = 0; j < i; j++) {
                require(seenSigners[j] != signer, "MultiSig: duplicate signer");
            }
            seenSigners[i] = signer;
        }
    }
}
