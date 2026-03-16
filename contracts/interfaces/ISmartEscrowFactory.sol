// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

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

        
}
