// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title MockUniswapV2Router
 * @dev Mock implementation of Uniswap V2 Router for testing
 */
contract MockUniswapV2Router {
    // Simple swap ratio: 1:1 for testing
    uint256 public constant SWAP_RATIO = 100; // 100% return for simplicity

    /**
     * @dev Mock swap exact tokens for tokens
     */
    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 /* deadline */
    ) external returns (uint256[] memory amounts) {
        require(path.length >= 2, "Invalid path");

        // Transfer tokens from sender
        IERC20(path[0]).transferFrom(msg.sender, address(this), amountIn);

        // Calculate output (simplified 1:1 ratio)
        uint256 amountOut = amountIn;
        require(amountOut >= amountOutMin, "Insufficient output amount");

        // Transfer output tokens to recipient
        IERC20(path[path.length - 1]).transfer(to, amountOut);

        // Return amounts array
        amounts = new uint256[](path.length);
        amounts[0] = amountIn;
        amounts[path.length - 1] = amountOut;

        return amounts;
    }

    /**
     * @dev Mock swap exact ETH for tokens
     */
    function swapExactETHForTokens(
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 /* deadline */
    ) external payable returns (uint256[] memory amounts) {
        require(path.length >= 2, "Invalid path");
        require(msg.value > 0, "No ETH sent");

        // Calculate output (simplified: use msg.value directly)
        uint256 amountOut = msg.value;
        require(amountOut >= amountOutMin, "Insufficient output amount");

        // Transfer output tokens to recipient
        IERC20(path[path.length - 1]).transfer(to, amountOut);

        // Return amounts array
        amounts = new uint256[](path.length);
        amounts[0] = msg.value;
        amounts[path.length - 1] = amountOut;

        return amounts;
    }

    /**
     * @dev Mock swap exact tokens for ETH
     */
    function swapExactTokensForETH(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 /* deadline */
    ) external returns (uint256[] memory amounts) {
        require(path.length >= 2, "Invalid path");

        // Transfer tokens from sender
        IERC20(path[0]).transferFrom(msg.sender, address(this), amountIn);

        // Calculate output (simplified 1:1 ratio)
        uint256 amountOut = amountIn;
        require(amountOut >= amountOutMin, "Insufficient output amount");
        require(address(this).balance >= amountOut, "Insufficient ETH balance");

        // Transfer ETH to recipient
        payable(to).transfer(amountOut);

        // Return amounts array
        amounts = new uint256[](path.length);
        amounts[0] = amountIn;
        amounts[path.length - 1] = amountOut;

        return amounts;
    }

    /**
     * @dev Mock swap tokens for exact tokens
     */
    function swapTokensForExactTokens(
        uint256 amountOut,
        uint256 amountInMax,
        address[] calldata path,
        address to,
        uint256 /* deadline */
    ) external returns (uint256[] memory amounts) {
        require(path.length >= 2, "Invalid path");

        // Calculate input needed (simplified 1:1 ratio)
        uint256 amountIn = amountOut;
        require(amountIn <= amountInMax, "Excessive input amount");

        // Transfer tokens from sender
        IERC20(path[0]).transferFrom(msg.sender, address(this), amountIn);

        // Transfer output tokens to recipient
        IERC20(path[path.length - 1]).transfer(to, amountOut);

        // Return amounts array
        amounts = new uint256[](path.length);
        amounts[0] = amountIn;
        amounts[path.length - 1] = amountOut;

        return amounts;
    }

    /**
     * @dev Mock swap ETH for exact tokens
     */
    function swapETHForExactTokens(
        uint256 amountOut,
        address[] calldata path,
        address to,
        uint256 /* deadline */
    ) external payable returns (uint256[] memory amounts) {
        require(path.length >= 2, "Invalid path");
        require(msg.value > 0, "No ETH sent");

        // Calculate input needed (simplified: use amountOut as ETH needed)
        uint256 amountIn = amountOut;
        require(amountIn <= msg.value, "Excessive input amount");

        // Transfer output tokens to recipient
        IERC20(path[path.length - 1]).transfer(to, amountOut);

        // Refund excess ETH to sender
        if (msg.value > amountIn) {
            payable(msg.sender).transfer(msg.value - amountIn);
        }

        // Return amounts array
        amounts = new uint256[](path.length);
        amounts[0] = amountIn;
        amounts[path.length - 1] = amountOut;

        return amounts;
    }

    /**
     * @dev Mock get amounts in
     */
    function getAmountsIn(
        uint256 amountOut,
        address[] calldata path
    ) external pure returns (uint256[] memory amounts) {
        amounts = new uint256[](path.length);
        amounts[0] = amountOut; // Simplified 1:1
        amounts[path.length - 1] = amountOut;
        return amounts;
    }

    /**
     * @dev Mock get amounts out
     */
    function getAmountsOut(
        uint256 amountIn,
        address[] calldata path
    ) external pure returns (uint256[] memory amounts) {
        amounts = new uint256[](path.length);
        amounts[0] = amountIn;
        amounts[path.length - 1] = amountIn; // Simplified 1:1
        return amounts;
    }

    /**
     * @dev Receive function to accept ETH
     */
    receive() external payable {}
}
