// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./SmartEscrow.sol";
import "@openzeppelin/contracts/utils/Create2.sol";

/**
 * @title SmartEscrowDeployer
 * @notice Handles deployment of SmartEscrow contracts using CREATE2
 * @dev Separates deployment logic from factory to reduce factory contract size
 */
contract SmartEscrowDeployer {
    /**
     * @notice Encode constructor parameters
     * @dev Must use single abi.encode for proper ABI structure
     */
    function _encodeConstructorParams(
        address factoryAddress,
        SmartEscrow.CreateSmartEscrowPayload calldata payload,
        uint256 pviumFeeBps
    ) private pure returns (bytes memory) {
        // Constructor expects: factory, appId, projectId, metadata, token, refundAddress,
        // appFeeBps, pviumFeeBps, disputeWindowSeconds, lockExpiry,
        // minimumBalancePerVendor, maxNumVendors, appFeeAddress, appAdminAddress

        return abi.encode(
            factoryAddress,
            payload.app,
            payload.projectId,
            payload.metadata,
            payload.tokenAddress,
            payload.refundAddress,
            payload.appFeeBps,
            pviumFeeBps,
            payload.disputeWindowSeconds,
            payload.lockDurationSeconds,
            payload.minimumBalancePerVendor,
            payload.maxNumVendors,
            payload.appFeeAddress,
            payload.appAdminAddress
        );
    }

    /**
     * @notice Deploy a SmartEscrow contract using CREATE2
     * @param payload SmartEscrow configuration data
     * @param pviumFeeBps Pvium protocol fee in basis points
     * @param salt Unique salt for CREATE2 deployment
     * @return projectAddress Address of the deployed SmartEscrow
     */
    function deploySmartEscrow(
        SmartEscrow.CreateSmartEscrowPayload calldata payload,
        uint256 pviumFeeBps,
        bytes32 salt
    ) external returns (address projectAddress) {
        bytes memory constructorParams = _encodeConstructorParams(msg.sender, payload, pviumFeeBps);
        bytes memory bytecode = abi.encodePacked(type(SmartEscrow).creationCode, constructorParams);
        return Create2.deploy(0, salt, bytecode);
    }

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
    ) external view returns (address) {
        bytes memory constructorParams = _encodeConstructorParams(factoryAddress, payload, pviumFeeBps);
        bytes memory bytecode = abi.encodePacked(type(SmartEscrow).creationCode, constructorParams);
        return Create2.computeAddress(salt, keccak256(bytecode), address(this));
    }
}
