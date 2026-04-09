// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./MultiSigWallet.sol";

/**
 * @title MultiSigFactory
 * @notice Deploys new MultiSigWallet instances and keeps a registry of all
 *         wallets created by each deployer.
 */
contract MultiSigFactory {
    // ─────────────────────────────── Events ────────────────────────────────

    event WalletCreated(
        address indexed wallet,
        address indexed creator,
        address[] owners,
        uint256 requiredConfirmations,
        uint256 requiredOwnerChange,
        uint256 requiredRequirementChange
    );

    // ─────────────────────────────── Storage ───────────────────────────────

    /// @notice All wallets ever deployed by this factory.
    address[] public allWallets;

    /// @notice Wallets deployed by a specific address.
    mapping(address => address[]) private _walletsByCreator;

    /// @notice Quick existence check for any wallet address.
    mapping(address => bool) public isWallet;

    // ─────────────────────────────── Deploy ────────────────────────────────

    /**
     * @notice Deploy a new MultiSigWallet.
     * @param owners                      Array of owner addresses. Must be unique and non-zero.
     * @param requiredConfirmations       Signatures required to execute a transaction.
     * @param requiredOwnerChange         Signatures required to add or remove an owner.
     * @param requiredRequirementChange   Signatures required to change any required threshold.
     * @return wallet  Address of the newly deployed MultiSigWallet.
     */
    function createWallet(
        address[] calldata owners,
        uint256 requiredConfirmations,
        uint256 requiredOwnerChange,
        uint256 requiredRequirementChange
    ) external returns (address wallet) {
        require(owners.length > 0, "MultiSigFactory: no owners");
        require(
            requiredConfirmations > 0 && requiredConfirmations < owners.length,
            "MultiSigFactory: invalid required confirmations"
        );
        require(
            requiredOwnerChange > 0 && requiredOwnerChange < owners.length,
            "MultiSigFactory: invalid required owner change count"
        );
        require(
            requiredRequirementChange > 0 && requiredRequirementChange < owners.length,
            "MultiSigFactory: invalid required count for requirement change"
        );

        MultiSigWallet newWallet = new MultiSigWallet(owners, requiredConfirmations, requiredOwnerChange, requiredRequirementChange);
        wallet = address(newWallet);

        allWallets.push(wallet);
        _walletsByCreator[msg.sender].push(wallet);
        isWallet[wallet] = true;

        emit WalletCreated(wallet, msg.sender, owners, requiredConfirmations, requiredOwnerChange, requiredRequirementChange);

        return wallet;
    }

    // ─────────────────────────────── Views ─────────────────────────────────

    /// @notice Returns all wallets ever deployed by this factory.
    function getAllWallets() external view returns (address[] memory) {
        return allWallets;
    }

    /// @notice Returns all wallets deployed by a specific creator address.
    function getWalletsByCreator(
        address creator
    ) external view returns (address[] memory) {
        return _walletsByCreator[creator];
    }

    /// @notice Total number of wallets deployed by this factory.
    function totalWallets() external view returns (uint256) {
        return allWallets.length;
    }
}
