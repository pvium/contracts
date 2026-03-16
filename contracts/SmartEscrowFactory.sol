// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./SmartEscrow.sol";
import "./SmartEscrowDeployer.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";

/**
 * @title ProjectFactory
 * @notice Factory contract for creating and managing escrow projects
 * @dev Creates SmartEscrow contracts using CREATE2 for deterministic addresses
 * @dev Role separation:
 *      - DEFAULT_ADMIN_ROLE (Super Admin): Manages fees, fee addresses, and role grants
 *      - PVIUM_ADMIN_ROLE (Attestation Admin): Signs attestations for project creation and claims
 */
contract SmartEscrowFactory is AccessControl {
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    // Define roles
    bytes32 public constant PVIUM_ADMIN_ROLE = keccak256("PVIUM_ADMIN_ROLE");

    // Domain prefixes for signature verification
    bytes32 private constant SIGNATURE_DOMAIN = keccak256("PVIUM_SIGNATURE_MESSAGE");

    // Deployer contract for CREATE2 deployments
    SmartEscrowDeployer public immutable deployer;

    // Pvium protocol fee in basis points (e.g., 100 = 1%)
    uint256 public pviumFeeBps;

    // Pvium address that receives protocol fees
    address public pviumFeeAddress;

    // App ID => App fee address
    mapping(bytes32 => address) public appFeeAddresses;

    // App ID => SmartEscrow addresses
    mapping(string => address[]) private appProjects;

    // Unique project tracking: hash(app || projectId) => project address
    mapping(bytes32 => address) public projectsByUniqueId;

    // Events
    event EscrowContractCreated(
        address indexed projectAddress,
        string indexed appId,
        string projectId,
        bytes32 indexed uniqueId,
        address token,
        uint256 appFeeBps,
        uint256 pviumFeeBps,
        uint256 minimumBalancePerVendor
    );

    event PviumFeeUpdated(uint256 oldFee, uint256 newFee);
    event PviumFeeAddressUpdated(address oldAddress, address newAddress);
    event AppFeeAddressUpdated(string indexed appId, address oldAddress, address newAddress);
    event PviumAdminGranted(address indexed admin);
    event PviumAdminRevoked(address indexed admin);

    /**
     * @notice Constructor
     * @param _pviumFeeBps Initial Pvium protocol fee in basis points
     * @param _pviumAdminAddress Address granted both DEFAULT_ADMIN_ROLE and PVIUM_ADMIN_ROLE
     * @param _pviumFeeAddress Address that receives Pvium protocol fees
     * @param _deployer Address of the SmartEscrowDeployer contract
     */
    constructor(
        uint256 _pviumFeeBps,
        address _pviumAdminAddress,
        address _pviumFeeAddress,
        address _deployer
    ) {
        require(_pviumAdminAddress != address(0), "Invalid admin");
        require(_pviumFeeAddress != address(0), "Invalid fee addr");
        require(_deployer != address(0), "Invalid deployer");
        require(_pviumFeeBps <= 10000, "Fee exceeds 100%");

        deployer = SmartEscrowDeployer(_deployer);
        pviumFeeBps = _pviumFeeBps;
        pviumFeeAddress = _pviumFeeAddress;

        // Grant roles
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(PVIUM_ADMIN_ROLE, _pviumAdminAddress);
    }

    /**
     * @notice Create a new project using CREATE2 for deterministic address
     * @dev Address is deterministic based on (app, projectId) and all constructor params
     * @dev Requires Pvium attestation to prevent unauthorized project creation
     * @param payload SmartEscrow configuration data
     * @param appSignature App signature authorizing project creation
     * @param pviumSignature Pvium signature attesting the app owner
     * @return projectAddress Address of the newly created project
     */
    function createProject(
        SmartEscrow.CreateSmartEscrowPayload calldata payload,
        bytes calldata appSignature,
        bytes calldata pviumSignature
    ) external returns (address projectAddress) {
        // Verify app signature first
        address appAddress = _verifyAppSignature(payload, appSignature);
        require(appAddress == payload.appAdminAddress, "Not app admin");

        // Verify Pvium attestation - Pvium attests that this address is legitimate owner of the app
        _verifyPviumAttestation(appSignature, pviumSignature);

        // Set app fee address if not already set
        bytes32 appHash = keccak256(abi.encodePacked(payload.app));
        if (appFeeAddresses[appHash] == address(0)) {
            appFeeAddresses[appHash] = payload.appFeeAddress;
        }

        // Generate unique project ID from app and projectId only
        // This allows deterministic address computation for pre-funding
        bytes32 uniqueId = keccak256(
            abi.encodePacked(payload.app, payload.projectId)
        );

        // Check if project already exists
        require(projectsByUniqueId[uniqueId] == address(0), "Project exists");
        

        // Deploy project using CREATE2
        // Bytecode includes all parameters, preventing parameter tampering
        projectAddress = _deployProject(payload, uniqueId);

        // Store project mappings
        appProjects[payload.app].push(projectAddress);
        projectsByUniqueId[uniqueId] = projectAddress;

        emit EscrowContractCreated(
            projectAddress,
            payload.app,
            payload.projectId,
            uniqueId,
            payload.tokenAddress,
            payload.appFeeBps,
            pviumFeeBps,
            payload.minimumBalancePerVendor
        );

        return projectAddress;
    }

    /**
     * @notice Internal function to verify app signature
     * @return signer Address that signed the message
     */
    function _verifyAppSignature(
        SmartEscrow.CreateSmartEscrowPayload calldata payload,
        bytes calldata signature
    ) private view returns (address signer) {
        bytes32 messageHash = keccak256(
            abi.encode(
                SIGNATURE_DOMAIN,
                payload.app,
                payload.projectId,
                payload.metadata,
                payload.tokenAddress,
                payload.refundAddress,
                payload.appFeeAddress,
                payload.appAdminAddress,
                payload.appFeeBps,
                payload.disputeWindowSeconds,
                payload.lockDurationSeconds,
                payload.minimumBalancePerVendor,
                pviumFeeBps,
                block.chainid
            )
        );

        bytes32 ethSignedMessageHash = messageHash.toEthSignedMessageHash();
        signer = ethSignedMessageHash.recover(signature);

        require(signer != address(0), "Invalid app signature");

        return signer;
    }

    /**
     * @notice Internal function to verify Pvium attestation
     * @dev Pvium attests that the given address is the legitimate owner of the app
     * @param payloadSignature Signature of caller identifier
     * @param signature Pvium signature attesting ownership
     */
    function _verifyPviumAttestation(
        bytes calldata payloadSignature,
        bytes calldata signature
    ) private view {
        bytes32 messageHash = keccak256(
            abi.encode(
                SIGNATURE_DOMAIN,
                payloadSignature,
                block.chainid
            )
        );

        bytes32 ethSignedMessageHash = messageHash.toEthSignedMessageHash();
        address signer = ethSignedMessageHash.recover(signature);

        require(hasRole(PVIUM_ADMIN_ROLE, signer), "Invalid attestation");
    }

    /**
     * @notice Internal function to deploy project using deployer contract
     */
    function _deployProject(
        SmartEscrow.CreateSmartEscrowPayload calldata payload,
        bytes32 uniqueId
    ) private returns (address) {
        return deployer.deploySmartEscrow(payload, pviumFeeBps, uniqueId);
    }

    /**
     * @notice Compute the deterministic project address before deployment
     * @param payload Project configuration data
     * @return Predicted project address
     */
    function computeProjectAddress(
        SmartEscrow.CreateSmartEscrowPayload calldata payload
    ) external view returns (address) {
        bytes32 uniqueId = keccak256(
            abi.encodePacked(payload.app, payload.projectId)
        );
        return deployer.computeAddress(address(this), payload, pviumFeeBps, uniqueId);
    }

    /**
     * @notice Get project address by unique ID (app + projectId)
     * @param app App identifier
     * @param projectId Project identifier
     * @return Project address (address(0) if not deployed)
     */
    function getProjectByUniqueId(string calldata app, string calldata projectId)
        public
        view
        returns (address)
    {
        bytes32 uniqueId = keccak256(abi.encodePacked(app, projectId));
        return projectsByUniqueId[uniqueId];
    }

    /**
     * @notice Get paginated projects for an app
     * @param appId App identifier
     * @param page Page number (0-indexed)
     * @param perPage Number of items per page
     * @return projects Array of project addresses for the requested page
     * @return total Total number of projects for this app
     */
    function getProjects(string calldata appId, uint256 page, uint256 perPage)
        external
        view
        returns (address[] memory projects, uint256 total)
    {
        address[] storage allProjects = appProjects[appId];
        total = allProjects.length;

        uint256 startIndex = page * perPage;
        if (startIndex >= total || perPage == 0) {
            return (new address[](0), total);
        }

        uint256 endIndex = startIndex + perPage;
        if (endIndex > total) endIndex = total;

        projects = new address[](endIndex - startIndex);
        for (uint256 i = 0; i < projects.length; i++) {
            projects[i] = allProjects[startIndex + i];
        }
    }

    /**
     * @notice Update Pvium protocol fee (only callable by super admin)
     * @param newFeeBps New fee in basis points
     */
    function updatePviumFee(uint256 newFeeBps) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(newFeeBps <= 10000, "Fee exceeds 100%");

        uint256 oldFee = pviumFeeBps;
        pviumFeeBps = newFeeBps;

        emit PviumFeeUpdated(oldFee, newFeeBps);
    }

    /**
     * @notice Update Pvium fee address (only callable by super admin)
     * @param newAddress New Pvium fee address
     */
    function updatePviumFeeAddress(address newAddress) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(newAddress != address(0), "Invalid address");

        address oldAddress = pviumFeeAddress;
        pviumFeeAddress = newAddress;

        emit PviumFeeAddressUpdated(oldAddress, newAddress);
    }

    /**
     * @notice Grant Pvium admin role (only callable by default admin)
     * @param admin Address to grant admin role
     */
    function grantPviumAdmin(address admin) external onlyRole(DEFAULT_ADMIN_ROLE) {
        grantRole(PVIUM_ADMIN_ROLE, admin);
        emit PviumAdminGranted(admin);
    }

    /**
     * @notice Revoke Pvium admin role (only callable by default admin)
     * @param admin Address to revoke admin role
     */
    function revokePviumAdmin(address admin) external onlyRole(DEFAULT_ADMIN_ROLE) {
        revokeRole(PVIUM_ADMIN_ROLE, admin);
        emit PviumAdminRevoked(admin);
    }

    /**
     * @notice Update app fee address (only callable by current app address)
     * @param appId App identifier
     * @param newAddress New app fee address
     */
    function updateAppFeeAddress(string calldata appId, address newAddress) external {
        bytes32 appHash = keccak256(abi.encodePacked(appId));
        require(msg.sender == appFeeAddresses[appHash], "Not authorized");
        require(newAddress != address(0), "Invalid address");

        address oldAddress = appFeeAddresses[appHash];
        appFeeAddresses[appHash] = newAddress;

        emit AppFeeAddressUpdated(appId, oldAddress, newAddress);
    }

    /**
     * @notice Get app fee address (implements ISmartEscrowFactory)
     */
    function appFeeAddress(string calldata appId) external view returns (address) {
        bytes32 appHash = keccak256(abi.encodePacked(appId));
        return appFeeAddresses[appHash];
    }

    /**
     * @notice Batch finalize approved vendor payouts with Pvium signature verification
     * @param vendorPayments Array of payout claims
     * @param pviumSignature Pvium signature validating the claims
     */
    function finalizeClaim(
        SmartEscrow.VendorPayoutPayload[] calldata vendorPayments,
        bytes calldata pviumSignature
    ) external {
        require(vendorPayments.length > 0, "No payments");

        // Verify Pvium signature - hash app, projectId, and claimIds for gas efficiency
        bytes memory dataPacked;
        for (uint256 i = 0; i < vendorPayments.length; i++) {
            dataPacked = abi.encodePacked(
                dataPacked,
                vendorPayments[i].app,
                vendorPayments[i].projectId,
                vendorPayments[i].claimId
            );
        }
        bytes32 messageHash = keccak256(abi.encodePacked(dataPacked, block.chainid));
        bytes32 ethSignedMessageHash = messageHash.toEthSignedMessageHash();
        address signer = ethSignedMessageHash.recover(pviumSignature);
        require(hasRole(PVIUM_ADMIN_ROLE, signer), "Invalid signature");

        // Track Pvium fees per token using dynamic arrays
        address[] memory tokens = new address[](vendorPayments.length);
        uint256[] memory pviumFees = new uint256[](vendorPayments.length);
        uint256[] memory appFees = new uint256[](vendorPayments.length);
        uint256 uniqueTokenCount = 0;

        // Group payments by project and process
        for (uint256 i = 0; i < vendorPayments.length; i++) {
            address projectAddress = getProjectByUniqueId(
                vendorPayments[i].app,
                vendorPayments[i].projectId
            );
            require(projectAddress != address(0), "Project not found");

            // Create single-payment array for this project
            SmartEscrow.VendorPayoutPayload[] memory singlePayment =
                new SmartEscrow.VendorPayoutPayload[](1);
            singlePayment[0] = vendorPayments[i];

            // Call finalizeClaim on the project contract (transfers to vendor and app)
            // Returns total Pvium fees for this payment
           ( uint256 appFee, uint256 pviumFee ) = SmartEscrow(projectAddress).finalizeClaim(singlePayment);

            if (pviumFee > 0) {
                address tokenAddress = address(SmartEscrow(projectAddress).token());

                // Accumulate Pvium fees per token
                bool tokenFound = false;
              
                for (uint256 j = 0; j < uniqueTokenCount; j++) {
                    if (tokens[j] == tokenAddress) {
                        pviumFees[j] += pviumFee;
                        appFees[j] += appFee;
                        tokenFound = true;
                        break;
                    }
                }
                if (!tokenFound) {
                    tokens[uniqueTokenCount] = tokenAddress;
                    pviumFees[uniqueTokenCount] = pviumFee;
                    appFees[uniqueTokenCount] = appFee;
                    uniqueTokenCount++;
                }
            }
        }

        // Transfer accumulated fees per token
        for (uint256 i = 0; i < uniqueTokenCount; i++) {
            if (pviumFees[i] > 0) {
                // Pvium fees are already in factory from SmartEscrow transfer
                IERC20(tokens[i]).transfer(pviumFeeAddress, pviumFees[i]);
            }
            if (appFees[i] > 0) {
                // App fees are already in factory from SmartEscrow transfer
                // Get app address from first payment (all should be same app per token logic)
                string memory app = vendorPayments[0].app;
                bytes32 appHash = keccak256(abi.encodePacked(app));
                address appFeeAddr = appFeeAddresses[appHash];
                require(appFeeAddr != address(0), "App fee not set");
                IERC20(tokens[i]).transfer(appFeeAddr, appFees[i]);
            }
        }
    }
}
