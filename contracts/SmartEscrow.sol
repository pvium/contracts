// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import "./interfaces/ISmartEscrowFactory.sol";

/**
 * @title Project
 * @notice Individual escrow project for managing vendor payments
 * @dev Handles funding, vendor management, payouts, disputes, and fee distribution
 */
contract SmartEscrow is ReentrancyGuard {
    using SafeERC20 for IERC20;
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    
    // Structs
    struct CallSignature {
        uint256 nonce;
        bytes signature;
    }

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
        uint256 minimumBalancePerVendor;
        uint256 maxNumVendors;
        address appFeeAddress;
        address appAdminAddress;
    }

    struct CreateSmartEscrowPayload {
        string app;
        string projectId;
        string metadata;
        address tokenAddress;
        address refundAddress;
        address appFeeAddress;
        address appAdminAddress;
        uint256 appFeeBps;
        uint256 disputeWindowSeconds;
        uint256 lockDurationSeconds;
        uint256 minimumBalancePerVendor;
        uint256 maxNumVendors;
    }

    struct VendorPayoutPayload {
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
        address vendor;
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
    address public factory;
    address public appFeeAddress;
    address public refundAddress;
    IERC20 public token;
    string public metadata;
    mapping(address => mapping(uint256 => bool)) public consumedNonce;
    mapping(address => bool) public appAdmins;
    mapping(address => bool) public historicAdmins; // Override for compromized app platform keys.

    uint256 public appFeeBps;
    uint256 public pviumFeeBps;
    uint256 public disputeWindowSeconds;
    uint256 public lockDurationSeconds;
    uint256 public minimumBalancePerVendor;
    uint256 public maxNumVendors;

    bool public isActive;
    bool public isEnded;

    // Vendor management
    mapping(address => bool) public approvedVendors;
    address[] public vendorList;

    // Claim tracking
    mapping(bytes32 => FinalizedClaim) public finalizedClaims;
    mapping(bytes32 => bool) public cancelledClaims;
    mapping(bytes32 => Dispute) public disputes;

    // Nonces for replay protection
    mapping(address => uint256) public nonces;

    // Events
    event ProjectCreated(
        string appId,
        address tokenAddress,
        uint256 appFeeBps,
        uint256 pviumFeeBps
    );
    event ProjectFunded(address indexed funder, uint256 amount);
    event VendorsAdded(address[] vendors);
    event ProjectActivated(uint256 timestamp);
    event ClaimFinalized(
        bytes32 indexed claimId,
        address indexed vendor,
        uint256 vendorAmount,
        uint256 appFee,
        uint256 pviumFee
    );

    event DisputeRaised(bytes32 indexed claimId, address indexed raisedBy);
    event DisputeResolved(bytes32 indexed claimId, bool allowed);
    event ProjectEnded(string reason, uint256 timestamp);
    event AppAdminUpdated(address indexed admin, bool status);

     // Define roles
    bytes32 public constant PVIUM_ADMIN_ROLE = keccak256("PVIUM_ADMIN_ROLE");

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
        uint256 _minimumBalancePerVendor,
        uint256 _maxNumVendors,
        address _appFeeAddress,
        address _appAdminAddress
    ) {
        require(_factory != address(0), "Invalid factory address");
        require(_tokenAddress != address(0), "Invalid token address");
        require(_appFeeAddress != address(0), "Invalid app address");
        require(_refundAddress != address(0), "Invalid refund address");
        require(
            _appFeeBps + _pviumFeeBps <= 10000,
            "Total fees exceed 100%"
        );
        require(_maxNumVendors > 0, "Max vendors must be > 0");

        factory = _factory;
        appId = _appId;
        projectId = _projectId;
        metadata = _metadata;
        token = IERC20(_tokenAddress);
        refundAddress = _refundAddress;
        appFeeBps = _appFeeBps;
        pviumFeeBps = _pviumFeeBps;
        disputeWindowSeconds = _disputeWindowSeconds;
        lockDurationSeconds = _lockDuration;
        minimumBalancePerVendor = _minimumBalancePerVendor;
        maxNumVendors = _maxNumVendors;
        appFeeAddress = _appFeeAddress;

        // Set initial app admin
        appAdmins[_appAdminAddress] = true;
        historicAdmins[_appAdminAddress] = true;

        emit ProjectCreated(_appId, _tokenAddress, _appFeeBps, _pviumFeeBps);
    }

    // Modifiers
    modifier onlyApp(CallSignature calldata callSig, bytes memory payloadData) {
        if(callSig.signature.length == 0) {
            // Direct call - must be from an app admin
            require(appAdmins[msg.sender], "Only app admin can make this call");
        } else {
            // Relayed call with signature
            require(callSig.nonce > 0, "Nonce cannot be 0");
            require(!consumedNonce[msg.sender][callSig.nonce], "Nonce already consumed");

            // Verify app signature
            bytes32 messageHash = keccak256(
                abi.encode(
                    appId,
                    projectId,
                    payloadData,
                    callSig.nonce,
                    block.chainid
                )
            );
            bytes32 ethSignedMessageHash = messageHash.toEthSignedMessageHash();
            address signer = ethSignedMessageHash.recover(callSig.signature);

            require(appAdmins[signer] || (historicAdmins[signer] && ISmartEscrowFactory(factory).hasRole(PVIUM_ADMIN_ROLE, msg.sender)), "Invalid app admin signature");

            // Consume nonce after verification
            consumedNonce[msg.sender][callSig.nonce] = true;
        }
        _;
    }

    modifier onlyFactory() {
        require(msg.sender == factory, "Only factory");
        _;
    }

    modifier onlyFactoryOrApp() {
        require(
            msg.sender == factory || msg.sender == appFeeAddress,
            "Only factory or app"
        );
        _;
    }

    modifier beforeActivation() {
        require(!isActive, "Project already active");
        _;
    }

    modifier afterActivation() {
        require(isActive, "Project not active");
        _;
    }

    modifier notEnded() {
        require(!isEnded, "Project ended");
        _;
    }

    /**
     * @notice Fund the project with ERC20 tokens
     * @param amount Amount of tokens to deposit
     */
    function fundProject(uint256 amount) external nonReentrant notEnded {
        require(amount > 0, "Amount must be greater than 0");

        token.safeTransferFrom(msg.sender, address(this), amount);

        emit ProjectFunded(msg.sender, amount);
    }

    /**
     * @notice Add approved vendors to the project
     * @param vendors Array of vendor addresses
     */
    function addVendors(address[] calldata vendors, CallSignature calldata signature)
        external
        onlyApp(signature, abi.encode("addVendors", vendors))
        beforeActivation
        notEnded
    {
        require(vendors.length > 0, "No vendors provided");
        require(
            vendorList.length + vendors.length <= maxNumVendors,
            "Exceeds max vendors"
        );

        for (uint256 i = 0; i < vendors.length; i++) {
            require(vendors[i] != address(0), "Invalid vendor address");
            require(!approvedVendors[vendors[i]], "Vendor already added");

            approvedVendors[vendors[i]] = true;
            vendorList.push(vendors[i]);
        }

        emit VendorsAdded(vendors);
    }

    /**
     * @notice Activate the project, locking funds and vendor list
     */
    function activateProject(CallSignature calldata signature) external onlyApp(signature,  abi.encode("activateProject")) beforeActivation notEnded {
        require(vendorList.length > 0, "No vendors added");

        uint256 requiredBalance = minimumBalancePerVendor * vendorList.length;
        uint256 currentBalance = token.balanceOf(address(this));

        require(
            currentBalance >= requiredBalance,
            "Insufficient balance for activation"
        );

        isActive = true;

        emit ProjectActivated(block.timestamp);
    }

    /**
     * @notice Batch finalize approved vendor payouts (only callable by factory)
     * @param vendorPayments Array of payout claims
     * @return totalAppFees Total app fees accumulated for this batch
     * @return totalPviumFees Total Pvium fees accumulated for this batch
     */
    function finalizeClaim(
        VendorPayoutPayload[] calldata vendorPayments
    ) public nonReentrant onlyFactory afterActivation returns (uint256 totalAppFees, uint256 totalPviumFees) {
        require(vendorPayments.length > 0, "No payments provided");


        for (uint256 i = 0; i < vendorPayments.length; i++) {
            (uint256 receiverAmount, uint256 appFee, uint256 pviumFee) =
                _validatePayout(vendorPayments[i]);

            // Transfer to receiver immediately
            token.safeTransfer(vendorPayments[i].receiver, receiverAmount);

            // Accumulate fees
            totalAppFees += appFee;
            totalPviumFees += pviumFee;

            emit ClaimFinalized(
                vendorPayments[i].claimId,
                vendorPayments[i].receiver,
                receiverAmount,
                appFee,
                pviumFee
            );
        }

        // Transfer app fees to factory (factory will handle distribution per token)
        if (totalAppFees > 0) {
            token.safeTransfer(factory, totalAppFees);
        }

        // Transfer Pvium fees to factory (factory will handle distribution per token)
        if (totalPviumFees > 0) {
            token.safeTransfer(factory, totalPviumFees);
        }

        return (totalAppFees, totalPviumFees);
    }

    /**
     * @notice Validate payout and return amounts (doesn't transfer)
     * @return receiverAmount Amount to send to receiver
     * @return appFee App fee amount
     * @return pviumFee Pvium fee amount
     */
    function _validatePayout(VendorPayoutPayload calldata payment)
        private
        returns (uint256 receiverAmount, uint256 appFee, uint256 pviumFee)
    {
        bytes32 claimId = payment.claimId;

        // Determine if this is a refund or vendor payment
        bool isRefund = payment.receiver == refundAddress;

        // Validate receiver
        if (isRefund) {
            // Refund to project owner - no vendor check needed
            require(payment.receiver == refundAddress, "Invalid refund address");
        } else {
            // Payment to vendor - must be approved
            require(approvedVendors[payment.receiver], "Receiver not approved");
        }

        // Check if claim is permanently cancelled
        require(!cancelledClaims[claimId], "Claim cancelled");

        // Check if already finalized
        require(!finalizedClaims[claimId].claimed, "Already claimed");

        // Check if claim is actively disputed
        if (disputes[claimId].active) {
            // If dispute deadline has passed, auto-clear it
            if (block.timestamp > disputes[claimId].deadline) {
                delete disputes[claimId];
            } else {
                // Dispute still active
                revert("Claim is disputed");
            }
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
            keccak256(abi.encodePacked(payment.app)) == keccak256(abi.encodePacked(appId)),
            "Payment app mismatch"
        );
        require(
            keccak256(abi.encodePacked(payment.projectId)) == keccak256(abi.encodePacked(projectId)),
            "Payment project mismatch"
        );

        // Verify app signature
        bytes32 messageHash = keccak256(
            abi.encode(
                payment.app,
                payment.projectId,
                payment.claimId,
                payment.receiver,
                payment.amount,
                payment.claimableAfter,
                payment.claimDeadline,
                nonces[payment.receiver]
            )
        );
        bytes32 ethSignedMessageHash = messageHash.toEthSignedMessageHash();
        address signer = ethSignedMessageHash.recover(payment.appSignature);
        require(signer == appFeeAddress, "Invalid app signature");

        // Calculate fees
        appFee = (payment.amount * appFeeBps) / 10000;
        // No Pvium fee on refunds
        pviumFee = isRefund ? 0 : (payment.amount * pviumFeeBps) / 10000;
        receiverAmount = payment.amount - appFee - pviumFee;

        // Mark claim as finalized
        finalizedClaims[claimId] = FinalizedClaim({
            vendor: payment.receiver,
            amount: payment.amount,
            finalizedAt: block.timestamp,
            claimed: true
        });

        // Increment nonce
        nonces[payment.receiver]++;

        return (receiverAmount, appFee, pviumFee);
    }

    /**
     * @notice Raise a dispute for a claim
     * @param claimId Claim identifier
     * @param signature Signature from either vendor or app authorizing the dispute
     */
    function dispute(
        bytes32 claimId,
        bytes calldata signature
    ) external afterActivation notEnded {
        require(!cancelledClaims[claimId], "Claim already cancelled");
        require(!finalizedClaims[claimId].claimed, "Already claimed");
        require(!disputes[claimId].active, "Already disputed");

        // Verify signature - must be signed by app or approved vendor
        bytes32 messageHash = keccak256(
            abi.encode(claimId, block.chainid)
        );
        bytes32 ethSignedMessageHash = messageHash.toEthSignedMessageHash();
        address signer = ethSignedMessageHash.recover(signature);

        require(
            signer == appFeeAddress || approvedVendors[signer],
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
    ) external nonReentrant afterActivation notEnded {
        require(disputes[claimId].active, "No active dispute");

        // Verify signatures
        bytes32 messageHash = keccak256(
            abi.encode(claimId, allowClaim, block.chainid)
        );
        bytes32 ethSignedMessageHash = messageHash.toEthSignedMessageHash();

        address appSigner = ethSignedMessageHash.recover(appSignature);
        address pviumSigner = ethSignedMessageHash.recover(pviumSignature);

        require(appSigner == appFeeAddress, "Invalid app signature");
        require(pviumSigner == pviumFeeAddress(), "Invalid Pvium signature");

        // Clear dispute
        delete disputes[claimId];

        if (!allowClaim) {
            // Permanently cancel claim - prevents future execution
            cancelledClaims[claimId] = true;
        }

        emit DisputeResolved(claimId, allowClaim);
    }

    /**
     * @notice End the project and distribute remaining funds
     * @param reason Reason for ending the project
     */
    function endProject(string calldata reason, CallSignature calldata signature)
        external
        onlyApp(signature, abi.encode("endProject", reason))
        afterActivation
        notEnded
    {
        isEnded = true;

        emit ProjectEnded(reason, block.timestamp);
    }

    /**
     * @notice Set or revoke app admin status
     * @dev Only existing app admins can add/remove other admins
     * @param admin Address to update
     * @param status True to grant admin rights, false to revoke
     */
    function setAppAdmin(address admin, bool status, CallSignature calldata signature)
        external
        onlyApp(signature, abi.encode("setAppAdmin", admin, status))
        notEnded
    {
        require(admin != address(0), "Invalid admin address");
        require(appAdmins[admin] != status, "Admin status unchanged");

        appAdmins[admin] = status;
        if(status) {
             historicAdmins[admin] = true;
        }
        emit AppAdminUpdated(admin, status);
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
    function getFinalizedClaim(bytes32 claimId)
        external
        view
        returns (
            address vendor,
            uint256 amount,
            uint256 finalizedAt,
            bool claimed
        )
    {
        FinalizedClaim memory claim = finalizedClaims[claimId];
        return (
            claim.vendor,
            claim.amount,
            claim.finalizedAt,
            claim.claimed
        );
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
    function getDispute(bytes32 claimId)
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
     * @notice Get all approved vendors
     */
    function getVendors() external view returns (address[] memory) {
        return vendorList;
    }

    /**
     * @notice Get vendor count
     */
    function getVendorCount() external view returns (uint256) {
        return vendorList.length;
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
            uint256 _minimumBalancePerVendor,
            uint256 _maxNumVendors,
            address _appFeeAddress,
            address _pviumFeeAddress,
            bool _isActive,
            bool _isEnded,
            uint256 _balance,
            address[] memory _vendors
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
            minimumBalancePerVendor,
            maxNumVendors,
            appFeeAddress,
            pviumFeeAddress(),
            isActive,
            isEnded,
            token.balanceOf(address(this)),
            vendorList
        );
    }

    /**
     * @notice Verify a claim signature off-chain before submitting
     * @dev Allows vendors to verify payment commitment without gas costs
     * @param payment The claim payload to verify
     * @return isValid Whether the signature is valid
     * @return signer The address that signed the claim
     */
    function verifyClaimSignature(
        VendorPayoutPayload calldata payment
    ) external view returns (bool isValid, address signer) {
        bytes32 messageHash = keccak256(
            abi.encode(
                payment.app,
                payment.projectId,
                payment.claimId,
                payment.receiver,
                payment.amount,
                payment.claimableAfter,
                payment.claimDeadline,
                nonces[payment.receiver]
            )
        );
        bytes32 ethSignedMessageHash = messageHash.toEthSignedMessageHash();
        signer = ethSignedMessageHash.recover(payment.appSignature);
        isValid = (signer == appFeeAddress);

        return (isValid, signer);
    }
}
