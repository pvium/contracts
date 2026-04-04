// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/**
 * @title BatchTransfer
 * @notice Secure contract for batch transferring ERC20 tokens atomically from msg.sender
 * @dev Transfers tokens from the caller's balance (msg.sender) to multiple recipients.
 *      Caller must approve this contract before calling batchTransfer.
 *      Since transfers are from msg.sender, only the caller can move their own tokens.
 */
contract BatchTransfer {
    event BatchTransferExecuted(
        address indexed caller,
        address indexed token,
        uint256 recipientCount,
        uint256 totalAmount
    );

    /**
     * @notice Batch transfer tokens from msg.sender to multiple recipients atomically
     * @dev All transfers succeed or all fail. Tokens are transferred from msg.sender's balance.
     *      msg.sender must have approved this contract to spend at least totalAmount.
     * @param token Address of the ERC20 token to transfer
     * @param recipients Array of recipient addresses
     * @param amounts Array of amounts to transfer (must match recipients length)
     */
    function batchTransfer(
        address token,
        address[] calldata recipients,
        uint256[] calldata amounts
    ) external {
        require(recipients.length == amounts.length, "BatchTransfer: arrays length mismatch");
        require(recipients.length > 0, "BatchTransfer: empty arrays");

        IERC20 tokenContract = IERC20(token);
        uint256 totalAmount = 0;

        // Execute all transfers - if any fails, entire transaction reverts
        for (uint256 i = 0; i < recipients.length; i++) {
            require(recipients[i] != address(0), "BatchTransfer: transfer to zero address");
            require(amounts[i] > 0, "BatchTransfer: transfer amount is zero");

            // Transfer from msg.sender to recipient
            bool success = tokenContract.transferFrom(msg.sender, recipients[i], amounts[i]);
            require(success, "BatchTransfer: transfer failed");

            totalAmount += amounts[i];
        }

        emit BatchTransferExecuted(msg.sender, token, recipients.length, totalAmount);
    }
}
