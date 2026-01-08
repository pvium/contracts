// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";

/**
 * @title TokenRelay
 * @notice Allows relayers to submit signed token transfer requests on behalf of users
 * @dev Uses EIP-712 for signature verification and AccessControl for role-based permissions
 */
contract TokenRelay is AccessControl, EIP712 {
    using ECDSA for bytes32;

    // Roles
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant DAO_ROLE = keccak256("DAO_ROLE");

    // Type hash for the transfer request
    bytes32 public constant TRANSFER_TYPEHASH = keccak256(
        "TransferRequest(address token,uint256 amount,address receiver,uint256 maxFee,address signer,uint256 nonce,uint256 deadline)"
    );

    // Nonces for replay protection
    mapping(address => uint256) public nonces;

    // Supported tokens
    mapping(address => bool) public supportedTokens;

    // Fee percentage (in basis points, e.g., 100 = 1%)
    uint256 public feePercentage;

    // Maximum allowed fee percentage (in basis points, can only be changed by DAO)
    uint256 public maxFeePercentage;

    // Minimum transfer amount (to prevent dust attacks)
    uint256 public minimumAmount;

    // Events
    event TokenTransferred(
        address indexed token,
        address indexed from,
        address indexed to,
        uint256 amount,
        uint256 fee,
        uint256 nonce
    );
    event TokenAdded(address indexed token);
    event TokenRemoved(address indexed token);
    event FeePercentageUpdated(uint256 oldFee, uint256 newFee);
    event MaxFeePercentageUpdated(uint256 oldMaxFee, uint256 newMaxFee);
    event MinimumAmountUpdated(uint256 oldMinimum, uint256 newMinimum);

    // Transfer request struct to avoid stack too deep
    struct TransferRequest {
        address token;
        uint256 amount;
        address receiver;
        uint256 maxFee;
        address signer;
        uint256 deadline;
        bytes signature;
    }

    // Custom errors
    error UnsupportedToken(address token);
    error InvalidSignature();
    error DeadlineExpired(uint256 deadline, uint256 currentTime);
    error InvalidNonce(uint256 expected, uint256 provided);
    error AmountTooLow(uint256 amount, uint256 minimum);
    error FeeTooHigh(uint256 fee, uint256 maxFee);
    error FeeExceedsMaxAllowed(uint256 fee, uint256 maxAllowed);
    error TransferFailed();

    /**
     * @notice Constructor
     * @param _feePercentage Initial fee percentage in basis points (e.g., 100 = 1%)
     * @param _maxFeePercentage Maximum allowed fee percentage (e.g., 1000 = 10%)
     * @param _minimumAmount Initial minimum transfer amount
     * @param _name EIP-712 domain name (e.g., "TokenRelay")
     * @param _version EIP-712 domain version (e.g., "1", "2")
     */
    constructor(
        uint256 _feePercentage,
        uint256 _maxFeePercentage,
        uint256 _minimumAmount,
        string memory _name,
        string memory _version
    ) EIP712(_name, _version) {
        require(_feePercentage <= _maxFeePercentage, "Fee exceeds max allowed");

        feePercentage = _feePercentage;
        maxFeePercentage = _maxFeePercentage;
        minimumAmount = _minimumAmount;

        // Grant roles to deployer
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(ADMIN_ROLE, msg.sender);
        _grantRole(DAO_ROLE, msg.sender);
    }

    /**
     * @notice Relay a token transfer on behalf of a user
     * @param request TransferRequest struct containing all transfer parameters
     */
    function relayTransfer(
        TransferRequest calldata request
    ) external {
        // Check if token is supported
        if (!supportedTokens[request.token]) {
            revert UnsupportedToken(request.token);
        }

        // Check deadline
        if (block.timestamp > request.deadline) {
            revert DeadlineExpired(request.deadline, block.timestamp);
        }

        // Get current nonce for signer
        uint256 nonce = nonces[request.signer];

        // Check minimum amount
        if (request.amount < minimumAmount) {
            revert AmountTooLow(request.amount, minimumAmount);
        }

        // Calculate fee
        uint256 fee = (request.amount * feePercentage) / 10000;

        // Check if fee exceeds max fee
        if (fee > request.maxFee) {
            revert FeeTooHigh(fee, request.maxFee);
        }

        // Verify signature
        bytes32 structHash = keccak256(
            abi.encode(
                TRANSFER_TYPEHASH,
                request.token,
                request.amount,
                request.receiver,
                request.maxFee,
                request.signer,
                nonce,
                request.deadline
            )
        );

        bytes32 digest = _hashTypedDataV4(structHash);
        address recoveredSigner = digest.recover(request.signature);

        if (recoveredSigner != request.signer || recoveredSigner == address(0)) {
            revert InvalidSignature();
        }

        // Increment nonce
        nonces[request.signer]++;

        // Calculate amount after fee
        uint256 amountAfterFee = request.amount - fee;

        // Transfer tokens from signer to receiver
        bool success = IERC20(request.token).transferFrom(request.signer, request.receiver, amountAfterFee);
        if (!success) {
            revert TransferFailed();
        }

        // Transfer fee to relayer (msg.sender)
        if (fee > 0) {
            success = IERC20(request.token).transferFrom(request.signer, msg.sender, fee);
            if (!success) {
                revert TransferFailed();
            }
        }

        emit TokenTransferred(request.token, request.signer, request.receiver, amountAfterFee, fee, nonce);
    }

    /**
     * @notice Add a supported token
     * @param token The token address to add
     */
    function addSupportedToken(address token) external onlyRole(ADMIN_ROLE) {
        supportedTokens[token] = true;
        emit TokenAdded(token);
    }

    /**
     * @notice Remove a supported token
     * @param token The token address to remove
     */
    function removeSupportedToken(address token) external onlyRole(ADMIN_ROLE) {
        supportedTokens[token] = false;
        emit TokenRemoved(token);
    }

    /**
     * @notice Update the fee percentage
     * @param _feePercentage New fee percentage in basis points
     */
    function setFeePercentage(uint256 _feePercentage) external onlyRole(ADMIN_ROLE) {
        if (_feePercentage > maxFeePercentage) {
            revert FeeExceedsMaxAllowed(_feePercentage, maxFeePercentage);
        }
        uint256 oldFee = feePercentage;
        feePercentage = _feePercentage;
        emit FeePercentageUpdated(oldFee, _feePercentage);
    }

    /**
     * @notice Update the maximum fee percentage (DAO only)
     * @param _maxFeePercentage New maximum fee percentage in basis points
     */
    function setMaxFeePercentage(uint256 _maxFeePercentage) external onlyRole(DAO_ROLE) {
        uint256 oldMaxFee = maxFeePercentage;
        maxFeePercentage = _maxFeePercentage;

        // Ensure current fee doesn't exceed new max
        if (feePercentage > maxFeePercentage) {
            feePercentage = maxFeePercentage;
            emit FeePercentageUpdated(feePercentage, maxFeePercentage);
        }

        emit MaxFeePercentageUpdated(oldMaxFee, _maxFeePercentage);
    }

    /**
     * @notice Update the minimum transfer amount
     * @param _minimumAmount New minimum amount
     */
    function setMinimumAmount(uint256 _minimumAmount) external onlyRole(ADMIN_ROLE) {
        uint256 oldMinimum = minimumAmount;
        minimumAmount = _minimumAmount;
        emit MinimumAmountUpdated(oldMinimum, _minimumAmount);
    }

    /**
     * @notice Get the current nonce for an address
     * @param user The user address
     * @return The current nonce
     */
    function getNonce(address user) external view returns (uint256) {
        return nonces[user];
    }

    /**
     * @notice Check if a token is supported
     * @param token The token address
     * @return True if supported
     */
    function isTokenSupported(address token) external view returns (bool) {
        return supportedTokens[token];
    }
}
