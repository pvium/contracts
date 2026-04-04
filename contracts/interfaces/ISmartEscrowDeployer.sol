// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.24;

import "../SmartEscrow.sol";

/**
 * @title ISmartEscrowDeployer
 * @notice Interface for SmartEscrowDeployer contract
 */
interface ISmartEscrowDeployer {
    /**
     * @notice Deploy a SmartEscrow contract using CREATE2
     * @param payload SmartEscrow configuration data
     * @param pviumFeeBps Pvium protocol fee in basis points
     * @param salt Unique salt for CREATE2 deployment
     * @return accountAddress Address of the deployed SmartEscrow
     */
    function deploySmartEscrow(
        SmartEscrow.CreateSmartEscrowPayload calldata payload,
        uint256 pviumFeeBps,
        bytes32 salt
    ) external returns (address accountAddress);

    /**
     * @notice Compute the deterministic address for a SmartEscrow deployment
     * @param factoryAddress Address of the factory contract
     * @param payload SmartEscrow configuration data
     * @param pviumFeeBps Pvium protocol fee in basis points
     * @param salt Unique salt for CREATE2 deployment
     * @return Predicted address of the SmartEscrow
     */
    function computeAddress(
        address factoryAddress,
        SmartEscrow.CreateSmartEscrowPayload calldata payload,
        uint256 pviumFeeBps,
        bytes32 salt
    ) external view returns (address);
}
