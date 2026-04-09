// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title InvoicePayments
 * @notice Transfers accepted ERC20 invoice payments from payer to payee and records payment metadata
 */
contract InvoicePayments is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    mapping(address => bool) public acceptedTokens;

    event InvoicePaid(
        address indexed tokenAddress,
        uint256 tokenAmount,
        address indexed payerAddress,
        address indexed payeeAddress,
        string memo
    );

    event AcceptedTokenUpdated(address indexed tokenAddress, bool accepted);

    error TokenNotAccepted(address tokenAddress);
    error InvalidAddress();
    error InvalidAmount();
    error EmptyMemo();

    constructor(address initialOwner, address[] memory initialAcceptedTokens) Ownable(initialOwner) {
        if (initialOwner == address(0)) {
            revert InvalidAddress();
        }

        uint256 len = initialAcceptedTokens.length;
        for (uint256 i = 0; i < len; i++) {
            address token = initialAcceptedTokens[i];
            if (token == address(0)) {
                revert InvalidAddress();
            }
            acceptedTokens[token] = true;
            emit AcceptedTokenUpdated(token, true);
        }
    }

    function setAcceptedToken(address tokenAddress, bool accepted) external onlyOwner {
        if (tokenAddress == address(0)) {
            revert InvalidAddress();
        }

        acceptedTokens[tokenAddress] = accepted;
        emit AcceptedTokenUpdated(tokenAddress, accepted);
    }

    /**
     * @notice Pays an invoice by transferring tokens from payer to payee
     * @dev memo may follow this convention: "<contract_code>:<installmentId>"
     */
    function payInvoice(
        address tokenAddress,
        uint256 tokenAmount,
        address payerAddress,
        address payeeAddress,
        string calldata memo
    ) external nonReentrant {
        if (!acceptedTokens[tokenAddress]) {
            revert TokenNotAccepted(tokenAddress);
        }
        if (payerAddress == address(0) || payeeAddress == address(0)) {
            revert InvalidAddress();
        }
        if (tokenAmount == 0) {
            revert InvalidAmount();
        }
        if (bytes(memo).length == 0) {
            revert EmptyMemo();
        }

        IERC20(tokenAddress).safeTransferFrom(payerAddress, payeeAddress, tokenAmount);

        emit InvoicePaid(tokenAddress, tokenAmount, payerAddress, payeeAddress, memo);
    }
}
