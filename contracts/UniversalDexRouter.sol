// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./interfaces/IUniswapV2Router.sol";
import "./interfaces/IUniswapV3Router.sol";
import "./interfaces/IWETH.sol";

/**
 * @title UniversalDexRouter
 * @dev A simplified routing contract for Uniswap V2/V3 and PancakeSwap
 * Deploy separately on each chain with the appropriate router address
 * Uses AccessControl for role-based permissions
 */
contract UniversalDexRouter is AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // Roles
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");

    // DEX Router address (Uniswap or PancakeSwap)
    address public immutable router;

    // WETH address for handling native ETH
    address public immutable WETH;

    // Fee receiver address
    address public feeReceiver;

    uint256 immutable  public maxFeeBps = 30; // Max fee in basis points (0.3%)

    // Swap tracking
    struct SwapData {
        address recipient;
        uint256 paymentAmount;
        uint256 timestamp;
        string memo;
    }

    // Input structs for V2-style swaps to avoid stack too deep
    struct SwapV2Params {
        uint256 amountIn;
        uint256 amountOutMin;
        address[] path;
        address to;
        uint256 paymentAmount;
        uint256 deadline;
        string memo;
    }

    // Input struct for ETH swaps (no amountIn as msg.value is used)
    struct SwapETHParams {
        uint256 amountOutMin;
        address[] path;
        address to;
        uint256 paymentAmount;
        uint256 deadline;
        string memo;
    }

    // Input struct for V3 single hop swaps
    struct SwapV3SingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        uint256 amountIn;
        uint256 amountOutMinimum;
        address to;
        uint256 paymentAmount;
        uint256 deadline;
        string memo;
    }

    // Input struct for V3 multi-hop swaps
    struct SwapV3MultiParams {
        bytes path;
        uint256 amountIn;
        uint256 amountOutMinimum;
        address to;
        uint256 paymentAmount;
        uint256 deadline;
        string memo;
    }

    // Input struct for V3 exact output single hop swaps
    struct SwapV3ExactOutputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        uint256 amountOut;           // Exact amount of output tokens desired
        uint256 amountInMaximum;     // Maximum amount of input tokens willing to spend
        address to;
        uint256 paymentAmount;
        uint256 deadline;
        string memo;
    }

    // Input struct for V3 exact output multi-hop swaps
    struct SwapV3ExactOutputMultiParams {
        bytes path;                  // Encoded path (reversed for exact output)
        uint256 amountOut;           // Exact amount of output tokens desired
        uint256 amountInMaximum;     // Maximum amount of input tokens willing to spend
        address to;
        uint256 paymentAmount;
        uint256 deadline;
        string memo;
    }

    // Input struct for ETH to exact tokens V3 single hop
    struct SwapETHForExactTokensV3SingleParams {
        address tokenOut;
        uint24 fee;
        uint256 amountOut;           // Exact amount of tokens desired
        address to;
        uint256 paymentAmount;
        uint256 deadline;
        string memo;
    }

    // Input struct for ETH to exact tokens V3 multi-hop
    struct SwapETHForExactTokensV3MultiParams {
        bytes path;                  // Encoded path (reversed, starts with tokenOut)
        uint256 amountOut;           // Exact amount of tokens desired
        address to;
        uint256 paymentAmount;
        uint256 deadline;
        string memo;
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

    /**
     * @dev Constructor
     * @param _router Address of the DEX router (Uniswap V2/V3 or PancakeSwap)
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
     * @dev Swap exact tokens for tokens on Uniswap V2 / PancakeSwap
     * @param params SwapV2Params struct containing all swap parameters
     */
    function swapExactTokensForTokens(
        SwapV2Params calldata params
    ) external nonReentrant returns (uint256[] memory amounts) {
        require(params.paymentAmount <= params.amountOutMin, "Payment amount exceeds minimum output");

        // Transfer tokens from sender to this contract
        IERC20(params.path[0]).safeTransferFrom(msg.sender, address(this), params.amountIn);

        // Approve router to spend tokens
        IERC20(params.path[0]).safeIncreaseAllowance(router, params.amountIn);

        // Execute swap - recipient is this contract
        amounts = IUniswapV2Router(router).swapExactTokensForTokens(
            params.amountIn,
            params.amountOutMin,
            params.path,
            address(this),
            params.deadline
        );

        // Calculate fee
        uint256 feeAmount = _calculateFee(params.amountOutMin, params.paymentAmount);

        // Store swap data (effects before interactions)
        uint256 swapId = _storeSwap(params.to, params.path[params.path.length - 1], params.paymentAmount, params.memo);
        emit SwapFee(msg.sender, swapId, feeAmount);

        // Distribute tokens (interactions)
        _distributeTokens(
            params.path[params.path.length - 1],
            amounts[amounts.length - 1],
            params.to,
            params.paymentAmount,
            feeAmount
        );

        emit SwapExecuted(msg.sender, params.to,  params.path[0], params.path[params.path.length - 1], params.amountIn, amounts[amounts.length - 1],  params.paymentAmount, params.memo);
    }

    /**
     * @dev Swap exact ETH for tokens on Uniswap V2 / PancakeSwap
     * @param params SwapETHParams struct containing swap parameters
     */
    function swapExactETHForTokens(
        SwapETHParams calldata params
    ) external payable nonReentrant returns (uint256[] memory amounts) {
        require(params.path[0] == WETH, "Path must start with WETH");
        require(params.paymentAmount <= params.amountOutMin, "Payment amount exceeds minimum output");

        // Execute swap - recipient is this contract
        amounts = IUniswapV2Router(router).swapExactETHForTokens{value: msg.value}(
            params.amountOutMin,
            params.path,
            address(this),
            params.deadline
        );

        // Calculate fee
        uint256 feeAmount = _calculateFee(params.amountOutMin, params.paymentAmount);

        // Store swap data (effects before interactions)
        uint256 swapId = _storeSwap(params.to, params.path[params.path.length - 1], params.paymentAmount, params.memo);
        emit SwapFee(msg.sender, swapId, feeAmount);

        // Distribute tokens (interactions)
        _distributeTokens(
            params.path[params.path.length - 1],
            amounts[amounts.length - 1],
            params.to,
            params.paymentAmount,
            feeAmount
        );

        emit SwapExecuted(msg.sender, params.to, params.path[0], params.path[params.path.length - 1], msg.value, amounts[amounts.length - 1], params.paymentAmount, params.memo);
    }

    /**
     * @dev Swap tokens for exact tokens on Uniswap V2 / PancakeSwap
     * @param params SwapV2Params struct containing all swap parameters
     */
    function swapTokensForExactTokens(
        SwapV2Params calldata params
    ) external nonReentrant returns (uint256[] memory amounts) {
        require(params.paymentAmount <= params.amountOutMin, "Payment amount exceeds minimum output");

        // Transfer max tokens from sender to this contract
        IERC20(params.path[0]).safeTransferFrom(msg.sender, address(this), params.amountIn);

        // Approve router to spend tokens
        IERC20(params.path[0]).safeIncreaseAllowance(router, params.amountIn);

        // Execute swap - recipient is this contract
        // amountOut (params.amountOutMin) is the exact amount of tokens we want
        amounts = IUniswapV2Router(router).swapTokensForExactTokens(
            params.amountOutMin,
            params.amountIn,
            params.path,
            address(this),
            params.deadline
        );

        // Calculate fee
        uint256 feeAmount = _calculateFee(params.amountOutMin, params.paymentAmount);

        // Store swap data (effects before interactions)
        uint256 swapId = _storeSwap(params.to, params.path[params.path.length - 1], params.paymentAmount, params.memo);
        emit SwapFee(msg.sender, swapId, feeAmount);

        // Distribute output tokens (interactions)
        _distributeTokens(
            params.path[params.path.length - 1],
            amounts[amounts.length - 1],
            params.to,
            params.paymentAmount,
            feeAmount
        );

        // Refund any unused input tokens back to sender
        if (params.amountIn > amounts[0]) {
            IERC20(params.path[0]).safeTransfer(msg.sender, params.amountIn - amounts[0]);
        }

        emit SwapExecuted(msg.sender, params.to, params.path[0], params.path[params.path.length - 1], amounts[0], amounts[amounts.length - 1], params.paymentAmount, params.memo);
    }

    /**
     * @dev Swap ETH for exact tokens on Uniswap V2 / PancakeSwap
     * @param params SwapETHParams struct containing swap parameters
     */
    function swapETHForExactTokens(
        SwapETHParams calldata params
    ) external payable nonReentrant returns (uint256[] memory amounts) {
        require(params.path[0] == WETH, "Path must start with WETH");
        require(params.paymentAmount <= params.amountOutMin, "Payment amount exceeds minimum output");

        uint256 ethBalanceBefore = address(this).balance - msg.value;

        // Execute swap - recipient is this contract
        // amountOut is the exact amount of tokens we want
        amounts = IUniswapV2Router(router).swapETHForExactTokens{value: msg.value}(
            params.amountOutMin,
            params.path,
            address(this),
            params.deadline
        );

        // Calculate fee
        uint256 feeAmount = _calculateFee(params.amountOutMin, params.paymentAmount);

        // Store swap data (effects before interactions)
        uint256 swapId = _storeSwap(params.to, params.path[params.path.length - 1], params.paymentAmount, params.memo);
        

        // Distribute tokens (interactions)
        _distributeTokens(
            params.path[params.path.length - 1],
            amounts[amounts.length - 1],
            params.to,
            params.paymentAmount,
            feeAmount
        );

        // Refund any unused ETH back to sender
        uint256 ethBalanceAfter = address(this).balance;
        if (ethBalanceAfter > ethBalanceBefore) {
            (bool success, ) = payable(msg.sender).call{value: ethBalanceAfter - ethBalanceBefore}("");
            require(success, "ETH refund failed");
        }
        emit SwapFee(msg.sender, swapId, feeAmount);
        emit SwapExecuted(msg.sender, params.to, params.path[0], params.path[params.path.length - 1], amounts[0], amounts[amounts.length - 1], params.paymentAmount, params.memo);
    }

    /**
     * @dev Swap exact tokens for ETH on Uniswap V2 / PancakeSwap
     * @param params SwapV2Params struct containing all swap parameters
     */
    function swapExactTokensForETH(
        SwapV2Params calldata params
    ) external nonReentrant returns (uint256[] memory amounts) {
        require(params.path[params.path.length - 1] == WETH, "Path must end with WETH");
        require(params.paymentAmount <= params.amountOutMin, "Payment amount exceeds minimum output");

        // Transfer tokens from sender to this contract
        IERC20(params.path[0]).safeTransferFrom(msg.sender, address(this), params.amountIn);

        // Approve router to spend tokens
        IERC20(params.path[0]).safeIncreaseAllowance(router, params.amountIn);

        // Execute swap - recipient is this contract
        amounts = IUniswapV2Router(router).swapExactTokensForETH(
            params.amountIn,
            params.amountOutMin,
            params.path,
            address(this),
            params.deadline
        );

        // Calculate fee
        uint256 feeAmount = _calculateFee(params.amountOutMin, params.paymentAmount);

        // Store swap data (effects before interactions)
        uint256 swapId = _storeSwap(params.to, WETH, params.paymentAmount, params.memo);
        emit SwapFee(msg.sender, swapId, feeAmount);

        // Distribute ETH (interactions)
        _distributeETH(
            amounts[amounts.length - 1],
            params.to,
            params.paymentAmount,
            feeAmount
        );

        emit SwapExecuted(msg.sender, params.to, params.path[0], WETH, params.amountIn, amounts[amounts.length - 1],params.paymentAmount, params.memo);
    }

    /**
     * @dev Swap exact tokens for tokens on Uniswap V3 (single hop)
     * @param swapParams SwapV3SingleParams struct containing all swap parameters
     */
    function swapExactTokenForTokenSingleV3(
        SwapV3SingleParams calldata swapParams
    ) external nonReentrant returns (uint256 amountOut) {
        require(swapParams.paymentAmount <= swapParams.amountOutMinimum, "Payment amount exceeds minimum output");

        // Transfer tokens from sender to this contract
        IERC20(swapParams.tokenIn).safeTransferFrom(msg.sender, address(this), swapParams.amountIn);

        // Approve router to spend tokens
        IERC20(swapParams.tokenIn).safeIncreaseAllowance(router, swapParams.amountIn);

        // Prepare swap parameters - recipient is this contract
        IUniswapV3Router.ExactInputSingleParams memory v3Params = IUniswapV3Router.ExactInputSingleParams({
            tokenIn: swapParams.tokenIn,
            tokenOut: swapParams.tokenOut,
            fee: swapParams.fee,
            recipient: address(this),
            deadline: swapParams.deadline,
            amountIn: swapParams.amountIn,
            amountOutMinimum: swapParams.amountOutMinimum,
            sqrtPriceLimitX96: 0
        });

        // Execute swap
        amountOut = IUniswapV3Router(router).exactInputSingle(v3Params);

        // Calculate fee
        uint256 feeAmount = _calculateFee(swapParams.amountOutMinimum, swapParams.paymentAmount);

        // Store swap data (effects before interactions)
        uint256 swapId = _storeSwap(swapParams.to, swapParams.tokenOut, swapParams.paymentAmount, swapParams.memo);
        emit SwapFee(msg.sender, swapId, feeAmount);

        // Distribute tokens (interactions)
        _distributeTokens(
            swapParams.tokenOut,
            amountOut,
            swapParams.to,
            swapParams.paymentAmount,
            feeAmount
        );

        emit SwapExecuted( msg.sender, swapParams.to, swapParams.tokenIn, swapParams.tokenOut, swapParams.amountIn, amountOut, swapParams.paymentAmount, swapParams.memo);
    }

    /**
     * @dev Swap exact tokens for tokens on Uniswap V3 (multi-hop)
     * @param swapParams SwapV3MultiParams struct containing all swap parameters
     */
    function swapExactTokenForTokenV3Multi(
        SwapV3MultiParams calldata swapParams
    ) external nonReentrant returns (uint256 amountOut) {
        require(swapParams.paymentAmount <= swapParams.amountOutMinimum, "Payment amount exceeds minimum output");

        // Extract first and last tokens from path
        address tokenIn;
        address tokenOut;
        {
            bytes calldata path = swapParams.path;
            assembly {
                // First token is at the beginning of the path
                tokenIn := shr(96, calldataload(path.offset))

                // Last token is 20 bytes before end
                tokenOut := shr(96, calldataload(add(path.offset, sub(path.length, 20))))
            }
        }

        // Transfer tokens from sender to this contract
        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), swapParams.amountIn);

        // Approve router to spend tokens
        IERC20(tokenIn).safeIncreaseAllowance(router, swapParams.amountIn);

        // Prepare swap parameters - recipient is this contract
        IUniswapV3Router.ExactInputParams memory v3Params = IUniswapV3Router.ExactInputParams({
            path: swapParams.path,
            recipient: address(this),
            deadline: swapParams.deadline,
            amountIn: swapParams.amountIn,
            amountOutMinimum: swapParams.amountOutMinimum
        });

        // Execute swap
        amountOut = IUniswapV3Router(router).exactInput(v3Params);

        // Calculate fee
        uint256 feeAmount = _calculateFee(swapParams.amountOutMinimum, swapParams.paymentAmount);

        // Store swap data (effects before interactions)
        uint256 swapId = _storeSwap(swapParams.to, tokenOut, swapParams.paymentAmount, swapParams.memo);
        emit SwapFee(msg.sender, swapId, feeAmount);

        // Distribute tokens (interactions)
        _distributeTokens(
            tokenOut,
            amountOut,
            swapParams.to,
            swapParams.paymentAmount,
            feeAmount
        );

        emit SwapExecuted(msg.sender, swapParams.to, tokenIn, tokenOut, swapParams.amountIn, amountOut,  swapParams.paymentAmount, swapParams.memo);
    }

    /**
     * @dev Swap ETH for exact tokens on Uniswap V3 (single hop)
     * @param params SwapETHForExactTokensV3SingleParams struct containing all swap parameters
     */
    function swapETHForExactTokensSingleV3(
        SwapETHForExactTokensV3SingleParams calldata params
    ) external payable nonReentrant returns (uint256 amountIn) {
        require(params.paymentAmount <= params.amountOut, "Payment amount exceeds output");

        // Calculate fee
        uint256 feeAmount = _calculateFee(params.amountOut, params.paymentAmount);

        // Prepare swap parameters - recipient is this contract
        IUniswapV3Router.ExactOutputSingleParams memory v3Params = IUniswapV3Router.ExactOutputSingleParams({
            tokenIn: WETH,
            tokenOut: params.tokenOut,
            fee: params.fee,
            recipient: address(this),
            deadline: params.deadline,
            amountOut: params.amountOut,
            amountInMaximum: msg.value,
            sqrtPriceLimitX96: 0
        });

        // Execute swap (router will pull ETH)
        amountIn = IUniswapV3Router(router).exactOutputSingle{value: msg.value}(v3Params);

        // Refund unused ETH
        IUniswapV3Router(router).refundETH();

        // Store swap data (effects before interactions)
        uint256 swapId = _storeSwap(params.to, params.tokenOut, params.paymentAmount, params.memo);
        emit SwapFee(msg.sender, swapId, feeAmount);

        // Distribute tokens (interactions)
        _distributeTokens(
            params.tokenOut,
            params.amountOut,
            params.to,
            params.paymentAmount,
            feeAmount
        );

        // Refund any remaining ETH to sender
        uint256 refundAmount = address(this).balance;
        if (refundAmount > 0) {
            (bool success, ) = payable(msg.sender).call{value: refundAmount}("");
            require(success, "ETH refund failed");
        }

        emit SwapExecuted(msg.sender, params.to, WETH, params.tokenOut, amountIn, params.amountOut, params.paymentAmount, params.memo);
    }

    /**
     * @dev Swap ETH for exact tokens on Uniswap V3 (multi-hop)
     * @param params SwapETHForExactTokensV3MultiParams struct containing all swap parameters
     */
    function swapETHForExactTokensV3Multi(
        SwapETHForExactTokensV3MultiParams calldata params
    ) external payable nonReentrant returns (uint256 amountIn) {
        require(params.paymentAmount <= params.amountOut, "Payment amount exceeds output");

        // Extract tokenOut from path (first 20 bytes for exact output - path is reversed)
        address tokenOut;
        {
            bytes calldata path = params.path;
            assembly {
                tokenOut := shr(96, calldataload(path.offset))
            }
        }

        // Calculate fee
        uint256 feeAmount = _calculateFee(params.amountOut, params.paymentAmount);

        // Prepare swap parameters - recipient is this contract
        IUniswapV3Router.ExactOutputParams memory v3Params = IUniswapV3Router.ExactOutputParams({
            path: params.path,
            recipient: address(this),
            deadline: params.deadline,
            amountOut: params.amountOut,
            amountInMaximum: msg.value
        });

        // Execute swap
        amountIn = IUniswapV3Router(router).exactOutput{value: msg.value}(v3Params);

        // Refund unused ETH
        IUniswapV3Router(router).refundETH();

        // Store swap data (effects before interactions)
        uint256 swapId = _storeSwap(params.to, tokenOut, params.paymentAmount, params.memo);
        emit SwapFee(msg.sender, swapId, feeAmount);

        // Distribute tokens (interactions)
        _distributeTokens(
            tokenOut,
            params.amountOut,
            params.to,
            params.paymentAmount,
            feeAmount
        );

        // Refund any remaining ETH to sender
        uint256 refundAmount = address(this).balance;
        if (refundAmount > 0) {
            (bool success, ) = payable(msg.sender).call{value: refundAmount}("");
            require(success, "ETH refund failed");
        }

        emit SwapExecuted(msg.sender, params.to, WETH, tokenOut, amountIn, params.amountOut, params.paymentAmount, params.memo);
    }

    /**
     * @dev Swap tokens for exact tokens on Uniswap V3 (single hop)
     * @param params SwapV3ExactOutputSingleParams struct containing all swap parameters
     */
    function swapTokensForExactTokensSingleV3(
        SwapV3ExactOutputSingleParams calldata params
    ) external nonReentrant returns (uint256 amountIn) {
        require(params.paymentAmount <= params.amountOut, "Payment amount exceeds output");

        // Transfer max tokens from sender to this contract
        IERC20(params.tokenIn).safeTransferFrom(msg.sender, address(this), params.amountInMaximum);

        // Approve router to spend tokens
        IERC20(params.tokenIn).safeIncreaseAllowance(router, params.amountInMaximum);

        // Calculate fee
        uint256 feeAmount = _calculateFee(params.amountOut, params.paymentAmount);

        // Prepare swap parameters - recipient is this contract
        IUniswapV3Router.ExactOutputSingleParams memory v3Params = IUniswapV3Router.ExactOutputSingleParams({
            tokenIn: params.tokenIn,
            tokenOut: params.tokenOut,
            fee: params.fee,
            recipient: address(this),
            deadline: params.deadline,
            amountOut: params.amountOut,
            amountInMaximum: params.amountInMaximum,
            sqrtPriceLimitX96: 0
        });

        // Execute swap
        amountIn = IUniswapV3Router(router).exactOutputSingle(v3Params);

        // Store swap data (effects before interactions)
        uint256 swapId = _storeSwap(params.to, params.tokenOut, params.paymentAmount, params.memo);
        emit SwapFee(msg.sender, swapId, feeAmount);

        // Distribute output tokens (interactions)
        _distributeTokens(
            params.tokenOut,
            params.amountOut,
            params.to,
            params.paymentAmount,
            feeAmount
        );

        // Refund any unused input tokens back to sender
        if (params.amountInMaximum > amountIn) {
            IERC20(params.tokenIn).safeTransfer(msg.sender, params.amountInMaximum - amountIn);
        }

        emit SwapExecuted(msg.sender, params.to, params.tokenIn, params.tokenOut, amountIn, params.amountOut, params.paymentAmount, params.memo);
    }

    /**
     * @dev Swap tokens for exact tokens on Uniswap V3 (multi-hop)
     * @param params SwapV3ExactOutputMultiParams struct containing all swap parameters
     */
    function swapTokensForExactTokensV3Multi(
        SwapV3ExactOutputMultiParams calldata params
    ) external nonReentrant returns (uint256 amountIn) {
        require(params.paymentAmount <= params.amountOut, "Payment amount exceeds output");

        // Extract tokenIn and tokenOut from path (path is reversed for exact output)
        address tokenIn;
        address tokenOut;
        {
            bytes calldata path = params.path;
            assembly {
                // For exact output, path is reversed: tokenOut is first, tokenIn is last
                tokenOut := shr(96, calldataload(path.offset))
                tokenIn := shr(96, calldataload(add(path.offset, sub(path.length, 20))))
            }
        }

        // Transfer max tokens from sender to this contract
        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), params.amountInMaximum);

        // Approve router to spend tokens
        IERC20(tokenIn).safeIncreaseAllowance(router, params.amountInMaximum);

        // Calculate fee
        uint256 feeAmount = _calculateFee(params.amountOut, params.paymentAmount);

        // Prepare swap parameters - recipient is this contract
        IUniswapV3Router.ExactOutputParams memory v3Params = IUniswapV3Router.ExactOutputParams({
            path: params.path,
            recipient: address(this),
            deadline: params.deadline,
            amountOut: params.amountOut,
            amountInMaximum: params.amountInMaximum
        });

        // Execute swap
        amountIn = IUniswapV3Router(router).exactOutput(v3Params);

        // Store swap data (effects before interactions)
        uint256 swapId = _storeSwap(params.to, tokenOut, params.paymentAmount, params.memo);
        emit SwapFee(msg.sender, swapId, feeAmount);

        // Distribute output tokens (interactions)
        _distributeTokens(
            tokenOut,
            params.amountOut,
            params.to,
            params.paymentAmount,
            feeAmount
        );

        // Refund any unused input tokens back to sender
        if (params.amountInMaximum > amountIn) {
            IERC20(tokenIn).safeTransfer(msg.sender, params.amountInMaximum - amountIn);
        }

        emit SwapExecuted(msg.sender, params.to, tokenIn, tokenOut, amountIn, params.amountOut, params.paymentAmount, params.memo);
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
        SwapData[] memory result = new SwapData[](length);

        for (uint256 i = 0; i < length; i++) {
            result[i] = swaps[fromId + i];
        }

        return result;
    }

    /**
     * @dev Quote how much input is needed for a desired output on V2/PancakeSwap
     * @param amountOut Desired output amount (paymentAmount + feeAmount)
     * @param path Array of token addresses representing the swap path
     * @return amounts Array of amounts needed, amounts[0] is input needed
     */
    function quoteForExactOutputV2(
        uint256 amountOut,
        address[] calldata path
    ) external view returns (uint256[] memory amounts) {
        return IUniswapV2Router(router).getAmountsIn(amountOut, path);
    }

    /**
     * @dev Quote how much output you get for a given input on V2/PancakeSwap
     * @param amountIn Input amount
     * @param path Array of token addresses representing the swap path
     * @return amounts Array of amounts, amounts[amounts.length - 1] is output
     */
    function quoteForExactInputV2(
        uint256 amountIn,
        address[] calldata path
    ) external view returns (uint256[] memory amounts) {
        return IUniswapV2Router(router).getAmountsOut(amountIn, path);
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
            if (feeAmount > (maxFeeBps * amountOutMin / 10000)) {
                revert("Fee exceed max allowed");
            }
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
     * @param paymentAmount Amount sent to recipient
     * @param memo Memo or reference for the payment
     */
    function _storeSwap(
        address recipient,
        address token,
        uint256 paymentAmount,
        string calldata memo
    ) private returns(uint256)  {
        lastSwapId++;
        swaps[lastSwapId] = SwapData({
            recipient: recipient,
            paymentAmount: paymentAmount,
            timestamp: block.timestamp,
            memo: memo
        });
        swapCounts[recipient]++;
        swapTotalsReceipient[recipient]+=paymentAmount;
        swapTotalsToken[token]+=paymentAmount;
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
            (bool success, ) = payable(to).call{value: amount}("");
            require(success, "ETH transfer failed");
        } else {
            IERC20(token).safeTransfer(to, amount);
        }
    }

    /**
     * @dev Receive function to accept ETH
     */
    receive() external payable {}
}
