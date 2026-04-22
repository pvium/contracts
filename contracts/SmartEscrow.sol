// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import "./interfaces/ISmartEscrowFactory.sol";
import "hardhat/console.sol";

/**
 * @title Account
 * @notice Individual escrow project for managing receiver payments
 * @dev Handles funding, receiver management, payouts, disputes, and fee distribution
 */
contract SmartEscrow is ReentrancyGuard {
    using SafeERC20 for IERC20;
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    struct DeploymentParams {
        address factory;
        string appId;
        string projectId;
        string metadata;
        address tokenAddress;
        address refundAddress;
        uint256 appFeeBps;
        uint256 pviumFeeBps;
        uint256 disputeWindowSeconds;
        uint256 lockDurationSeconds;
        uint256 basePayout;
        uint256 maxPayout;
        uint256 maxNumReceivers;
    }

    struct CreateSmartEscrowPayload {
        string app;
        string projectId;
        string metadata;
        address tokenAddress;
        address refundAddress;
        uint256 appFeeBps;
        uint256 disputeWindowSeconds;
        uint256 lockDurationSeconds;
        uint256 basePayout;
        uint256 maxPayout;
        uint256 maxNumReceivers;
        uint256 timestamp;
    }

    struct ReceiverPayoutPayload {
        string app;
        string projectId;
        bytes32 claimId;
        address receiver;
        uint256 amount;
        uint256 claimableAfter;
        uint256 claimDeadline;
        bytes appSignature;
    }

    struct FinalizedClaim {
        address receiver;
        uint256 amount;
        uint256 finalizedAt;
        bool claimed;
    }

    struct Dispute {
        bool active;
        uint256 raisedAt;
        uint256 deadline;
        address raisedBy;
    }

    // State variables
    string public appId;
    string public projectId;
    ISmartEscrowFactory public factory;
    address public refundAddress;
    IERC20 public token;
    string public metadata;

    uint256 public appFeeBps;
    uint256 public pviumFeeBps;
    uint256 public disputeWindowSeconds;
    uint256 public lockDurationSeconds;
    uint256 public basePayout;
    uint256 public maxPayout;
    uint256 public maxNumReceivers;

    bool public isActive;
    uint256 public createdAt;
    uint256 public activatedAt;

    // Receiver management
    mapping(address => bool) public approvedReceivers;
    address[] public receiverList;

    // Claim tracking
    mapping(bytes32 => FinalizedClaim) public finalizedClaims;
    mapping(bytes32 => bool) public cancelledClaims;
    mapping(bytes32 => Dispute) public disputes;

    // Receiver payment tracking
    mapping(address => uint256) public totalPaidToReceiver; // Track cumulative payments per receiver
    mapping(address => bool) public receiverBanned; // Ban status
    mapping(address => uint256) public receiverEmergencyWithdrawnAmount; // Track emergency withdrawal amounts

    bytes32 appIdBytes;

    // Events
    event AccountCreated(
        string appId,
        address tokenAddress,
        uint256 appFeeBps,
        uint256 pviumFeeBps
    );
    event AccountFunded(address indexed funder, uint256 amount);
    event ReceiversAdded(address[] receivers);
    event AccountActivated(uint256 timestamp);
    event ClaimFinalized(
        bytes32 indexed claimId,
        address indexed receiver,
        uint256 receiverAmount,
        uint256 appFee,
        uint256 pviumFee
    );

    event DisputeRaised(bytes32 indexed claimId, address indexed raisedBy);
    event DisputeResolved(bytes32 indexed claimId, bool allowed);
    event BasePayWithdrawal(address indexed receiver, uint256 amount);
    event SurplusWithdrawn(address indexed refundAddress, uint256 amount);
    event ReceiverBanned(
        address indexed receiver,
        bool banned,
        uint256 timestamp
    );

    /**
     * @notice Constructor
     */
    constructor(
        address _factory,
        string memory _appId,
        string memory _projectId,
        string memory _metadata,
        address _tokenAddress,
        address _refundAddress,
        uint256 _appFeeBps,
        uint256 _pviumFeeBps,
        uint256 _disputeWindowSeconds,
        uint256 _lockDuration,
        uint256 _basePayout,
        uint256 _maxPayout,
        uint256 _maxNumReceivers
    ) {
        require(_tokenAddress != address(0), "Invalid token address");
        require(_refundAddress != address(0), "Invalid refund address");
        require(_appFeeBps + _pviumFeeBps <= 10000, "Total fees exceed 100%");
        require(_maxNumReceivers > 0, "Max receivers must be > 0");
        require(_maxPayout >= _basePayout, "Max payout must be >= base payout");
        require(_basePayout > 0, "Base payout must be > 0");

        factory = ISmartEscrowFactory(_factory);
        appId = _appId;
        appIdBytes = keccak256(abi.encode(appId));
        console.log("SmartEscrow constructor:");
        console.logBytes32(appIdBytes);
        projectId = _projectId;
        metadata = _metadata;
        token = IERC20(_tokenAddress);
        refundAddress = _refundAddress;
        appFeeBps = _appFeeBps;
        pviumFeeBps = _pviumFeeBps;
        disputeWindowSeconds = _disputeWindowSeconds;
        lockDurationSeconds = _lockDuration;
        basePayout = _basePayout;
        maxPayout = _maxPayout;
        maxNumReceivers = _maxNumReceivers;

        createdAt = block.timestamp;

        emit AccountCreated(_appId, _tokenAddress, _appFeeBps, _pviumFeeBps);
    }

    // Modifiers
    modifier onlyAppAdmin(
        CallSignature calldata callSig,
        bytes memory payloadData
    ) {
        factory.validateAppAdmin(appIdBytes, msg.sender, callSig, payloadData);
        _;
    }

    modifier onlyFactory() {
        require(msg.sender == address(factory), "Only factory");
        _;
    }

    modifier onlyFactoryOrApp() {
        require(
            msg.sender == address(factory) ||
                factory.appAdmins(appIdBytes, msg.sender),
            "Only factory or app"
        );
        _;
    }

    modifier beforeActivation() {
        require(!isActive, "Account already active");
        _;
    }

    modifier afterActivation() {
        require(isActive, "Account not active");
        _;
    }

    /**
     * @notice Fund the project with ERC20 tokens
     * @param amount Amount of tokens to deposit
     */
    function fundAccount(uint256 amount) external nonReentrant {
        require(amount > 0, "Amount must be greater than 0");

        token.safeTransferFrom(msg.sender, address(this), amount);

        emit AccountFunded(msg.sender, amount);
    }

    /**
     * @notice Add approved receivers to the project
     * @param receivers Array of receiver addresses
     */
    function addReceivers(
        address[] calldata receivers,
        CallSignature calldata signature
    )
        external
        onlyAppAdmin(
            signature,
            abi.encode(projectId, "addReceivers", receivers)
        )
        beforeActivation
    {
        require(receivers.length > 0, "No receivers provided");
        require(
            receiverList.length + receivers.length <= maxNumReceivers,
            "Exceeds max receivers"
        );

        for (uint256 i = 0; i < receivers.length; i++) {
            require(receivers[i] != address(0), "Invalid receiver address");
            require(!approvedReceivers[receivers[i]], "Receiver already added");

            approvedReceivers[receivers[i]] = true;
            receiverList.push(receivers[i]);
        }

        emit ReceiversAdded(receivers);
    }

    /**
     * @notice Activate the project, locking funds and receiver list
     * @dev Ensures contract has enough balance for worst-case scenario:
     *      All receivers get maxPayout during active period + fees are paid from contract balance
     *      Fees are NOT deducted from vendor payouts - vendors receive the full promised amount
     */
    function activateAccount(
        CallSignature calldata signature
    )
        external
        onlyAppAdmin(signature, abi.encode(projectId, "activateAccount"))
        beforeActivation
    {

        require(receiverList.length > 0, "No receivers added");

        // Calculate required balance: maxPayout per receiver + fees
        // During active period, vendors receive full payment.amount, fees paid separately from contract balance
        // After lock expiry, emergency withdrawal pays basePayout (no fees)
        uint256 totalMaxPayout = maxPayout * receiverList.length;
        uint256 totalFees = (totalMaxPayout * (appFeeBps + pviumFeeBps)) /
            10000;
        uint256 requiredBalance = totalMaxPayout + totalFees;

        uint256 currentBalance = token.balanceOf(address(this));

        require(
            currentBalance >= requiredBalance,
            "Insufficient balance for activation"
        );

        isActive = true;
        activatedAt = block.timestamp;

        emit AccountActivated(block.timestamp);
    }

    /**
     * @notice Batch finalize approved receiver payouts (only callable by factory)
     * @dev Vendors receive the full payment.amount (no fee deductions)
     * @dev Fees are paid separately from the contract balance
     * @param receiverPayments Array of payout claims
     * @return totalAppFees Total app fees accumulated for this batch
     * @return totalPviumFees Total Pvium fees accumulated for this batch
     */
    function finalizeClaim(
        ReceiverPayoutPayload[] calldata receiverPayments
    )
        public
        nonReentrant
        onlyFactory
        afterActivation
        returns (uint256 totalAppFees, uint256 totalPviumFees)
    {
        require(receiverPayments.length > 0, "No payments provided");

        for (uint256 i = 0; i < receiverPayments.length; i++) {
            (
                uint256 receiverAmount,
                uint256 appFee,
                uint256 pviumFee
            ) = _validatePayout(receiverPayments[i]);

            // Transfer to receiver immediately
            token.safeTransfer(receiverPayments[i].receiver, receiverAmount);

            // Accumulate fees
            totalAppFees += appFee;
            totalPviumFees += pviumFee;

            emit ClaimFinalized(
                receiverPayments[i].claimId,
                receiverPayments[i].receiver,
                receiverAmount,
                appFee,
                pviumFee
            );
        }

        // Transfer app fees to factory (factory will handle distribution per token)
        if (totalAppFees > 0) {
            token.safeTransfer(address(factory), totalAppFees);
        }

        // Transfer Pvium fees to factory (factory will handle distribution per token)
        if (totalPviumFees > 0) {
            token.safeTransfer(address(factory), totalPviumFees);
        }

        return (totalAppFees, totalPviumFees);
    }

    /**
     * @notice Validate payout and return amounts (doesn't transfer)
     * @dev Receiver gets full payment.amount, fees are additional costs from contract balance
     * @return receiverAmount Full amount to send to receiver (= payment.amount)
     * @return appFee App fee amount (paid from contract balance, NOT deducted from receiverAmount)
     * @return pviumFee Pvium fee amount (paid from contract balance, NOT deducted from receiverAmount)
     */
    function _validatePayout(
        ReceiverPayoutPayload calldata payment
    )
        private
        returns (uint256 receiverAmount, uint256 appFee, uint256 pviumFee)
    {
        bytes32 claimId = payment.claimId;

        // Determine if this is a refund or receiver payment
        bool isRefund = payment.receiver == refundAddress;

        // Validate receiver
        if (isRefund) {
            // Refund to project owner - no receiver check needed
            require(
                payment.receiver == refundAddress,
                "Invalid refund address"
            );
        } else {
            // Payment to receiver - must be approved and not banned
            require(
                approvedReceivers[payment.receiver],
                "Receiver not approved"
            );
            require(!receiverBanned[payment.receiver], "Receiver is banned");

            // Check total payout cap (only for non-refunds)
            uint256 newTotal = totalPaidToReceiver[payment.receiver] +
                payment.amount;
            require(newTotal <= maxPayout, "Exceeds max receiver payout");
        }

        // Check if claim is permanently cancelled
        require(!cancelledClaims[claimId], "Claim cancelled");

        // Check if already finalized
        require(!finalizedClaims[claimId].claimed, "Already claimed");

        // Check if claim is actively disputed
        if (disputes[claimId].active) {
            // If dispute deadline has passed, claim remains blocked until explicitly resolved
            // This prevents auto-approval of disputed claims due to platform inaction
            revert("Claim is disputed");
        }

        // Time-based validation
        require(
            block.timestamp >= payment.claimableAfter,
            "Claim not yet claimable"
        );

        // Optional claim deadline check
        if (payment.claimDeadline > 0) {
            require(
                block.timestamp <= payment.claimDeadline,
                "Claim deadline expired"
            );
        }

        // Verify this payment is for this project
        require(
            keccak256(abi.encode(payment.app)) == keccak256(abi.encode(appId)),
            "Payment app mismatch"
        );
        require(
            keccak256(abi.encode(payment.projectId)) ==
                keccak256(abi.encode(projectId)),
            "Payment project mismatch"
        );

        require(verifyPayoutSignature(payment), "Invalid payout signer");
        // Calculate fees - fees are taken from contract balance, NOT deducted from vendor payout
        // Vendor receives the full payment.amount as promised
        receiverAmount = payment.amount;
        appFee = (payment.amount * appFeeBps) / 10000;
        // No Pvium fee on refunds
        pviumFee = isRefund ? 0 : (payment.amount * pviumFeeBps) / 10000;

        // Mark claim as finalized
        finalizedClaims[claimId] = FinalizedClaim({
            receiver: payment.receiver,
            amount: payment.amount,
            finalizedAt: block.timestamp,
            claimed: true
        });

        // Track total paid to receiver (only for non-refunds)
        if (!isRefund && approvedReceivers[payment.receiver]) {
            totalPaidToReceiver[payment.receiver] += payment.amount;
        }

        return (receiverAmount, appFee, pviumFee);
    }

    /**
     * @notice Raise a dispute for a claim
     * @param claimId Claim identifier
     * @param signature Signature from either receiver or app authorizing the dispute
     */
    function dispute(
        bytes32 claimId,
        bytes calldata signature
    ) external afterActivation {
        require(!cancelledClaims[claimId], "Claim already cancelled");
        require(!finalizedClaims[claimId].claimed, "Already claimed");
        require(!disputes[claimId].active, "Already disputed");

        // Verify signature - must be signed by app or approved receiver
        bytes32 messageHash = keccak256(abi.encode(claimId, block.chainid));
        bytes32 ethSignedMessageHash = messageHash.toEthSignedMessageHash();
        address signer = ethSignedMessageHash.recover(signature);

        require(
            factory.appAdmins(appIdBytes, signer) || approvedReceivers[signer],
            "Invalid dispute signature"
        );

        disputes[claimId] = Dispute({
            active: true,
            raisedAt: block.timestamp,
            deadline: block.timestamp + disputeWindowSeconds,
            raisedBy: signer
        });

        emit DisputeRaised(claimId, signer);
    }

    /**
     * @notice Resolve a dispute
     * @param claimId Claim identifier
     * @param allowClaim Whether to allow the claim
     * @param appSignature App's signature
     * @param pviumSignature Pvium's signature
     */
    function resolveDispute(
        bytes32 claimId,
        bool allowClaim,
        bytes calldata appSignature,
        bytes calldata pviumSignature
    ) external nonReentrant afterActivation {
        require(disputes[claimId].active, "No active dispute");

        // Verify signatures
        bytes32 messageHash = keccak256(
            abi.encode(claimId, allowClaim, block.chainid)
        );
        bytes32 ethSignedMessageHash = messageHash.toEthSignedMessageHash();

        address appSigner = ethSignedMessageHash.recover(appSignature);
        address pviumSigner = ethSignedMessageHash.recover(pviumSignature);

        require(
            factory.appAdmins(appIdBytes, appSigner),
            "Invalid app signature"
        );
        require(
            factory.isRelayer(pviumSigner),
            "Invalid relay signature"
        );

        // Clear dispute
        delete disputes[claimId];

        if (!allowClaim) {
            // Permanently cancel claim - prevents future execution
            cancelledClaims[claimId] = true;
        }

        emit DisputeResolved(claimId, allowClaim);
    }

    /**
     * @notice Ban or unban a receiver from receiving payments (only before lock expiry)
     * @param receiver Address to ban/unban
     * @param banned True to ban, false to unban
     */
    function banReceiver(
        address receiver,
        bool banned,
        CallSignature calldata signature
    )
        external
        onlyAppAdmin(
            signature,
            abi.encode(projectId, "banReceiver", receiver, banned)
        )
        afterActivation
    {
        require(
            block.timestamp < activatedAt + lockDurationSeconds,
            "Cannot ban/unban after lock expiry"
        );
        require(approvedReceivers[receiver], "Receiver not approved");
        require(receiverBanned[receiver] != banned, "Ban status unchanged");

        receiverBanned[receiver] = banned;
        emit ReceiverBanned(receiver, banned, block.timestamp);
    }

    /**
     * @notice Settle all unpaid receivers and return surplus after lock duration expires
     * @dev Can be called by anyone - automatically pays receivers who received $0 their basePayout
     * @dev After paying eligible receivers, remaining balance goes to refundAddress
     * @dev Only pays receivers who: 1) received nothing during active period, 2) are not banned
     */
    function withdraw() external nonReentrant afterActivation {
        require(activatedAt > 0, "Account not activated");
        require(
            block.timestamp >= activatedAt + lockDurationSeconds,
            "Lock duration not expired"
        );

        uint256 balance = token.balanceOf(address(this));
        if (balance == 0) {
            return; // Idempotent: no-op if no funds available
        }

        // Step 1: Pay receivers who received $0 during active period
        for (uint256 i = 0; i < receiverList.length; i++) {
            address receiver = receiverList[i];

            // Skip banned receivers
            if (receiverBanned[receiver]) {
                continue;
            }

            // Skip receivers who were paid during active period
            if (totalPaidToReceiver[receiver] > 0) {
                continue;
            }

            // Skip receivers who already withdrew via this function
            if (receiverEmergencyWithdrawnAmount[receiver] > 0) {
                continue;
            }

            // Calculate withdrawal amount (capped by remaining balance)
            uint256 currentBalance = token.balanceOf(address(this));
            if (currentBalance == 0) {
                break; // No more funds to distribute
            }

            uint256 withdrawAmount = basePayout;
            if (withdrawAmount > currentBalance) {
                withdrawAmount = currentBalance;
            }

            // Mark as withdrawn and transfer
            receiverEmergencyWithdrawnAmount[receiver] = withdrawAmount;
            token.safeTransfer(receiver, withdrawAmount);

            emit BasePayWithdrawal(receiver, withdrawAmount);
        }

        // Step 2: Send remaining balance to refundAddress
        uint256 remainingBalance = token.balanceOf(address(this));
        if (remainingBalance > 0) {
            token.safeTransfer(refundAddress, remainingBalance);
            emit SurplusWithdrawn(refundAddress, remainingBalance);
        }
    }

    // View functions

    /**
     * @notice Get Pvium address from factory
     */
    function pviumFeeAddress() public view returns (address) {
        return ISmartEscrowFactory(factory).pviumFeeAddress();
    }

    /**
     * @notice Get project balance
     */
    function getBalance() external view returns (uint256) {
        return token.balanceOf(address(this));
    }

    /**
     * @notice Get finalized claim details
     */
    function getFinalizedClaim(
        bytes32 claimId
    )
        external
        view
        returns (
            address receiver,
            uint256 amount,
            uint256 finalizedAt,
            bool claimed
        )
    {
        FinalizedClaim memory claim = finalizedClaims[claimId];
        return (claim.receiver, claim.amount, claim.finalizedAt, claim.claimed);
    }

    /**
     * @notice Check if a claim is cancelled
     */
    function isCancelled(bytes32 claimId) external view returns (bool) {
        return cancelledClaims[claimId];
    }

    /**
     * @notice Get dispute details
     */
    function getDispute(
        bytes32 claimId
    )
        external
        view
        returns (
            bool active,
            uint256 raisedAt,
            uint256 deadline,
            address raisedBy
        )
    {
        Dispute memory disputeData = disputes[claimId];
        return (
            disputeData.active,
            disputeData.raisedAt,
            disputeData.deadline,
            disputeData.raisedBy
        );
    }

    /**
     * @notice Get all approved receivers
     */
    function getReceivers() external view returns (address[] memory) {
        return receiverList;
    }

    /**
     * @notice Get receiver count
     */
    function getReceiverCount() external view returns (uint256) {
        return receiverList.length;
    }

    /**
     * @notice Get comprehensive project information
     */
    function getInfo()
        external
        view
        returns (
            string memory _appId,
            string memory _projectId,
            string memory _metadata,
            address _tokenAddress,
            uint256 _appFeeBps,
            uint256 _pviumFeeBps,
            uint256 _disputeWindowSeconds,
            uint256 _lockDuration,
            uint256 _basePayout,
            uint256 _maxPayout,
            uint256 _maxNumReceivers,
            address _appFeeAddress,
            address _pviumFeeAddress,
            uint _activatedAt,
            bool _isEnded,
            uint256 _balance,
            address[] memory _receivers
        )
    {
        return (
            appId,
            projectId,
            metadata,
            address(token),
            appFeeBps,
            pviumFeeBps,
            disputeWindowSeconds,
            lockDurationSeconds,
            basePayout,
            maxPayout,
            maxNumReceivers,
            ISmartEscrowFactory(factory).appFeeAddress(appId),
            pviumFeeAddress(),
            activatedAt,
            block.timestamp > activatedAt + lockDurationSeconds,
            token.balanceOf(address(this)),
            receiverList
        );
    }

    /**
     * @notice Verify a claim signature off-chain before submitting
     * @dev Allows receivers to verify payment commitment without gas costs
     * @param payment The claim payload to verify
     * @return isValid Whether the signature is valid
     */
    function verifyPayoutSignature(
        ReceiverPayoutPayload calldata payment
    ) public view returns (bool isValid) {
        // Verify payout signature
        bytes32 messageHash = keccak256(
            abi.encode(
                payment.app,
                payment.projectId,
                payment.claimId,
                payment.receiver,
                payment.amount,
                payment.claimableAfter,
                payment.claimDeadline
            )
        );
        bytes32 ethSignedMessageHash = messageHash.toEthSignedMessageHash();
        address signer = ethSignedMessageHash.recover(payment.appSignature);
        // require(appAdmins[signer], "Invalid app signature");
        return (factory.appAdmins(appIdBytes, signer));
    }
}
