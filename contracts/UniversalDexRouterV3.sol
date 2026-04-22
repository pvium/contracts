// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import "./interfaces/IUniswapV2Router.sol";
import "./interfaces/IUniswapV3Router.sol";
import "./interfaces/IMerkleBatchPayout.sol";
import "./interfaces/IWETH.sol";
import "hardhat/console.sol";

/**
 * @title Pvium Protocol UniversalDexRouter
 * @dev A simplified routing contract for Uniswap V2/V3 and PancakeSwap
 * Deploy separately on each chain with the appropriate router address
 * Uses AccessControl for role-based permissions
 */
contract UniversalDexRouterV3 is AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using MessageHashUtils for bytes32;

    // Roles
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");

    // DEX Router address (Uniswap or PancakeSwap)
    address public immutable router;

    // WETH address for handling native ETH
    address public immutable WETH;

    // Fee receiver address
    address public feeReceiver;

    uint256 public immutable maxFeeBps = 30; // Max fee in basis points (0.3%)

    mapping(bytes32 => uint) public paidBatchIds; // For future extensibility
    mapping(address => bool) public supportMerkleBatchPayoutContracts; // For future extensibility
    mapping(bytes32 => address) merkleBatchContract;

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

    struct PayoutIntent {
        address receiver;
        uint256 amount;
        address token;
        string memo;
    }

    struct BatchPaySummary {
        uint256 amountIn;
        uint256 amountOut;
        address[] path;
    }

    // Input struct for V3 exact output single hop swaps
    struct SwapV3ExactOutputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        uint256 amountOut; // Exact amount of output tokens desired
        uint256 amountInMaximum; // Maximum amount of input tokens willing to spend
        address to;
        uint256 paymentAmount;
        uint256 deadline;
        string memo;
    }

    // Input struct for V3 exact output multi-hop swaps
    struct SwapV3ExactOutputMultiParams {
        bytes path; // Encoded path (reversed for exact output)
        uint256 amountOut; // Exact amount of output tokens desired
        uint256 amountInMaximum; // Maximum amount of input tokens willing to spend
        address to;
        uint256 paymentAmount;
        uint256 deadline;
        string memo;
    }

    // Input struct for ETH to exact tokens V3 single hop
    struct SwapETHForExactTokensV3SingleParams {
        address tokenOut;
        uint24 fee;
        uint256 amountOut; // Exact amount of tokens desired
        address to;
        uint256 paymentAmount;
        uint256 deadline;
        string memo;
    }

    // Input struct for ETH to exact tokens V3 multi-hop
    struct SwapETHForExactTokensV3MultiParams {
        bytes path; // Encoded path (reversed, starts with tokenOut)
        uint256 amountOut; // Exact amount of tokens desired
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
    event PaymentExecuted(
        address indexed sender,
        address indexed recipient,
        address indexed token,
        uint256 paymentAmount,
        string memo
    );
    event BatchPaid(
        bytes32 indexed batch,
        address indexed inputToken,
        uint indexed inputAmount,
        address payer
    );
    event SwapFee(address indexed sender, uint256 indexed swapId, uint256 fee);
    event FeeReceiverUpdated(
        address indexed oldReceiver,
        address indexed newReceiver
    );
    event MerkleBatchPayoutContractAction(
        address indexed merkleBatchPayoutContract,
         bytes32 indexed id,
        string indexed action
    );

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
        address _admin,
        address _merkleTreeContract
    ) {
        require(_router != address(0), "Invalid router address");
        require(_weth != address(0), "Invalid WETH address");
        require(_feeReceiver != address(0), "Invalid fee receiver address");
        require(_defaultAdmin != address(0), "Invalid default admin address");
        require(_admin != address(0), "Invalid admin address");
        supportMerkleBatchPayoutContracts[_merkleTreeContract] = true;

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
    function setFeeReceiver(
        address newFeeReceiver
    ) external onlyRole(ADMIN_ROLE) {
        require(newFeeReceiver != address(0), "Invalid fee receiver address");
        address oldReceiver = feeReceiver;
        feeReceiver = newFeeReceiver;
        emit FeeReceiverUpdated(oldReceiver, newFeeReceiver);
    }

    function setSupportedMerkleBatchPayoutContract(
        address merkleBatchPayoutContract,
        bool supported
    ) external onlyRole(ADMIN_ROLE) {
        require(
            merkleBatchPayoutContract != address(0),
            "Invalid Merkle batch payout contract"
        );
        supportMerkleBatchPayoutContracts[
            merkleBatchPayoutContract
        ] = supported;
        emit MerkleBatchPayoutContractAction(
            merkleBatchPayoutContract,
            bytes32(0),
            "registered"
        );
    }

    /**
     * @dev Swap exact tokens for tokens on Uniswap V2 / PancakeSwap
     * @param params SwapV2Params struct containing all swap parameters
     */
    function swapExactTokensForTokens(
        SwapV2Params calldata params
    ) external nonReentrant returns (uint256[] memory amounts) {
        require(
            params.paymentAmount <= params.amountOutMin,
            "Payment amount exceeds minimum output"
        );

        // Transfer tokens from sender to this contract
        IERC20(params.path[0]).safeTransferFrom(
            msg.sender,
            address(this),
            params.amountIn
        );

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
        uint256 feeAmount = _calculateFee(
            params.amountOutMin,
            params.paymentAmount
        );

        // Store swap data (effects before interactions)
        uint256 swapId = _storeSwap(
            params.to,
            params.path[params.path.length - 1],
            params.paymentAmount,
            params.memo
        );
        emit SwapFee(msg.sender, swapId, feeAmount);

        // Distribute tokens (interactions)
        _distributeTokens(
            params.path[params.path.length - 1],
            amounts[amounts.length - 1],
            params.to,
            params.paymentAmount,
            feeAmount
        );

        emit SwapExecuted(
            msg.sender,
            params.to,
            params.path[0],
            params.path[params.path.length - 1],
            params.amountIn,
            amounts[amounts.length - 1],
            params.paymentAmount,
            params.memo
        );
    }

    /**
     * @dev Swap exact ETH for tokens on Uniswap V2 / PancakeSwap
     * @param params SwapETHParams struct containing swap parameters
     */
    function swapExactETHForTokens(
        SwapETHParams calldata params
    ) external payable nonReentrant returns (uint256[] memory amounts) {
        require(params.path[0] == WETH, "Path must start with WETH");
        require(
            params.paymentAmount <= params.amountOutMin,
            "Payment amount exceeds minimum output"
        );

        // Execute swap - recipient is this contract
        amounts = IUniswapV2Router(router).swapExactETHForTokens{
            value: msg.value
        }(params.amountOutMin, params.path, address(this), params.deadline);

        // Calculate fee
        uint256 feeAmount = _calculateFee(
            params.amountOutMin,
            params.paymentAmount
        );

        // Store swap data (effects before interactions)
        uint256 swapId = _storeSwap(
            params.to,
            params.path[params.path.length - 1],
            params.paymentAmount,
            params.memo
        );
        emit SwapFee(msg.sender, swapId, feeAmount);

        // Distribute tokens (interactions)
        _distributeTokens(
            params.path[params.path.length - 1],
            amounts[amounts.length - 1],
            params.to,
            params.paymentAmount,
            feeAmount
        );

        emit SwapExecuted(
            msg.sender,
            params.to,
            params.path[0],
            params.path[params.path.length - 1],
            msg.value,
            amounts[amounts.length - 1],
            params.paymentAmount,
            params.memo
        );
    }

    /**
     * @dev Swap tokens for exact tokens on Uniswap V2 / PancakeSwap
     * @param params SwapV2Params struct containing all swap parameters
     */
    function swapTokensForExactTokens(
        SwapV2Params memory params
    ) public nonReentrant returns (uint256[] memory amounts) {
        require(
            params.paymentAmount <= params.amountOutMin,
            "Payment amount exceeds minimum output"
        );

        // Transfer max tokens from sender to this contract
        IERC20(params.path[0]).safeTransferFrom(
            msg.sender,
            address(this),
            params.amountIn
        );

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
        uint256 feeAmount = _calculateFee(
            params.amountOutMin,
            params.paymentAmount
        );

        // Store swap data (effects before interactions)
        uint256 swapId = _storeSwap(
            params.to,
            params.path[params.path.length - 1],
            params.paymentAmount,
            params.memo
        );
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
            IERC20(params.path[0]).safeTransfer(
                msg.sender,
                params.amountIn - amounts[0]
            );
        }

        emit SwapExecuted(
            msg.sender,
            params.to,
            params.path[0],
            params.path[params.path.length - 1],
            amounts[0],
            amounts[amounts.length - 1],
            params.paymentAmount,
            params.memo
        );
    }

    function existsInPath(
        address token,
        address[] memory path
    ) internal pure returns (bool) {
        for (uint i = 0; i < path.length; i++) {
            if (path[i] == token) {
                return true;
            }
        }
        return false;
    }

    /**
     * @dev Execute multiple token swaps and distribute payments to recipients in a single transaction
     * @param payouts Array of payment instructions (recipient, amount, token, memo)
     * @param payoutSummary Array of swap configurations (amountIn, amountOut, path). Each path must have unique output token
     * @param tokenIn Input token for all swaps (address(0) for ETH, requires msg.value)
     * @param deadline Unix timestamp deadline for swaps
     * @param feeBps Maximum acceptable fee in basis points (max 30 bps). Fee = (swap output - payouts per token)
     */
    function batchPay(
        PayoutIntent[] calldata payouts,
        BatchPaySummary[] calldata payoutSummary,
        address tokenIn,
        uint256 deadline,
        uint256 feeBps,
        bytes32 batchHash,
        bytes calldata salt
    ) external payable nonReentrant {
        // Pull total input from caller
        if (batchHash != bytes32(0)) {
            require(
                batchHash == keccak256(abi.encode(salt, payouts)),
                "Batch hash mismatch"
            );
            require(paidBatchIds[batchHash] == 0, "Batch already paid");
            paidBatchIds[ keccak256(abi.encode(msg.sender, batchHash))] = block.timestamp;
        }
        uint[] memory swapAmounts = new uint[](payoutSummary.length);
        address[] memory swapTokens = new address[](payoutSummary.length);
        address[] memory swapOutputs = new address[](payoutSummary.length);
        require(feeBps <= maxFeeBps, "Fee exceeds maximum");
        uint totalAmountIn = 0;
        for (uint i = 0; i < payoutSummary.length; i++) {
            totalAmountIn += payoutSummary[i].amountIn;
        }
        if (tokenIn == address(0x0)) {
            require(
                msg.value >= totalAmountIn,
                "Insufficient ETH sent for swaps"
            );
        } else {
            require(
                IERC20(tokenIn).balanceOf(msg.sender) >= totalAmountIn,
                "Insufficient token balance for swaps"
            );
            require(
                IERC20(tokenIn).allowance(msg.sender, address(this)) >=
                    totalAmountIn,
                "Insufficient token allowance for swaps"
            );
            IERC20(tokenIn).safeTransferFrom(
                msg.sender,
                address(this),
                totalAmountIn
            );
            IERC20(tokenIn).safeIncreaseAllowance(router, totalAmountIn);
        }
        uint totalInputAmount = 0;
        for (uint i = 0; i < payoutSummary.length; i++) {
            require(
                payoutSummary[i].path.length > 1,
                "Swap intent must have more than 1 token in path"
            );
            require(
                !existsInPath(
                    payoutSummary[i].path[payoutSummary[i].path.length - 1],
                    swapOutputs
                ),
                "Duplicate output token in swap intents"
            );
            swapOutputs[i] = payoutSummary[i].path[
                payoutSummary[i].path.length - 1
            ];
            // Execute swap - recipient is this contract
            require(
                (payoutSummary[i].path[0] == IUniswapV2Router(router).WETH() &&
                    tokenIn == address(0x0)) ||
                    (tokenIn == payoutSummary[i].path[0]),
                "Invalid swap path"
            );
            // if (tokenIn == payoutSummary[i].path[0] &&  tokenIn != address(0x0)) {
            //     IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), payoutSummary[i].amountIn);
            //     continue;
            // }
            if (tokenIn == address(0x0)) {
                uint[] memory amounts = IUniswapV2Router(router)
                    .swapETHForExactTokens{value: payoutSummary[i].amountIn}(
                    payoutSummary[i].amountOut,
                    payoutSummary[i].path,
                    address(this),
                    deadline
                );
                if (amounts[0] < payoutSummary[i].amountIn) {
                    // Refund unused ETH
                    (bool success, ) = payable(msg.sender).call{
                        value: payoutSummary[i].amountIn - amounts[0]
                    }("");
                    require(success, "ETH refund failed");
                }
                totalInputAmount += amounts[0];
            } else {
                // Check if swap is needed or if it's a direct transfer (same token)
                if (tokenIn != payoutSummary[i].path[payoutSummary[i].path.length - 1]) {
                    // Swap needed: different input and output tokens
                    uint[] memory amounts = IUniswapV2Router(router)
                        .swapTokensForExactTokens(
                            payoutSummary[i].amountOut,
                            payoutSummary[i].amountIn,
                            payoutSummary[i].path,
                            address(this),
                            deadline
                        );
                    if (amounts[0] > 0 && amounts[0] < payoutSummary[i].amountIn) {
                        // Refund unused tokens
                        IERC20(tokenIn).safeTransfer(
                            msg.sender,
                            payoutSummary[i].amountIn - amounts[0]
                        );
                    }
                    totalInputAmount += amounts[0];
                } else {
                    // No swap needed: same token (already pulled from user earlier)
                    // Just track the amount - tokens already in this contract
                    totalInputAmount += payoutSummary[i].amountOut;
                }
            }
        }
        require(
            totalInputAmount <= totalAmountIn,
            "Total input amount exceeds expected"
        );
        if (tokenIn != address(0x0)) {
            // Revoke approval after swaps
            IERC20(tokenIn).approve(router, 0);
        }
        for (uint i = 0; i < payouts.length; i++) {
            require(payouts[i].token != address(0x0), "Invalid token address");
            uint foundIndex = type(uint256).max;
            for (uint j = 0; j < swapTokens.length; j++) {
                if (
                    swapTokens[j] == payouts[i].token ||
                    swapTokens[j] == address(0x0)
                ) {
                    foundIndex = j;
                    break;
                }
            }
            if (foundIndex == type(uint256).max) {
                revert("No swap intent for payout token");
            }
            swapTokens[foundIndex] = payouts[i].token;
            swapAmounts[foundIndex] += payouts[i].amount;
            IERC20(payouts[i].token).safeTransfer(
                payouts[i].receiver,
                payouts[i].amount
            );
            emit PaymentExecuted(
                msg.sender,
                payouts[i].receiver,
                payouts[i].token,
                payouts[i].amount,
                payouts[i].memo
            );
        }

        // ensure that we received enough tokens to cover the payouts and fees
        for (uint i = 0; i < swapTokens.length; i++) {
            bool found = false;
            for (uint j = 0; j < payoutSummary.length; j++) {
                if (
                    swapTokens[i] ==
                    payoutSummary[j].path[payoutSummary[j].path.length - 1]
                ) {
                    found = true;
                    if (swapAmounts[i] <= payoutSummary[j].amountOut) {
                        require(
                            ((payoutSummary[j].amountOut - swapAmounts[i]) *
                                10000) /
                                payoutSummary[j].amountOut <=
                                feeBps,
                            "Fee exceeds maximum"
                        );
                        IERC20(swapTokens[i]).safeTransfer(
                            feeReceiver,
                            (payoutSummary[j].amountOut - swapAmounts[i])
                        );
                    } else {
                        revert(
                            "Insufficient amount received from swap for payout"
                        );
                    }

                    break;
                }
                // if(payoutSummary[j].path.length == 0 && payoutSummary[j].amountOut == 0) {
                //     found = true;
                // }
            }
            require(found, "No swap intent for payout token");
        }
        emit BatchPaid(batchHash, tokenIn, totalAmountIn, msg.sender);
    }

    function createMerkleBatch(
        address merkleBatchPayoutContract,
        BatchPaySummary calldata payoutSummary,
        bytes32 externalBatchId,
        uint256 timestamp,
        address signer,
        bytes32 merkleRoot,
        uint256 claimGracePeriod,
        uint256 disaprovalDeadline,
        address withdrawalWallet,
        bytes calldata signature,
        uint fundingAmount,
        uint256 swapDeadline
    ) public payable nonReentrant {
        require(
            merkleBatchPayoutContract != address(0),
            "Invalid Merkle batch payout contract"
        );
        require(
            supportMerkleBatchPayoutContracts[merkleBatchPayoutContract],
            "Unsupported Merkle batch payout contract"
        );
        require(signer != address(0), "Invalid signer");
        require(merkleRoot != bytes32(0), "Invalid merkle root");
         require(
            payoutSummary.path.length > 1,
            "Swap intent must include funding token and output token"
        );
        address fundingToken =  payoutSummary.path[payoutSummary.path.length - 1];
        require(fundingToken != address(0), "Invalid funding token");
        require(signature.length > 0, "signature is required");

        uint256 amountOut = payoutSummary.amountOut;
     
       
        require(
            payoutSummary.amountOut > 0,
            "Funding amount must be greater than 0"
        );

       address tokenIn = payoutSummary.path[0];
        if (tokenIn == address(0x0) || tokenIn == address(IUniswapV2Router(router).WETH())) {
            // ETH swap
            
            require(
                msg.value >= payoutSummary.amountIn,
                "Insufficient ETH sent"
            );
            uint[] memory amounts = IUniswapV2Router(router)
                .swapETHForExactTokens{value: payoutSummary.amountIn}(
                payoutSummary.amountOut,
                payoutSummary.path,
                address(this),
                swapDeadline
            );
            if (amounts[0] < payoutSummary.amountIn) {
                // Refund unused ETH
                (bool success, ) = payable(msg.sender).call{
                    value: payoutSummary.amountIn - amounts[0]
                }("");
                require(success, "ETH refund failed");
            }
        } else {
            
            // Token swap or direct transfer
            if (tokenIn != payoutSummary.path[payoutSummary.path.length - 1]) {
                // Swap needed: pull tokenIn, approve router, execute swap
                IERC20(tokenIn).safeTransferFrom(
                    msg.sender,
                    address(this),
                    payoutSummary.amountIn
                );
                IERC20(tokenIn).safeIncreaseAllowance(router, payoutSummary.amountIn);

                uint[] memory amounts = IUniswapV2Router(router)
                    .swapTokensForExactTokens(
                        payoutSummary.amountOut,
                        payoutSummary.amountIn,
                        payoutSummary.path,
                        address(this),
                        swapDeadline
                    );
                if (amounts[0] > 0 && amounts[0] < payoutSummary.amountIn) {
                    // Refund unused tokens
                    IERC20(tokenIn).safeTransfer(
                        msg.sender,
                        payoutSummary.amountIn - amounts[0]
                    );
                }
            } else {
                // No swap needed: directly pull fundingToken
                IERC20(fundingToken).safeTransferFrom(
                    msg.sender,
                    address(this),
                    amountOut
                );
            }
        }
        
        require(
            amountOut >= fundingAmount,
            "Amount out must be greater than funding amount"
        );

       

       

        if (amountOut > fundingAmount) {
            uint256 feeAmount = amountOut - fundingAmount;
            uint256 maxAllowedFee = (amountOut * maxFeeBps) / 10000;

            if (feeAmount > maxAllowedFee) {
                IERC20(fundingToken).safeTransfer(feeReceiver, maxAllowedFee);
                IERC20(fundingToken).safeTransfer(
                    msg.sender,
                    feeAmount - maxAllowedFee
                );
            } else {
                IERC20(fundingToken).safeTransfer(feeReceiver, feeAmount);
            }
        }

        IERC20(fundingToken).safeIncreaseAllowance(
            merkleBatchPayoutContract,
            fundingAmount
        );

       bytes32 batchId = IMerkleBatchPayout(merkleBatchPayoutContract).createBatch(
            externalBatchId,
            timestamp,
            signer,
            merkleRoot,
            claimGracePeriod,
            disaprovalDeadline,
            fundingToken,
            fundingAmount,
            withdrawalWallet,
            signature
        );
        {
         
        IERC20(fundingToken).forceApprove(merkleBatchPayoutContract, 0);
        merkleBatchContract[batchId]=merkleBatchPayoutContract;
        emit MerkleBatchPayoutContractAction(
            merkleBatchPayoutContract,
            batchId,
            "create"
        );
        }
    }

    function getMerkleBatch(bytes32 batchId) public view returns (IMerkleBatchPayout.Batch memory batch) {
        return IMerkleBatchPayout(merkleBatchContract[batchId]).getBatch(batchId);

    }
    function claimMerkleBatchPayment(
        address merkleBatchPayoutContract,
        bytes32 batchId,
        address receiverAddress,
        uint256 amount,
        uint256 claimDate,
        string calldata memo,
        bytes32[] calldata merkleProof
    ) external nonReentrant {
        require(
            merkleBatchPayoutContract != address(0),
            "Invalid Merkle batch payout contract"
        );
        require(
            supportMerkleBatchPayoutContracts[merkleBatchPayoutContract],
            "Unsupported Merkle batch payout contract"
        );

        IMerkleBatchPayout.Batch memory batch = IMerkleBatchPayout(
            merkleBatchPayoutContract
        ).getBatch(batchId);
        require(batch.exists, "Batch does not exist");

        IMerkleBatchPayout(merkleBatchPayoutContract).claimPayment(
            IMerkleBatchPayout.Payment({
                batchId: batchId,
                merkleRoot: batch.merkleRoot,
                receiver: receiverAddress,
                amount: amount,
                claimDate: claimDate,
                memo: memo
            }),
            merkleProof
        );
        emit MerkleBatchPayoutContractAction(
            merkleBatchPayoutContract,
            batchId,
            "claim"
        );
        emit PaymentExecuted(
            msg.sender,
            receiverAddress,
            batch.fundingToken,
            amount,
            memo
        );
    }

    function addFundsToMerkleBatch(
        address merkleBatchPayoutContract,
        bytes32 batchId,
        uint256 amount
    ) external nonReentrant {
        require(
            merkleBatchPayoutContract != address(0),
            "Invalid Merkle batch payout contract"
        );
        require(
            supportMerkleBatchPayoutContracts[merkleBatchPayoutContract],
            "Unsupported Merkle batch payout contract"
        );
        require(amount > 0, "Amount must be greater than 0");

        IMerkleBatchPayout.Batch memory batch = IMerkleBatchPayout(
            merkleBatchPayoutContract
        ).getBatch(batchId);
        require(batch.exists, "Batch does not exist");

        IERC20(batch.fundingToken).safeTransferFrom(
            msg.sender,
            address(this),
            amount
        );
        IERC20(batch.fundingToken).safeIncreaseAllowance(
            merkleBatchPayoutContract,
            amount
        );

        IMerkleBatchPayout(merkleBatchPayoutContract).addFundsToBatch(
            batchId,
            amount
        );

        IERC20(batch.fundingToken).forceApprove(merkleBatchPayoutContract, 0);
    }

    /**
     * @dev Swap ETH for exact tokens on Uniswap V2 / PancakeSwap
     * @param params SwapETHParams struct containing swap parameters
     */
    function swapETHForExactTokens(
        SwapETHParams memory params
    ) public payable nonReentrant returns (uint256[] memory amounts) {
        require(params.path[0] == WETH, "Path must start with WETH");
        require(
            params.paymentAmount <= params.amountOutMin,
            "Payment amount exceeds minimum output"
        );

        uint256 ethBalanceBefore = address(this).balance - msg.value;

        // Execute swap - recipient is this contract
        // amountOut is the exact amount of tokens we want
        amounts = IUniswapV2Router(router).swapETHForExactTokens{
            value: msg.value
        }(params.amountOutMin, params.path, address(this), params.deadline);

        // Calculate fee
        uint256 feeAmount = _calculateFee(
            params.amountOutMin,
            params.paymentAmount
        );

        // Store swap data (effects before interactions)
        uint256 swapId = _storeSwap(
            params.to,
            params.path[params.path.length - 1],
            params.paymentAmount,
            params.memo
        );

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
            (bool success, ) = payable(msg.sender).call{
                value: ethBalanceAfter - ethBalanceBefore
            }("");
            require(success, "ETH refund failed");
        }
        emit SwapFee(msg.sender, swapId, feeAmount);
        emit SwapExecuted(
            msg.sender,
            params.to,
            params.path[0],
            params.path[params.path.length - 1],
            amounts[0],
            amounts[amounts.length - 1],
            params.paymentAmount,
            params.memo
        );
    }

    /**
     * @dev Swap exact tokens for ETH on Uniswap V2 / PancakeSwap
     * @param params SwapV2Params struct containing all swap parameters
     */
    function swapExactTokensForETH(
        SwapV2Params calldata params
    ) external nonReentrant returns (uint256[] memory amounts) {
        require(
            params.path[params.path.length - 1] == WETH,
            "Path must end with WETH"
        );
        require(
            params.paymentAmount <= params.amountOutMin,
            "Payment amount exceeds minimum output"
        );

        // Transfer tokens from sender to this contract
        IERC20(params.path[0]).safeTransferFrom(
            msg.sender,
            address(this),
            params.amountIn
        );

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
        uint256 feeAmount = _calculateFee(
            params.amountOutMin,
            params.paymentAmount
        );

        // Store swap data (effects before interactions)
        uint256 swapId = _storeSwap(
            params.to,
            WETH,
            params.paymentAmount,
            params.memo
        );
        emit SwapFee(msg.sender, swapId, feeAmount);

        // Distribute ETH (interactions)
        _distributeETH(
            amounts[amounts.length - 1],
            params.to,
            params.paymentAmount,
            feeAmount
        );

        emit SwapExecuted(
            msg.sender,
            params.to,
            params.path[0],
            WETH,
            params.amountIn,
            amounts[amounts.length - 1],
            params.paymentAmount,
            params.memo
        );
    }

    /**
     * @dev Swap exact tokens for tokens on Uniswap V3 (single hop)
     * @param swapParams SwapV3SingleParams struct containing all swap parameters
     */
    function swapExactTokenForTokenSingleV3(
        SwapV3SingleParams calldata swapParams
    ) external nonReentrant returns (uint256 amountOut) {
        require(
            swapParams.paymentAmount <= swapParams.amountOutMinimum,
            "Payment amount exceeds minimum output"
        );

        // Transfer tokens from sender to this contract
        IERC20(swapParams.tokenIn).safeTransferFrom(
            msg.sender,
            address(this),
            swapParams.amountIn
        );

        // Approve router to spend tokens
        IERC20(swapParams.tokenIn).safeIncreaseAllowance(
            router,
            swapParams.amountIn
        );

        // Prepare swap parameters - recipient is this contract
        IUniswapV3Router.ExactInputSingleParams
            memory v3Params = IUniswapV3Router.ExactInputSingleParams({
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
        uint256 feeAmount = _calculateFee(
            swapParams.amountOutMinimum,
            swapParams.paymentAmount
        );

        // Store swap data (effects before interactions)
        uint256 swapId = _storeSwap(
            swapParams.to,
            swapParams.tokenOut,
            swapParams.paymentAmount,
            swapParams.memo
        );
        emit SwapFee(msg.sender, swapId, feeAmount);

        // Distribute tokens (interactions)
        _distributeTokens(
            swapParams.tokenOut,
            amountOut,
            swapParams.to,
            swapParams.paymentAmount,
            feeAmount
        );

        emit SwapExecuted(
            msg.sender,
            swapParams.to,
            swapParams.tokenIn,
            swapParams.tokenOut,
            swapParams.amountIn,
            amountOut,
            swapParams.paymentAmount,
            swapParams.memo
        );
    }

    /**
     * @dev Swap exact tokens for tokens on Uniswap V3 (multi-hop)
     * @param swapParams SwapV3MultiParams struct containing all swap parameters
     */
    function swapExactTokenForTokenV3Multi(
        SwapV3MultiParams calldata swapParams
    ) external nonReentrant returns (uint256 amountOut) {
        require(
            swapParams.paymentAmount <= swapParams.amountOutMinimum,
            "Payment amount exceeds minimum output"
        );

        // Extract first and last tokens from path
        address tokenIn;
        address tokenOut;
        {
            bytes calldata path = swapParams.path;
            assembly {
                // First token is at the beginning of the path
                tokenIn := shr(96, calldataload(path.offset))

                // Last token is 20 bytes before end
                tokenOut := shr(
                    96,
                    calldataload(add(path.offset, sub(path.length, 20)))
                )
            }
        }

        // Transfer tokens from sender to this contract
        IERC20(tokenIn).safeTransferFrom(
            msg.sender,
            address(this),
            swapParams.amountIn
        );

        // Approve router to spend tokens
        IERC20(tokenIn).safeIncreaseAllowance(router, swapParams.amountIn);

        // Prepare swap parameters - recipient is this contract
        IUniswapV3Router.ExactInputParams memory v3Params = IUniswapV3Router
            .ExactInputParams({
                path: swapParams.path,
                recipient: address(this),
                deadline: swapParams.deadline,
                amountIn: swapParams.amountIn,
                amountOutMinimum: swapParams.amountOutMinimum
            });

        // Execute swap
        amountOut = IUniswapV3Router(router).exactInput(v3Params);

        // Calculate fee
        uint256 feeAmount = _calculateFee(
            swapParams.amountOutMinimum,
            swapParams.paymentAmount
        );

        // Store swap data (effects before interactions)
        uint256 swapId = _storeSwap(
            swapParams.to,
            tokenOut,
            swapParams.paymentAmount,
            swapParams.memo
        );
        emit SwapFee(msg.sender, swapId, feeAmount);

        // Distribute tokens (interactions)
        _distributeTokens(
            tokenOut,
            amountOut,
            swapParams.to,
            swapParams.paymentAmount,
            feeAmount
        );

        emit SwapExecuted(
            msg.sender,
            swapParams.to,
            tokenIn,
            tokenOut,
            swapParams.amountIn,
            amountOut,
            swapParams.paymentAmount,
            swapParams.memo
        );
    }

    /**
     * @dev Swap ETH for exact tokens on Uniswap V3 (single hop)
     * @param params SwapETHForExactTokensV3SingleParams struct containing all swap parameters
     */
    function swapETHForExactTokensSingleV3(
        SwapETHForExactTokensV3SingleParams calldata params
    ) external payable nonReentrant returns (uint256 amountIn) {
        require(
            params.paymentAmount <= params.amountOut,
            "Payment amount exceeds output"
        );

        // Calculate fee
        uint256 feeAmount = _calculateFee(
            params.amountOut,
            params.paymentAmount
        );

        // Prepare swap parameters - recipient is this contract
        IUniswapV3Router.ExactOutputSingleParams
            memory v3Params = IUniswapV3Router.ExactOutputSingleParams({
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
        amountIn = IUniswapV3Router(router).exactOutputSingle{value: msg.value}(
            v3Params
        );

        // Refund unused ETH
        IUniswapV3Router(router).refundETH();

        // Store swap data (effects before interactions)
        uint256 swapId = _storeSwap(
            params.to,
            params.tokenOut,
            params.paymentAmount,
            params.memo
        );
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
            (bool success, ) = payable(msg.sender).call{value: refundAmount}(
                ""
            );
            require(success, "ETH refund failed");
        }

        emit SwapExecuted(
            msg.sender,
            params.to,
            WETH,
            params.tokenOut,
            amountIn,
            params.amountOut,
            params.paymentAmount,
            params.memo
        );
    }

    /**
     * @dev Swap ETH for exact tokens on Uniswap V3 (multi-hop)
     * @param params SwapETHForExactTokensV3MultiParams struct containing all swap parameters
     */
    function swapETHForExactTokensV3Multi(
        SwapETHForExactTokensV3MultiParams calldata params
    ) external payable nonReentrant returns (uint256 amountIn) {
        require(
            params.paymentAmount <= params.amountOut,
            "Payment amount exceeds output"
        );

        // Extract tokenOut from path (first 20 bytes for exact output - path is reversed)
        address tokenOut;
        {
            bytes calldata path = params.path;
            assembly {
                tokenOut := shr(96, calldataload(path.offset))
            }
        }

        // Calculate fee
        uint256 feeAmount = _calculateFee(
            params.amountOut,
            params.paymentAmount
        );

        // Prepare swap parameters - recipient is this contract
        IUniswapV3Router.ExactOutputParams memory v3Params = IUniswapV3Router
            .ExactOutputParams({
                path: params.path,
                recipient: address(this),
                deadline: params.deadline,
                amountOut: params.amountOut,
                amountInMaximum: msg.value
            });

        // Execute swap
        amountIn = IUniswapV3Router(router).exactOutput{value: msg.value}(
            v3Params
        );

        // Refund unused ETH
        IUniswapV3Router(router).refundETH();

        // Store swap data (effects before interactions)
        uint256 swapId = _storeSwap(
            params.to,
            tokenOut,
            params.paymentAmount,
            params.memo
        );
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
            (bool success, ) = payable(msg.sender).call{value: refundAmount}(
                ""
            );
            require(success, "ETH refund failed");
        }

        emit SwapExecuted(
            msg.sender,
            params.to,
            WETH,
            tokenOut,
            amountIn,
            params.amountOut,
            params.paymentAmount,
            params.memo
        );
    }

    /**
     * @dev Swap tokens for exact tokens on Uniswap V3 (single hop)
     * @param params SwapV3ExactOutputSingleParams struct containing all swap parameters
     */
    function swapTokensForExactTokensSingleV3(
        SwapV3ExactOutputSingleParams memory params
    ) public nonReentrant returns (uint256 amountIn) {
        require(
            params.paymentAmount <= params.amountOut,
            "Payment amount exceeds output"
        );

        // Transfer max tokens from sender to this contract
        IERC20(params.tokenIn).safeTransferFrom(
            msg.sender,
            address(this),
            params.amountInMaximum
        );

        // Approve router to spend tokens
        IERC20(params.tokenIn).safeIncreaseAllowance(
            router,
            params.amountInMaximum
        );

        // Calculate fee
        uint256 feeAmount = _calculateFee(
            params.amountOut,
            params.paymentAmount
        );

        // Prepare swap parameters - recipient is this contract
        IUniswapV3Router.ExactOutputSingleParams
            memory v3Params = IUniswapV3Router.ExactOutputSingleParams({
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
        uint256 swapId = _storeSwap(
            params.to,
            params.tokenOut,
            params.paymentAmount,
            params.memo
        );
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
            IERC20(params.tokenIn).safeTransfer(
                msg.sender,
                params.amountInMaximum - amountIn
            );
        }

        emit SwapExecuted(
            msg.sender,
            params.to,
            params.tokenIn,
            params.tokenOut,
            amountIn,
            params.amountOut,
            params.paymentAmount,
            params.memo
        );
    }

    /**
     * @dev Swap tokens for exact tokens on Uniswap V3 (multi-hop)
     * @param params SwapV3ExactOutputMultiParams struct containing all swap parameters
     */
    function swapTokensForExactTokensV3Multi(
        SwapV3ExactOutputMultiParams calldata params
    ) external nonReentrant returns (uint256 amountIn) {
        require(
            params.paymentAmount <= params.amountOut,
            "Payment amount exceeds output"
        );

        // Extract tokenIn and tokenOut from path (path is reversed for exact output)
        address tokenIn;
        address tokenOut;
        {
            bytes calldata path = params.path;
            assembly {
                // For exact output, path is reversed: tokenOut is first, tokenIn is last
                tokenOut := shr(96, calldataload(path.offset))
                tokenIn := shr(
                    96,
                    calldataload(add(path.offset, sub(path.length, 20)))
                )
            }
        }

        // Transfer max tokens from sender to this contract
        IERC20(tokenIn).safeTransferFrom(
            msg.sender,
            address(this),
            params.amountInMaximum
        );

        // Approve router to spend tokens
        IERC20(tokenIn).safeIncreaseAllowance(router, params.amountInMaximum);

        // Calculate fee
        uint256 feeAmount = _calculateFee(
            params.amountOut,
            params.paymentAmount
        );

        // Prepare swap parameters - recipient is this contract
        IUniswapV3Router.ExactOutputParams memory v3Params = IUniswapV3Router
            .ExactOutputParams({
                path: params.path,
                recipient: address(this),
                deadline: params.deadline,
                amountOut: params.amountOut,
                amountInMaximum: params.amountInMaximum
            });

        // Execute swap
        amountIn = IUniswapV3Router(router).exactOutput(v3Params);

        // Store swap data (effects before interactions)
        uint256 swapId = _storeSwap(
            params.to,
            tokenOut,
            params.paymentAmount,
            params.memo
        );
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
            IERC20(tokenIn).safeTransfer(
                msg.sender,
                params.amountInMaximum - amountIn
            );
        }

        emit SwapExecuted(
            msg.sender,
            params.to,
            tokenIn,
            tokenOut,
            amountIn,
            params.amountOut,
            params.paymentAmount,
            params.memo
        );
    }

    /**
     * @dev Get swaps by ID range
     * @param fromId Starting swap ID (inclusive)
     * @param toId Ending swap ID (inclusive)
     * @return Array of SwapData structs
     */
    function getSwapsByRange(
        uint256 fromId,
        uint256 toId
    ) external view returns (SwapData[] memory) {
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
            if (feeAmount > ((maxFeeBps * amountOutMin) / 10000)) {
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
        string memory memo
    ) private returns (uint256) {
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
