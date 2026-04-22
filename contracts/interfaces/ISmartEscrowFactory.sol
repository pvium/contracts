// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.24;
import "./SmartEscrowHelper.sol";
/**
 * @title ISmartEscrowFactory
 * @notice Interface for SmartEscrow to interact with Factory
 */
interface ISmartEscrowFactory {
    /**
     * @notice Get the Pvium fee address
     */
    function pviumFeeAddress() external view returns (address);

    /**
     * @notice Get the PVIUM_RELAY_ROLE constant
     */
    function PVIUM_RELAY_ROLE() external pure returns (bytes32);

    /**
     * @notice Get app fee address for a specific app
     */
    function appFeeAddress(string calldata appId)
        external
        view
        returns (address);

         /**
     * @notice Get app fee address for a specific app
     */
    function hasRole(bytes32, address)
        external
        view
        returns (bool);

         function isRelayer( address)
        external
        view
        returns (bool);

     function appAdmins(bytes32, address)
        external
        view
        returns (bool);

         function historicAdmins(bytes32, address)
        external
        view
        returns (bool);

     function  validateAppAdmin(bytes32 appIdBytes, address caller, CallSignature calldata callSig, bytes memory payloadData)  external;



}
