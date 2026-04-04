// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.24;

import "./SmartEscrow.sol";
import "./SmartEscrowDeployer.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "hardhat/console.sol";

/**
 * @title ProjectFactory
 * @notice Factory contract for creating and managing escrow projects
 * @dev Creates SmartEscrow contracts using CREATE2 for deterministic addresses
 * @dev Role separation:
 *      - DEFAULT_ADMIN_ROLE (Super Admin): Manages fees, fee addresses, and role grants
 *      - PVIUM_RELAY_ROLE (Public Attestation Servcer): Signs attestations for project creation and claims
 */
contract SmartEscrowFactory is AccessControl {
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    // Define roles
    bytes32 public constant PVIUM_RELAY_ROLE = keccak256("PVIUM_RELAY_ROLE");

    // Domain prefixes for signature verification
    bytes32 private constant SIGNATURE_DOMAIN =
        keccak256("PVIUM_SIGNATURE_MESSAGE");

    // Deployer contract for CREATE2 deployments
    SmartEscrowDeployer public immutable deployer;

    // Pvium protocol fee in basis points (e.g., 100 = 1%)
    uint256 public pviumFeeBps;

    // Pvium protocol fee in basis points (e.g., 100 = 1%)
    uint256 public withdrawalProccessorFeeBps;

    // Accepted token addresses - only tokens in this mapping can be used for escrow accounts
    mapping(address => bool) public acceptedTokens;

    // App ID => App fee address
    mapping(bytes32 => address) public appFeeAddress;

    // App ID => SmartEscrow addresses
    mapping(string => address[]) private appAccount;
   

    uint validityPeriod;

    address pviumRelayAddress;
    // Unique account tracking: hash(app || projectId) => account address
    mapping(bytes32 => address) public accountsByUniqueId;
    mapping(bytes32 => mapping(address => bool)) public appAdmins;
     mapping(bytes32 => uint) private appAdminUpdatedTimestamp;
    mapping(bytes32 => mapping(address => bool)) public historicAdmins;
    mapping(address => address) public accountRelayer;
    mapping(bytes32 => mapping(address => mapping(uint256 => bool)))
        public consumedNonce;
    mapping(address => address) public relayFeeAddress;

    // Operator => Relayer mapping
    // Maps operator addresses to their assigned relayer addresses
    mapping(address => address) public operatorToRelayer;
    mapping(bytes32 => mapping(address => bool)) public receiverBanned; // Ban status

    // Events
    event EscrowContractCreated(
        address indexed accountAddress,
        string indexed appId,
        string projectId,
        bytes32 indexed uniqueId,
        address token,
        uint256 appFeeBps,
        uint256 pviumFeeBps,
        uint256 minimumBalancePerVendor
    );

    event PviumFeeUpdated(uint256 oldFee, uint256 newFee);
    event WithdrawalRelayerFeeUpdated(uint256 oldFee, uint256 newFee);
    event RelayFeeAddressUpdated(address oldAddress, address newAddress);
    event AppFeeAddressUpdated(
        string indexed appId,
        address oldAddress,
        address newAddress
    );
    event RoleGranted(address indexed admin, bytes32 indexed role);
    event RoleRevoked(address indexed admin, bytes32 indexed role);
    event AppAdminUpdated(
        string indexed appId,
        address indexed admin,
        bool status
    );
    event TokenAcceptanceUpdated(address indexed token, bool accepted);
    event OperatorUpdated(
        address indexed operator,
        address indexed relayer,
        bool enabled
    );
    event ReceiverBanned(
        bytes32 indexed appIdBytes,
        address indexed receiver,
        bool banned
    );

    /**
     * @notice Constructor
     * @param _pviumFeeBps Initial Pvium protocol fee in basis points
     * @param _pviumAdminAddress Address granted both DEFAULT_ADMIN_ROLE and PVIUM_RELAY_ROLE
     * @param _pviumFeeAddress Address that receives Pvium protocol fees
     * @param _deployer Address of the SmartEscrowDeployer contract
     * @param _createPayloadValidity validity duration of create payload
     * @param _acceptedTokens Array of initially accepted token addresses
     */
    constructor(
        uint256 _pviumFeeBps,
        uint256 _withdrawalRelayerBps,
        address _pviumAdminAddress,
        address _pviumFeeAddress,
        address _deployer,
        uint _createPayloadValidity,
        address[] memory _acceptedTokens
    ) {
        require(_pviumAdminAddress != address(0), "Invalid admin");
        require(_pviumFeeAddress != address(0), "Invalid fee addr");
        require(_deployer != address(0), "Invalid deployer");
        require(_pviumFeeBps <= 10000, "Fee exceeds 100%");

        deployer = SmartEscrowDeployer(_deployer);
        pviumFeeBps = _pviumFeeBps;

        // Grant roles
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(PVIUM_RELAY_ROLE, _pviumAdminAddress);
        relayFeeAddress[_pviumAdminAddress] = _pviumFeeAddress;
        pviumRelayAddress = _pviumAdminAddress;
        validityPeriod = _createPayloadValidity;
        withdrawalProccessorFeeBps = _withdrawalRelayerBps;

        // Set initial accepted tokens
        for (uint256 i = 0; i < _acceptedTokens.length; i++) {
            require(_acceptedTokens[i] != address(0), "Invalid token address");
            acceptedTokens[_acceptedTokens[i]] = true;
            emit TokenAcceptanceUpdated(_acceptedTokens[i], true);
        }
    }

    /**
     * @notice Create a new account using CREATE2 for deterministic address
     * @dev Address is deterministic based on (app, projectId) and all constructor params
     * @dev Requires Pvium attestation to prevent unauthorized project creation
     * @param payload SmartEscrow configuration data
     * @param appSignature App signature authorizing project creation
     * @param relayerSignature Pvium signature attesting the app owner
     * @return accountAddress Address of the newly created account
     */
    function createAccount(
        SmartEscrow.CreateSmartEscrowPayload calldata payload,
        address _appFeeAddress,
        bytes calldata appSignature,
        bytes calldata relayerSignature
    ) external returns (address accountAddress) {
        //check to make sure request is not expired
        require(
            payload.timestamp > block.timestamp - validityPeriod,
            "Payload timestamp exceeded"
        );
        require(
            payload.timestamp < block.timestamp + validityPeriod,
            "Payload timestamp too early"
        );

        // Verify token is accepted
        require(acceptedTokens[payload.tokenAddress], "Token not accepted");

        // Verify app signature first
        address appAdminAddress = _verifyAppSignature(
            payload,
            _appFeeAddress,
            appSignature
        );
        console.log("AppAdmin", appAdminAddress);

        // Verify Pvium attestation - Pvium attests that this address is legitimate owner of the app
        address relayer = _verifyRelayAttestation(
            appSignature,
            relayerSignature
        );

        // Set app fee address if not already set
        bytes32 appHashPacked = keccak256(abi.encode(payload.app));
        if (appFeeAddress[appHashPacked] == address(0)) {
            appFeeAddress[appHashPacked] = _appFeeAddress;
        }

        // Set app admin if not already set (allows bootstrapping first admin)
        // Note: Use abi.encode (not encodePacked) to match SmartEscrow.appIdBytes
        bytes32 appHash = keccak256(abi.encode(payload.app));
        if (!appAdmins[appHash][appAdminAddress]) {
            appAdmins[appHash][appAdminAddress] = true;
        }
        historicAdmins[appHash][appAdminAddress] = true;

        // Generate unique project ID from app and projectId only
        // This allows deterministic address computation for pre-funding
        bytes32 uniqueId = keccak256(
            abi.encode(payload.app, payload.projectId)
        );

        // Check if account already exists
        require(accountsByUniqueId[uniqueId] == address(0), "Account exists");

        // Deploy account using CREATE2
        // Bytecode includes all parameters, preventing parameter tampering
        accountAddress = _deployAccount(payload, uniqueId);

        // Store account mappings
        appAccount[payload.app].push(accountAddress);
        accountsByUniqueId[uniqueId] = accountAddress;
        accountRelayer[accountAddress] = relayer;

        emit EscrowContractCreated(
            accountAddress,
            payload.app,
            payload.projectId,
            uniqueId,
            payload.tokenAddress,
            payload.appFeeBps,
            pviumFeeBps,
            payload.basePayout
        );

        return accountAddress;
    }

    modifier onlyAppAdmin(
        bytes32 appIdBytes,
        CallSignature calldata callSig,
        bytes memory payloadData
    ) {
        validateAppAdmin(appIdBytes, msg.sender, callSig, payloadData, false);
        _;
    }

    function banReceiver(
        bytes32 appBytes,
        address receiver,
        bool banned,
        CallSignature calldata signature
    )
        public
        onlyAppAdmin(
            appBytes,
            signature,
            abi.encode(address(this), "banReceiver", appBytes, receiver, banned)
        )
    {
        if (banned) {
            require(
                !receiverBanned[appBytes][receiver],
                "receiver alread banned"
            );
        } else {
            require(
                receiverBanned[appBytes][receiver],
                "receiver alread banned"
            );
        }
        receiverBanned[appBytes][receiver] = banned;
        emit ReceiverBanned(appBytes, receiver, banned);
    }

    function validateAppAdmin(
        bytes32 appIdBytes,
        address caller,
        CallSignature calldata callSig,
        bytes memory payloadData,
        bool allowHistoricAdmin
    ) public returns (address signer) {
        console.log("ValidatingAppAdmin");
        if (callSig.signature.length == 0) {
            // Direct call - must be from an app admin
            require(
                appAdmins[appIdBytes][caller],
                "Only app admin can make this call"
            );
        } else {
            // Relayed call with signature
            require(callSig.nonce > 0, "Nonce cannot be 0");

            // Verify app signature
            bytes32 messageHash = keccak256(
                abi.encode(
                    appIdBytes,
                    payloadData,
                    callSig.nonce,
                    block.chainid
                )
            );
            bytes32 ethSignedMessageHash = messageHash.toEthSignedMessageHash();

            signer = ethSignedMessageHash.recover(callSig.signature);
            require(
                !consumedNonce[appIdBytes][signer][callSig.nonce],
                "Nonce already consumed"
            );
            if (allowHistoricAdmin) {
                 require(
                    appAdmins[appIdBytes][signer] ||
                        (historicAdmins[appIdBytes][signer] &&
                            isRelayer(caller)),
                    "Invalid app admin signature"
                ); 
            } else {
                require(
                    appAdmins[appIdBytes][signer],
                    "Invalid app admin signature"
                );
            }

            // Consume nonce after verification
            consumedNonce[appIdBytes][signer][callSig.nonce] = true;
        }
    }

    /**
     * @notice Internal function to verify app signature
     * @return signer Address that signed the message
     */
    function _verifyAppSignature(
        SmartEscrow.CreateSmartEscrowPayload calldata payload,
        address _appFeeAddress,
        bytes calldata signature
    ) private view returns (address signer) {
        bytes32 messageHash = keccak256(
            abi.encode(
                SIGNATURE_DOMAIN,
                payload.app,
                _appFeeAddress,
                payload.projectId,
                payload.metadata,
                payload.tokenAddress,
                payload.refundAddress,
                payload.appFeeBps,
                payload.disputeWindowSeconds,
                payload.lockDurationSeconds,
                payload.basePayout,
                payload.maxPayout,
                payload.timestamp,
                block.chainid
            )
        );

        bytes32 ethSignedMessageHash = messageHash.toEthSignedMessageHash();
        signer = ethSignedMessageHash.recover(signature);

        require(signer != address(0), "Invalid app signature");

        return signer;
    }

    /**
     * @notice Set or revoke app admin status
     * @dev Only existing app admins can add/remove other admins
     * @param admin Address to update
     * @param status True to grant admin rights, false to revoke
     */
    function setAppAdmin(
        string memory appId,
        address admin,
        bool status,
        CallSignature calldata signature
    )
        external
    {
        bytes32 appIdHash = keccak256(abi.encode(appId));
        address callDataSigner = validateAppAdmin(appIdHash, msg.sender, signature, abi.encode(address(this), "setAppAdmin", admin, status), true);
        require(admin != address(0), "Invalid admin address");
        bytes32 hash = keccak256(abi.encode(appId));
        require(appAdmins[hash][admin] != status, "Admin status unchanged");
        require(
            historicAdmins[hash][callDataSigner] ||
            block.timestamp > appAdminUpdatedTimestamp[appIdHash] + 5 minutes,
            "Can only update admin status once every 5 minutes"
        );
       appAdminUpdatedTimestamp[appIdHash] = block.timestamp;
       
        appAdmins[hash][admin] = status;
        if (status) {
            historicAdmins[hash][admin] = true;
        }
        emit AppAdminUpdated(appId, admin, status);
    }

    /**
     * @notice Internal function to verify Pvium attestation for creation
     * @dev Pvium attests that the given address is the legitimate owner of the app
     * @param payloadSignature Signature of caller identifier
     * @param signature Pvium signature attesting ownership
     */
    function _verifyRelayAttestation(
        bytes calldata payloadSignature,
        bytes calldata signature
    ) private view returns (address) {
        bytes32 messageHash = keccak256(
            abi.encode(
                SIGNATURE_DOMAIN,
                payloadSignature,
                address(this),
                block.chainid
            )
        );

        bytes32 ethSignedMessageHash = messageHash.toEthSignedMessageHash();
        address signer = ethSignedMessageHash.recover(signature);

        // Check if signer is a relayer or an operator for a relayer
        require(isRelayer(signer), "Invalid attestation");

        // Return the actual relayer address (if signer is an operator, return their relayer)
        if (operatorToRelayer[signer] != address(0)) {
            return operatorToRelayer[signer];
        }
        return signer;
    }

    /**
     * @notice Internal function to deploy account using deployer contract
     */
    function _deployAccount(
        SmartEscrow.CreateSmartEscrowPayload calldata payload,
        bytes32 uniqueId
    ) private returns (address) {
        return deployer.deploySmartEscrow(payload, pviumFeeBps, uniqueId);
    }

    /**
     * @notice Internal function to deploy account using deployer contract
     */
    function isRelayer(address addr) public view returns (bool) {
        return
            hasRole(PVIUM_RELAY_ROLE, addr) ||
            hasRole(PVIUM_RELAY_ROLE, operatorToRelayer[addr]);
    }

    /**
     * @notice Compute the deterministic account address before deployment
     * @param payload Account configuration data
     * @return Predicted account address
     */
    function computeAccountAddress(
        SmartEscrow.CreateSmartEscrowPayload calldata payload
    ) external view returns (address) {
        bytes32 uniqueId = keccak256(
            abi.encode(payload.app, payload.projectId)
        );
        return
            deployer.computeAddress(
                address(this),
                payload,
                pviumFeeBps,
                uniqueId
            );
    }

    /**
     * @notice Get account address by unique ID (app + projectId)
     * @param app App identifier
     * @param projectId Project identifier
     * @return Account address (address(0) if not deployed)
     */
    function getAccountByUniqueId(
        string calldata app,
        string calldata projectId
    ) public view returns (address) {
        bytes32 uniqueId = keccak256(abi.encode(app, projectId));
        return accountsByUniqueId[uniqueId];
    }

    /**
     * @notice Get Pvium relay fee address (backward compatibility)
     * @return The fee address for the primary Pvium relay
     */
    function pviumFeeAddress() external view returns (address) {
        return relayFeeAddress[pviumRelayAddress];
    }

    /**
     * @notice Get paginated accounts for an app
     * @param appId App identifier
     * @param page Page number (0-indexed)
     * @param perPage Number of items per page
     * @return accounts Array of account addresses for the requested page
     * @return total Total number of accounts for this app
     */
    function getAccounts(
        string calldata appId,
        uint256 page,
        uint256 perPage
    ) external view returns (address[] memory accounts, uint256 total) {
        address[] storage allAccounts = appAccount[appId];
        total = allAccounts.length;

        uint256 startIndex = page * perPage;
        if (startIndex >= total || perPage == 0) {
            return (new address[](0), total);
        }

        uint256 endIndex = startIndex + perPage;
        if (endIndex > total) endIndex = total;

        accounts = new address[](endIndex - startIndex);
        for (uint256 i = 0; i < accounts.length; i++) {
            accounts[i] = allAccounts[startIndex + i];
        }
    }

    /**
     * @notice Add or remove an accepted token (only callable by super admin)
     * @param token Token address to update
     * @param accepted True to accept the token, false to reject it
     */
    function setAcceptedToken(
        address token,
        bool accepted
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(token != address(0), "Invalid token address");
        require(
            acceptedTokens[token] != accepted,
            "Token acceptance unchanged"
        );

        acceptedTokens[token] = accepted;
        emit TokenAcceptanceUpdated(token, accepted);
    }

    /**
     * @notice Batch add or remove accepted tokens (only callable by super admin)
     * @param tokens Array of token addresses to update
     * @param accepted Array of acceptance statuses (true to accept, false to reject)
     */
    function setAcceptedTokensBatch(
        address[] calldata tokens,
        bool[] calldata accepted
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(tokens.length == accepted.length, "Array length mismatch");
        require(tokens.length > 0, "Empty arrays");

        for (uint256 i = 0; i < tokens.length; i++) {
            require(tokens[i] != address(0), "Invalid token address");
            if (acceptedTokens[tokens[i]] != accepted[i]) {
                acceptedTokens[tokens[i]] = accepted[i];
                emit TokenAcceptanceUpdated(tokens[i], accepted[i]);
            }
        }
    }

    /**
     * @notice Set or unset an operator for the calling relayer
     * @dev Only addresses with PVIUM_RELAY_ROLE can call this function
     * @dev An operator can only be assigned to one relayer at a time
     * @dev Only the relayer who assigned an operator can unassign it
     * @param operator The operator address to set or unset
     * @param enabled True to assign operator to caller, false to unassign
     */
    function setOperator(
        address operator,
        bool enabled
    ) external onlyRole(PVIUM_RELAY_ROLE) {
        require(operator != address(0), "Invalid operator address");

        if (enabled) {
            // Assigning operator to caller
            require(
                operatorToRelayer[operator] == address(0),
                "Operator already assigned to another relayer"
            );
            operatorToRelayer[operator] = msg.sender;
            emit OperatorUpdated(operator, msg.sender, true);
        } else {
            // Unassigning operator
            require(
                operatorToRelayer[operator] == msg.sender,
                "Only the assigning relayer can unassign this operator"
            );
            operatorToRelayer[operator] = address(0);
            emit OperatorUpdated(operator, address(0), false);
        }
    }

    /**
     * @notice Update Pvium protocol fee (only callable by super admin)
     * @param newFeeBps New fee in basis points
     */
    function setPviumFee(
        uint256 newFeeBps
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(newFeeBps <= 1000, "Fee exceeds 10%");

        uint256 oldFee = pviumFeeBps;
        pviumFeeBps = newFeeBps;

        emit PviumFeeUpdated(oldFee, newFeeBps);
    }
    /**
     * @notice Update Withdrawal relayer fee (only callable by super admin)
     * @param newFeeBps New fee in basis points
     */
    function setWithdrwalRelayerFee(
        uint256 newFeeBps
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(newFeeBps <= 1000, "Fee exceeds 10%");

        uint256 oldFee = withdrawalProccessorFeeBps;
        withdrawalProccessorFeeBps = newFeeBps;

        emit WithdrawalRelayerFeeUpdated(oldFee, newFeeBps);
    }

    /**
     * @notice Update Relay fee address (only callable by super admin)
     * @param newAddress New Pvium fee address
     */
    function setRelayFeeAddress(
        address relayer,
        address newAddress
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(
            hasRole(PVIUM_RELAY_ROLE, relayer),
            "Address must have PVIUM_RELAY_ROLE"
        );
        if (relayer == pviumRelayAddress) {
            pviumRelayAddress = newAddress;
        }
        address oldAddress = relayFeeAddress[relayer];
        relayFeeAddress[relayer] = newAddress;

        emit RelayFeeAddressUpdated(oldAddress, newAddress);
    }

    /**
     * @notice Grant Pvium admin role (only callable by default admin)
     * @param admin Address to grant admin role
     */
    function grantPviumRelayer(
        address admin,
        bool enabled
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (enabled) {
            grantRole(PVIUM_RELAY_ROLE, admin);
            emit RoleGranted(admin, PVIUM_RELAY_ROLE);
        } else {
            revokeRole(PVIUM_RELAY_ROLE, admin);
            emit RoleRevoked(admin, PVIUM_RELAY_ROLE);
        }
    }
    /**
     * @notice Grant Pvium admin role (only callable by default admin)
     * @param admin Address to grant admin role
     */
    function grantDefaultAdminRole(
        address admin,
        bool enabled
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (enabled) {
            grantRole(DEFAULT_ADMIN_ROLE, admin);
            emit RoleGranted(admin, DEFAULT_ADMIN_ROLE);
        } else {
            revokeRole(DEFAULT_ADMIN_ROLE, admin);
            emit RoleRevoked(admin, DEFAULT_ADMIN_ROLE);
        }
    }

    /**
     * @notice Update app fee address (only callable by current app address)
     * @param appId App identifier
     * @param newAddress New app fee address
     */
    function setAppFeeAddress(
        string calldata appId,
        address newAddress,
        CallSignature calldata signature
    )
        external
        onlyAppAdmin(
            keccak256(abi.encode(appId)),
            signature,
            abi.encode(address(this), "setAppFeeAddress", appId, newAddress)
        )
    {
        bytes32 appHash = keccak256(abi.encode(appId));
        require(newAddress != address(0), "Invalid address");

        address oldAddress = appFeeAddress[appHash];
        appFeeAddress[appHash] = newAddress;

        emit AppFeeAddressUpdated(appId, oldAddress, newAddress);
    }

    /**
     * @notice Batch finalize approved receiver payouts with Pvium signature verification
     * @param receiverPayments Array of payout claims
     * @param relayerSignature Relayer signature validating the claims
     */
    function finalizeClaim(
        SmartEscrow.ReceiverPayoutPayload[] calldata receiverPayments,
        bytes calldata relayerSignature
    ) external {
        require(receiverPayments.length > 0, "No payments");

        // Verify Pvium signature - hash app, projectId, and claimIds for gas efficiency
        bytes memory dataPacked;
        for (uint256 i = 0; i < receiverPayments.length; i++) {
            dataPacked = abi.encode(
                dataPacked,
                receiverPayments[i].app,
                receiverPayments[i].projectId,
                receiverPayments[i].claimId
            );
        }
        bytes32 messageHash = keccak256(abi.encode(dataPacked, block.chainid));
        bytes32 ethSignedMessageHash = messageHash.toEthSignedMessageHash();
        address signer = ethSignedMessageHash.recover(relayerSignature);

        // Check if signer is a relayer or an operator for a relayer
        require(isRelayer(signer), "Invalid relayer signature");

        // Get the actual relayer (if signer is an operator, use their relayer)
        address actualRelayer = operatorToRelayer[signer] != address(0)
            ? operatorToRelayer[signer]
            : signer;

        for (uint256 i = 0; i < receiverPayments.length; i++) {}

        // Track fees per token using dynamic arrays
        address[] memory tokens = new address[](receiverPayments.length);
        uint256[] memory appFees = new uint256[](receiverPayments.length);
        uint256 uniqueTokenCount = 0;

        // Group payments by project and process
        for (uint256 i = 0; i < receiverPayments.length; i++) {
            address accountAddress = getAccountByUniqueId(
                receiverPayments[i].app,
                receiverPayments[i].projectId
            );
            require(accountAddress != address(0), "Account not found");

            // Create single-payment array for this account
            SmartEscrow.ReceiverPayoutPayload[]
                memory singlePayment = new SmartEscrow.ReceiverPayoutPayload[](
                    1
                );
            singlePayment[0] = receiverPayments[i];

            // Call finalizeClaim on the account contract (transfers to receiver and app)
            // Returns total relay fees for this payment
            address tokenAddress = address(SmartEscrow(accountAddress).token());

            bool tokenFound = false;
            (uint256 appFee, uint256 relayFee) = SmartEscrow(accountAddress)
                .finalizeClaim(singlePayment);
            uint processorFee = 0;
            if (actualRelayer != accountRelayer[accountAddress]) {
                processorFee = (relayFee * withdrawalProccessorFeeBps) / 10000;
            }
            require(
                IERC20(tokenAddress).transfer(
                    relayFeeAddress[accountRelayer[accountAddress]],
                    relayFee - processorFee
                ),
                "failed to transer relayer fee"
            );
            if (processorFee > 0) {
                require(
                    IERC20(tokenAddress).transfer(
                        relayFeeAddress[actualRelayer],
                        processorFee
                    ),
                    "failed to transer processor fee"
                );
            }
            for (uint256 j = 0; j < uniqueTokenCount; j++) {
                if (tokens[j] == tokenAddress) {
                    appFees[j] += appFee;
                    tokenFound = true;
                    break;
                }
                if (!tokenFound) {
                    tokens[uniqueTokenCount] = tokenAddress;

                    appFees[uniqueTokenCount] = appFee;
                    uniqueTokenCount++;
                }
            }
        }

        // Transfer accumulated fees per token
        for (uint256 i = 0; i < uniqueTokenCount; i++) {
            if (appFees[i] > 0) {
                // App fees are already in factory from SmartEscrow transfer
                // Get app address from first payment (all should be same app per token logic)
                string memory app = receiverPayments[0].app;
                bytes32 appHash = keccak256(abi.encode(app));
                address appFeeAddr = appFeeAddress[appHash];
                require(appFeeAddr != address(0), "App fee not set");
                require(
                    IERC20(tokens[i]).transfer(appFeeAddr, appFees[i]),
                    "failed to transer app fee"
                );
            }
        }
    }
}
