// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./interfaces/IAerodromeRouter.sol";
import "./interfaces/IWETH.sol";

/**
 * @title AerodromeRouter
 * @dev A simplified routing contract specifically for Aerodrome DEX
 * Deploy on chains where Aerodrome is available (e.g., Base)
 * Uses AccessControl for role-based permissions
 */
contract AerodromeRouter is AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // Roles
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");

    // Aerodrome Router address
    address public immutable router;

    // WETH address for handling native ETH
    address public immutable WETH;

    // Fee receiver address
    address public feeReceiver;

    // MEV Protection settings
    struct MEVConfig {
        bool enabled;                    // Enable/disable MEV protection
        uint256 maxSlippageBps;          // Maximum slippage in basis points (e.g., 100 = 1%)
        uint256 minBlockDelay;           // Minimum blocks between commit and execute (0 = disabled)
        uint256 commitmentDuration;      // How long a commitment is valid (in seconds)
    }

    MEVConfig public mevConfig;

    // Swap commitments for two-phase commit pattern
    struct SwapCommitment {
        bytes32 paramsHash;
        uint256 commitBlock;
        uint256 expiry;
        bool executed;
    }

    mapping(address => mapping(uint256 => SwapCommitment)) public commitments;
    mapping(address => uint256) public nonces;

    // Swap tracking
    struct SwapData {
        address recipient;
        uint256 paymentAmount;
        uint256 timestamp;
        string memo;
    }

    // Input struct for swap functions to avoid stack too deep
    struct SwapParams {
        uint256 amountIn;
        uint256 amountOutMin;
        IAerodromeRouter.Route[] routes;
        address to;
        uint256 paymentAmount;
        uint256 deadline;
        string memo;
        uint256 commitNonce;      // Commitment nonce for MEV protection (0 if not using)
    }

    // Input struct for ETH swaps (no amountIn as msg.value is used)
    struct SwapETHParams {
        uint256 amountOutMin;
        IAerodromeRouter.Route[] routes;
        address to;
        uint256 paymentAmount;
        uint256 deadline;
        string memo;
        uint256 commitNonce;      // Commitment nonce for MEV protection (0 if not using)
    }

    mapping(uint256 => SwapData) public swaps;
    mapping(address => uint) public swapCounts;
    mapping(address => uint) public swapTotalsToken;
    mapping(address => uint) public swapTotalsReceipient;
    uint256 public lastSwapId;

    // Events
    event SwapExecuted(
        address indexed sender,
        address indexed recipient,
        address tokenIn,
        address indexed tokenOut,
        uint256 amountIn,
        uint256 amountOut,
        uint256 paymentAmount,
        string memo
    );
    event SwapFee(
        address indexed sender,
        uint256 indexed swapId,
        uint256 fee
    );
    event FeeReceiverUpdated(address indexed oldReceiver, address indexed newReceiver);
    event MEVConfigUpdated(bool enabled, uint256 maxSlippageBps, uint256 minBlockDelay, uint256 commitmentDuration);
    event SwapCommitted(address indexed user, uint256 indexed nonce, bytes32 paramsHash, uint256 expiry);
    event MEVProtectionTriggered(address indexed user, string reason);

    /**
     * @dev Constructor
     * @param _router Address of the Aerodrome router
     * @param _weth Address of WETH token
     * @param _feeReceiver Address to receive fees
     * @param _defaultAdmin Address to receive DEFAULT_ADMIN_ROLE
     * @param _admin Address to receive ADMIN_ROLE
     */
    constructor(
        address _router,
        address _weth,
        address _feeReceiver,
        address _defaultAdmin,
        address _admin
    ) {
        require(_router != address(0), "Invalid router address");
        require(_weth != address(0), "Invalid WETH address");
        require(_feeReceiver != address(0), "Invalid fee receiver address");
        require(_defaultAdmin != address(0), "Invalid default admin address");
        require(_admin != address(0), "Invalid admin address");

        router = _router;
        WETH = _weth;
        feeReceiver = _feeReceiver;

        // Grant roles
        _grantRole(DEFAULT_ADMIN_ROLE, _defaultAdmin);
        _grantRole(ADMIN_ROLE, _admin);

        // Initialize MEV protection with reasonable defaults
        mevConfig = MEVConfig({
            enabled: true,
            maxSlippageBps: 300,        // 3% max slippage
            minBlockDelay: 0,            // Disabled by default (set to 1-2 for stronger protection)
            commitmentDuration: 300      // 5 minutes
        });
    }

    /**
     * @dev Update fee receiver address (only admin)
     * @param newFeeReceiver New fee receiver address
     */
    function setFeeReceiver(address newFeeReceiver) external onlyRole(ADMIN_ROLE) {
        require(newFeeReceiver != address(0), "Invalid fee receiver address");
        address oldReceiver = feeReceiver;
        feeReceiver = newFeeReceiver;
        emit FeeReceiverUpdated(oldReceiver, newFeeReceiver);
    }

    /**
     * @dev Update MEV protection configuration (only admin)
     * @param enabled Enable/disable MEV protection
     * @param maxSlippageBps Maximum slippage in basis points (10000 = 100%)
     * @param minBlockDelay Minimum blocks between commit and execute
     * @param commitmentDuration How long commitments remain valid (seconds)
     */
    function setMEVConfig(
        bool enabled,
        uint256 maxSlippageBps,
        uint256 minBlockDelay,
        uint256 commitmentDuration
    ) external onlyRole(ADMIN_ROLE) {
        require(maxSlippageBps <= 10000, "Slippage cannot exceed 100%");
        require(commitmentDuration >= 60, "Commitment duration must be at least 60 seconds");
        require(commitmentDuration <= 3600, "Commitment duration cannot exceed 1 hour");

        mevConfig = MEVConfig({
            enabled: enabled,
            maxSlippageBps: maxSlippageBps,
            minBlockDelay: minBlockDelay,
            commitmentDuration: commitmentDuration
        });

        emit MEVConfigUpdated(enabled, maxSlippageBps, minBlockDelay, commitmentDuration);
    }

    /**
     * @dev Commit to swap parameters in advance (optional, for enhanced MEV protection)
     * @param paramsHash Hash of the swap parameters
     * @return nonce The nonce for this commitment
     */
    function commitSwap(bytes32 paramsHash) external returns (uint256) {
        require(mevConfig.enabled && mevConfig.minBlockDelay > 0, "Commitment not required");

        uint256 nonce = nonces[msg.sender]++;
        uint256 expiry = block.timestamp + mevConfig.commitmentDuration;

        commitments[msg.sender][nonce] = SwapCommitment({
            paramsHash: paramsHash,
            commitBlock: block.number,
            expiry: expiry,
            executed: false
        });

        emit SwapCommitted(msg.sender, nonce, paramsHash, expiry);
        return nonce;
    }

    /**
     * @dev MEV protection modifier - validates slippage and commitment if required
     * @param amountIn Input amount
     * @param amountOutMin Minimum output amount
     * @param commitNonce Commitment nonce (0 if not using commitment)
     * @param paramsHash Hash of swap parameters (only if using commitment)
     */
    modifier mevProtection(
        uint256 amountIn,
        uint256 amountOutMin,
        uint256 commitNonce,
        bytes32 paramsHash
    ) {
        if (mevConfig.enabled) {
            // Check maximum slippage
            uint256 maxSlippage = (amountIn * mevConfig.maxSlippageBps) / 10000;
            uint256 minAcceptable = amountIn > maxSlippage ? amountIn - maxSlippage : 0;

            if (amountOutMin < minAcceptable) {
                emit MEVProtectionTriggered(msg.sender, "Slippage exceeds maximum");
                revert("Slippage exceeds maximum allowed");
            }

            // Check commitment if required
            if (mevConfig.minBlockDelay > 0) {
                SwapCommitment storage commitment = commitments[msg.sender][commitNonce];

                require(commitment.paramsHash == paramsHash, "Invalid commitment");
                require(!commitment.executed, "Commitment already executed");
                require(block.timestamp <= commitment.expiry, "Commitment expired");
                require(
                    block.number >= commitment.commitBlock + mevConfig.minBlockDelay,
                    "Minimum block delay not met"
                );

                commitment.executed = true;
            }
        }
        _;
    }

    /**
     * @dev Helper to compute params hash for commitment
     */
    function _computeParamsHash(SwapParams calldata params) internal pure returns (bytes32) {
        return keccak256(abi.encode(
            params.amountIn,
            params.amountOutMin,
            params.routes,
            params.to,
            params.paymentAmount,
            params.deadline,
            params.memo
        ));
    }

    /**
     * @dev Helper to compute params hash for ETH swaps
     */
    function _computeETHParamsHash(SwapETHParams calldata params) internal pure returns (bytes32) {
        return keccak256(abi.encode(
            params.amountOutMin,
            params.routes,
            params.to,
            params.paymentAmount,
            params.deadline,
            params.memo
        ));
    }

    /**
     * @dev Swap exact tokens for tokens on Aerodrome
     * @param params SwapParams struct containing all swap parameters
     */
    function swapExactTokensForTokens(
        SwapParams calldata params
    ) external nonReentrant mevProtection(params.amountIn, params.amountOutMin, params.commitNonce, _computeParamsHash(params)) returns (uint256[] memory amounts) {
        require(params.paymentAmount <= params.amountOutMin, "Payment amount exceeds minimum output");
        require(params.amountIn > 0, "Amount must be greater than zero");

        address tokenIn = params.routes[0].from;
        address tokenOut = params.routes[params.routes.length - 1].to;

        // Transfer tokens from sender to this contract
        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), params.amountIn);

        // Approve router to spend tokens
        IERC20(tokenIn).safeIncreaseAllowance(router, params.amountIn);

        // Execute swap - recipient is this contract
        amounts = IAerodromeRouter(router).swapExactTokensForTokens(
            params.amountIn,
            params.amountOutMin,
            params.routes,
            address(this),
            params.deadline
        );


       
{
        // Calculate fee
        uint256 feeAmount = _calculateFee(params.amountOutMin, params.paymentAmount);

        // Store swap data (effects before interactions)
        uint256 swapId = _storeSwap(params.to, tokenOut, params.paymentAmount, params.memo);
        emit SwapFee(msg.sender, swapId, feeAmount);
}

        // Distribute tokens (interactions)
        _distributeTokens(tokenOut, amounts[amounts.length - 1], params.to, params.paymentAmount, amounts[amounts.length - 1]);

        emit SwapExecuted(msg.sender, params.to, tokenIn, tokenOut, params.amountIn, amounts[amounts.length - 1], params.paymentAmount, params.memo);
    }

    /**
     * @dev Swap exact ETH for tokens on Aerodrome
     * @param params SwapETHParams struct containing swap parameters
     */
    function swapExactETHForTokens(
        SwapETHParams calldata params
    ) external payable nonReentrant mevProtection(msg.value, params.amountOutMin, params.commitNonce, _computeETHParamsHash(params)) returns (uint256[] memory amounts) {
        require(params.routes[0].from == WETH, "Routes must start with WETH");
        require(params.paymentAmount <= params.amountOutMin, "Payment amount exceeds minimum output");
        require(msg.value > 0, "ETH amount must be greater than zero");

        address tokenOut = params.routes[params.routes.length - 1].to;

        // Execute swap - recipient is this contract
        amounts = IAerodromeRouter(router).swapExactETHForTokens{value: msg.value}(
            params.amountOutMin,
            params.routes,
            address(this),
            params.deadline
        );

       //  uint256 amountOut = amounts[amounts.length - 1];

        // Calculate fee
        uint256 feeAmount = _calculateFee(params.amountOutMin, params.paymentAmount);

        // Store swap data (effects before interactions)
        {
        uint256 swapId = _storeSwap(params.to, tokenOut, params.paymentAmount, params.memo);
        emit SwapFee(msg.sender, swapId, feeAmount);
        }

        // Distribute tokens (interactions)
        _distributeTokens(tokenOut, amounts[amounts.length - 1], params.to, params.paymentAmount, feeAmount);

        emit SwapExecuted(msg.sender, params.to, WETH, tokenOut, msg.value, amounts[amounts.length - 1], params.paymentAmount, params.memo);
    }

    /**
     * @dev Swap exact tokens for ETH on Aerodrome
     * @param params SwapParams struct containing all swap parameters
     */
    function swapExactTokensForETH(
        SwapParams calldata params
    ) external nonReentrant mevProtection(params.amountIn, params.amountOutMin, params.commitNonce, _computeParamsHash(params)) returns (uint256[] memory amounts) {
        require(params.routes[params.routes.length - 1].to == WETH, "Routes must end with WETH");
        require(params.paymentAmount <= params.amountOutMin, "Payment amount exceeds minimum output");
        require(params.amountIn > 0, "Amount must be greater than zero");

        address tokenIn = params.routes[0].from;

        // Transfer tokens from sender to this contract
        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), params.amountIn);

        // Approve router to spend tokens
        IERC20(tokenIn).safeIncreaseAllowance(router, params.amountIn);

        // Execute swap - recipient is this contract
        amounts = IAerodromeRouter(router).swapExactTokensForETH(
            params.amountIn,
            params.amountOutMin,
            params.routes,
            address(this),
            params.deadline
        );


        {
        // Calculate fee
        uint256 feeAmount = _calculateFee(params.amountOutMin, params.paymentAmount);

        // Store swap data (effects before interactions)
        uint256 swapId = _storeSwap(params.to, WETH, params.paymentAmount, params.memo);
        emit SwapFee(msg.sender, swapId, feeAmount);

        // Distribute ETH (interactions)
        _distributeETH(amounts[amounts.length - 1], params.to, params.paymentAmount, feeAmount);
        }
        emit SwapExecuted(msg.sender, params.to, tokenIn, WETH, params.amountIn, amounts[amounts.length - 1], params.paymentAmount, params.memo);
    }

    /**
     * @dev Swap tokens for exact tokens on Aerodrome
     * @param params SwapParams struct containing all swap parameters
     */
    function swapTokensForExactTokens(
        SwapParams calldata params
    ) external nonReentrant mevProtection(params.amountIn, params.amountOutMin, params.commitNonce, _computeParamsHash(params)) returns (uint256[] memory amounts) {
        require(params.paymentAmount <= params.amountOutMin, "Payment amount exceeds minimum output");
        require(params.amountIn > 0, "Amount must be greater than zero");

        address tokenIn = params.routes[0].from;
        address tokenOut = params.routes[params.routes.length - 1].to;

        // Transfer max tokens from sender to this contract
        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), params.amountIn);

        // Approve router to spend tokens
        IERC20(tokenIn).safeIncreaseAllowance(router, params.amountIn);

        // Execute swap - recipient is this contract
        // amountOut (params.amountOutMin) is the exact amount of tokens we want
        amounts = IAerodromeRouter(router).swapTokensForExactTokens(
            params.amountOutMin,
            params.amountIn,
            params.routes,
            address(this),
            params.deadline
        );

    {
        // Calculate fee
        uint256 feeAmount = _calculateFee(params.amountOutMin, params.paymentAmount);

        // Store swap data (effects before interactions)
        uint256 swapId = _storeSwap(params.to, tokenOut, params.paymentAmount, params.memo);
        emit SwapFee(msg.sender, swapId, feeAmount);

        // Distribute output tokens (interactions)
        _distributeTokens(tokenOut, amounts[amounts.length - 1], params.to, params.paymentAmount, feeAmount);

        // Refund any unused input tokens back to sender
        if (params.amountIn > amounts[0]) {
            IERC20(tokenIn).safeTransfer(msg.sender, params.amountIn - amounts[0]);
        }
    }

        emit SwapExecuted(msg.sender, params.to, tokenIn, tokenOut, amounts[0], amounts[amounts.length - 1], params.paymentAmount, params.memo);
    }

    /**
     * @dev Swap ETH for exact tokens on Aerodrome
     * @param params SwapETHParams struct containing swap parameters
     */
    function swapETHForExactTokens(
        SwapETHParams calldata params
    ) external payable nonReentrant mevProtection(msg.value, params.amountOutMin, params.commitNonce, _computeETHParamsHash(params)) returns (uint256[] memory amounts) {
        require(params.routes[0].from == WETH, "Routes must start with WETH");
        require(params.paymentAmount <= params.amountOutMin, "Payment amount exceeds minimum output");
        require(msg.value > 0, "ETH amount must be greater than zero");

        address tokenOut = params.routes[params.routes.length - 1].to;
        uint256 ethBalanceBefore = address(this).balance - msg.value;

        // Execute swap - recipient is this contract
        // amountOut is the exact amount of tokens we want
        amounts = IAerodromeRouter(router).swapETHForExactTokens{value: msg.value}(
            params.amountOutMin,
            params.routes,
            address(this),
            params.deadline
        );

        // Calculate fee
        {
        uint256 feeAmount = _calculateFee(params.amountOutMin, params.paymentAmount);

        // Store swap data (effects before interactions)
        
            uint256 swapId = _storeSwap(params.to, tokenOut, params.paymentAmount, params.memo);
            emit SwapFee(msg.sender, swapId, feeAmount);
        

        // Distribute tokens (interactions)
        _distributeTokens(tokenOut, amounts[amounts.length - 1], params.to, params.paymentAmount, feeAmount);
        // Refund any unused ETH back to sender
        
            uint256 ethBalanceAfter = address(this).balance;
            if (ethBalanceAfter > ethBalanceBefore) {
                (bool success, ) = payable(msg.sender).call{value: ethBalanceAfter - ethBalanceBefore}("");
                require(success, "ETH refund failed");
            }
        }

        emit SwapExecuted(msg.sender, params.to, WETH, tokenOut, amounts[0], amounts[amounts.length - 1], params.paymentAmount, params.memo);
    }

    /**
     * @dev Get swaps by ID range
     * @param fromId Starting swap ID (inclusive)
     * @param toId Ending swap ID (inclusive)
     * @return Array of SwapData structs
     */
    function getSwapsByRange(uint256 fromId, uint256 toId) external view returns (SwapData[] memory) {
        require(fromId <= toId, "Invalid range");
        require(toId <= lastSwapId, "Range exceeds last swap ID");

        uint256 length = toId - fromId + 1;
        require(length <= 100, "Range too large");

        SwapData[] memory result = new SwapData[](length);

        for (uint256 i = 0; i < length; i++) {
            result[i] = swaps[fromId + i];
        }

        return result;
    }

    /**
     * @dev Quote how much input is needed for a desired output on Aerodrome
     * @param amountOut Desired output amount (paymentAmount + feeAmount)
     * @param routes Array of routes representing the swap path
     * @return amounts Array of amounts needed, amounts[0] is input needed
     */
    function quoteForExactOutput(
        uint256 amountOut,
        IAerodromeRouter.Route[] calldata routes
    ) external view returns (uint256[] memory amounts) {
        return IAerodromeRouter(router).getAmountsIn(amountOut, routes);
    }

    /**
     * @dev Quote how much output you get for a given input on Aerodrome
     * @param amountIn Input amount
     * @param routes Array of routes representing the swap path
     * @return amounts Array of amounts, amounts[amounts.length - 1] is output
     */
    function quoteForExactInput(
        uint256 amountIn,
        IAerodromeRouter.Route[] calldata routes
    ) external view returns (uint256[] memory amounts) {
        return IAerodromeRouter(router).getAmountsOut(amountIn, routes);
    }

    /**
     * @dev Calculate fee amount from swap parameters
     * @param amountOutMin Minimum expected amount (paymentAmount + feeAmount)
     * @param paymentAmount Amount to send to recipient
     * @return feeAmount The calculated fee amount
     */
    function _calculateFee(
        uint256 amountOutMin,
        uint256 paymentAmount
    ) internal pure returns (uint256 feeAmount) {
        if (amountOutMin > paymentAmount) {
            feeAmount = amountOutMin - paymentAmount;
        }
    }

    /**
     * @dev Internal function to distribute tokens
     * @param token Token address to distribute
     * @param amountOut Total amount received from swap
     * @param recipient Address to receive payment
     * @param paymentAmount Amount to send to recipient
     * @param feeAmount Amount to send to fee receiver
     * @return excessAmount Amount returned to sender
     */
    function _distributeTokens(
        address token,
        uint256 amountOut,
        address recipient,
        uint256 paymentAmount,
        uint256 feeAmount
    ) internal returns (uint256 excessAmount) {
        // 1. Payment to recipient
        IERC20(token).safeTransfer(recipient, paymentAmount);

        // 2. Fee to fee receiver
        if (feeAmount > 0) {
            IERC20(token).safeTransfer(feeReceiver, feeAmount);
        }

        // 3. Excess back to sender
        uint256 distributedAmount = paymentAmount + feeAmount;
        if (amountOut > distributedAmount) {
            excessAmount = amountOut - distributedAmount;
            IERC20(token).safeTransfer(msg.sender, excessAmount);
        }
    }

    /**
     * @dev Internal function to distribute ETH
     * @param amountOut Total amount received from swap
     * @param recipient Address to receive payment
     * @param paymentAmount Amount to send to recipient
     * @param feeAmount Amount to send to fee receiver
     * @return excessAmount Amount returned to sender
     */
    function _distributeETH(
        uint256 amountOut,
        address recipient,
        uint256 paymentAmount,
        uint256 feeAmount
    ) internal returns (uint256 excessAmount) {
        // 1. Payment to recipient
        (bool success, ) = payable(recipient).call{value: paymentAmount}("");
        require(success, "ETH transfer to recipient failed");

        // 2. Fee to fee receiver
        if (feeAmount > 0) {
            (success, ) = payable(feeReceiver).call{value: feeAmount}("");
            require(success, "ETH transfer to fee receiver failed");
        }

        // 3. Excess back to sender
        uint256 distributedAmount = paymentAmount + feeAmount;
        if (amountOut > distributedAmount) {
            excessAmount = amountOut - distributedAmount;
            (success, ) = payable(msg.sender).call{value: excessAmount}("");
            require(success, "ETH transfer to sender failed");
        }
    }

    /**
     * @dev Internal function to store swap data
     * @param recipient Payment recipient address
     * @param token Token address
     * @param paymentAmount Amount sent to recipient
     * @param memo Memo or reference for the payment
     */
    function _storeSwap(
        address recipient,
        address token,
        uint256 paymentAmount,
        string calldata memo
    ) private returns(uint256) {
        lastSwapId++;
        swaps[lastSwapId] = SwapData({
            recipient: recipient,
            paymentAmount: paymentAmount,
            timestamp: block.timestamp,
            memo: memo
        });
        swapCounts[recipient]++;
        swapTotalsReceipient[recipient] += paymentAmount;
        swapTotalsToken[token] += paymentAmount;
        return lastSwapId;
    }

    /**
     * @dev Emergency token withdrawal (only default admin)
     * @param token Token address (use address(0) for ETH)
     * @param to Address to send withdrawn tokens
     * @param amount Amount to withdraw
     */
    function emergencyWithdraw(
        address token,
        address to,
        uint256 amount
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(to != address(0), "Invalid recipient address");
        if (token == address(0)) {
            payable(to).transfer(amount);
        } else {
            IERC20(token).safeTransfer(to, amount);
        }
    }

    /**
     * @dev Receive function to accept ETH
     */
    receive() external payable {}
}
