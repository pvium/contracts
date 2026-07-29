// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./interfaces/IUniswapV2Router.sol";
import "./interfaces/IMerkleBatchPayout.sol";
import "./interfaces/IEscrowBatchPayout.sol";

/**
 * @title Pvium Protocol UniversalDexRouter
 * @dev A simplified routing contract for Uniswap V2 and PancakeSwap
 * Deploy separately on each chain with the appropriate router address
 * Uses AccessControl for role-based permissions
 */
contract UniversalDexRouter is AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;

    error InvalidEscrowBatchPayoutContract();
    error UnsupportedEscrowBatchPayoutContract();
    error InvalidEscrowSigner();
    error InvalidEscrowFundingToken();
    error InvalidEscrowFundingAmount();
    error InvalidEscrowSwapIntent();
    error EscrowFundingTokenMismatch();
    error EscrowAmountOutTooLow();
    error EscrowBatchDoesNotExist();

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
    mapping(address => bool) public supportEscrowBatchPayoutContracts;
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
    event MerkleBatchPayoutContractUpdated(
        address indexed merkleBatchPayoutContract,
        bool supported
    );
    event EscrowBatchPayoutContractUpdated(
        address indexed escrowBatchPayoutContract,
        bool supported
    );
    event MerkleBatchPaymentClaimed(
        address indexed merkleBatchContract,
        bytes32 indexed batchHash,
        address indexed receiver,
        uint256 amount,
        address token,
        uint256 claimData,
        uint256 timestamp,
        string memo
    );

    event MerkleBatchFunded(
        address indexed merkleBatchPayoutContract,
        bytes32 indexed batchId,
        uint256 indexed fundingAmount,
        address fundingToken,
        bytes32  batchHash,
        uint timestamp
   
    );

    /**
     * @dev Constructor
     * @param _router Address of the DEX router (Uniswap V2 or PancakeSwap)
     * @param _weth Address of WETH token
     * @param _feeReceiver Address to receive fees
     * @param _defaultAdmin Address to receive DEFAULT_ADMIN_ROLE
     * @param _admin Address to receive ADMIN_ROLE
     * @param _merkleTreeContract Initial supported Merkle batch payout contract
     * @param _escrowBatchPayoutContract Initial supported escrow batch payout contract
     */
    constructor(
        address _router,
        address _weth,
        address _feeReceiver,
        address _defaultAdmin,
        address _admin,
        address _merkleTreeContract,
        address _escrowBatchPayoutContract
    ) {
        require(_router != address(0), "Invalid router address");
        require(_weth != address(0), "Invalid WETH address");
        require(_feeReceiver != address(0), "Invalid fee receiver address");
        require(_defaultAdmin != address(0), "Invalid default admin address");
        require(_admin != address(0), "Invalid admin address");
        require(
            _merkleTreeContract != address(0),
            "Invalid Merkle batch payout contract"
        );
        if (_escrowBatchPayoutContract == address(0)) {
            revert InvalidEscrowBatchPayoutContract();
        }
        supportMerkleBatchPayoutContracts[_merkleTreeContract] = true;
        supportEscrowBatchPayoutContracts[_escrowBatchPayoutContract] = true;

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
        emit MerkleBatchPayoutContractUpdated(
            merkleBatchPayoutContract,
            supported
        );
   
    }

    function setSupportedEscrowBatchPayoutContract(
        address escrowBatchPayoutContract,
        bool supported
    ) external onlyRole(ADMIN_ROLE) {
        if (escrowBatchPayoutContract == address(0)) {
            revert InvalidEscrowBatchPayoutContract();
        }
        supportEscrowBatchPayoutContracts[escrowBatchPayoutContract] = supported;
        emit EscrowBatchPayoutContractUpdated(
            escrowBatchPayoutContract,
            supported
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

    function _fundBatchOutput(
        BatchPaySummary calldata payoutSummary,
        address fundingToken,
        uint256 fundingAmount,
        uint256 swapDeadline
    ) private returns (address tokenIn) {
        tokenIn = payoutSummary.path[0];

        if (tokenIn == address(0x0) || tokenIn == WETH) {
            require(msg.value >= payoutSummary.amountIn, "Insufficient ETH sent");
            uint[] memory amounts = IUniswapV2Router(router)
                .swapETHForExactTokens{value: payoutSummary.amountIn}(
                    payoutSummary.amountOut,
                    payoutSummary.path,
                    address(this),
                    swapDeadline
                );
            if (amounts[0] < payoutSummary.amountIn) {
                (bool success, ) = payable(msg.sender).call{
                    value: payoutSummary.amountIn - amounts[0]
                }("");
                require(success, "ETH refund failed");
            }
        } else if (tokenIn != fundingToken) {
            IERC20(tokenIn).safeTransferFrom(
                msg.sender,
                address(this),
                payoutSummary.amountIn
            );
            IERC20(tokenIn).safeIncreaseAllowance(router, payoutSummary.amountIn);
            uint[] memory amounts = IUniswapV2Router(router).swapTokensForExactTokens(
                payoutSummary.amountOut,
                payoutSummary.amountIn,
                payoutSummary.path,
                address(this),
                swapDeadline
            );
            if (amounts[0] > 0 && amounts[0] < payoutSummary.amountIn) {
                IERC20(tokenIn).safeTransfer(
                    msg.sender,
                    payoutSummary.amountIn - amounts[0]
                );
            }
            IERC20(tokenIn).forceApprove(router, 0);
        } else {
            IERC20(fundingToken).safeTransferFrom(
                msg.sender,
                address(this),
                payoutSummary.amountOut
            );
        }

        if (payoutSummary.amountOut > fundingAmount) {
            uint256 feeAmount = payoutSummary.amountOut - fundingAmount;
            uint256 maxAllowedFee = (payoutSummary.amountOut * maxFeeBps) / 10000;

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

        require(
            payoutSummary.amountOut > 0,
            "Funding amount must be greater than 0"
        );
        
        require(
            payoutSummary.amountOut >= fundingAmount,
            "Amount out must be greater than funding amount"
        );
        _fundBatchOutput(payoutSummary, fundingToken, fundingAmount, swapDeadline);

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
        IMerkleBatchPayout.Batch memory batch = IMerkleBatchPayout(merkleBatchPayoutContract).getBatch(batchId);
        emit MerkleBatchFunded(
            merkleBatchPayoutContract,
            batchId,
            fundingAmount,
            fundingToken,
            batch.batchHash,
            block.timestamp
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
        emit MerkleBatchPaymentClaimed(
            merkleBatchPayoutContract,
            batch.batchHash,
            receiverAddress,
            amount,
            batch.fundingToken,
            claimDate,
            block.timestamp,
            memo
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
        BatchPaySummary calldata payoutSummary,
        uint256 amount,
        uint256 swapDeadline
    ) external payable nonReentrant {
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
        require(
            payoutSummary.path.length > 1,
            "Swap intent must include funding token and output token"
        );
        require(
            payoutSummary.path[payoutSummary.path.length - 1] == batch.fundingToken,
            "Funding token must match swap output"
        );
        require(
            payoutSummary.amountOut >= amount,
            "Amount out must be greater than funding amount"
        );

        _fundBatchOutput(payoutSummary, batch.fundingToken, amount, swapDeadline);
        IERC20(batch.fundingToken).safeIncreaseAllowance(
            merkleBatchPayoutContract,
            amount
        );

        IMerkleBatchPayout(merkleBatchPayoutContract).addFundsToBatch(
            batchId,
            amount
        );

        IERC20(batch.fundingToken).forceApprove(merkleBatchPayoutContract, 0);
         emit MerkleBatchFunded(
            merkleBatchPayoutContract,
            batchId,
            amount,
            batch.fundingToken,
            batch.batchHash,
              block.timestamp
        );
    }

    /**
     * @dev Execute creation of an escrow batch payment through a supported escrow payout contract.
     */
    function createEscrow(
        address escrowBatchPayoutContract,
        BatchPaySummary calldata payoutSummary,
        bytes32 externalBatchId,
        uint256 timestamp,
        address signer,
        address fundingToken,
        uint256 fundingAmount,
        uint256 lockDuration,
        address withdrawalWallet,
        bytes calldata signature,
        uint256 swapDeadline
    ) external payable nonReentrant returns (bytes32 escrowBatchId) {
        if (escrowBatchPayoutContract == address(0)) {
            revert InvalidEscrowBatchPayoutContract();
        }
        if (!supportEscrowBatchPayoutContracts[escrowBatchPayoutContract]) {
            revert UnsupportedEscrowBatchPayoutContract();
        }
        if (signer == address(0)) revert InvalidEscrowSigner();
        if (fundingToken == address(0)) revert InvalidEscrowFundingToken();
        if (fundingAmount == 0) revert InvalidEscrowFundingAmount();
        if (payoutSummary.path.length <= 1) revert InvalidEscrowSwapIntent();
        if (payoutSummary.path[payoutSummary.path.length - 1] != fundingToken) {
            revert EscrowFundingTokenMismatch();
        }
        if (payoutSummary.amountOut < fundingAmount) {
            revert EscrowAmountOutTooLow();
        }

        address tokenIn = _fundBatchOutput(
            payoutSummary,
            fundingToken,
            fundingAmount,
            swapDeadline
        );

        IERC20(fundingToken).safeIncreaseAllowance(
            escrowBatchPayoutContract,
            fundingAmount
        );
        escrowBatchId = IEscrowBatchPayout(escrowBatchPayoutContract).createEscrow(
            externalBatchId,
            timestamp,
            signer,
            fundingToken,
            fundingAmount,
            lockDuration,
            withdrawalWallet,
            signature
        );
        IERC20(fundingToken).forceApprove(escrowBatchPayoutContract, 0);

        IEscrowBatchPayout.EscrowBatch memory batch = IEscrowBatchPayout(
            escrowBatchPayoutContract
        ).getEscrowBatch(escrowBatchId);
        emit MerkleBatchFunded(
            escrowBatchPayoutContract,
            escrowBatchId,
            fundingAmount,
            fundingToken,
            batch.batchHash,
            block.timestamp
        );
        emit BatchPaid(externalBatchId, tokenIn, payoutSummary.amountIn, msg.sender);
    }

    function claimEscrowPayment(
        address escrowBatchPayoutContract,
        bytes32 escrowBatchId,
        bytes32 scheduledBatchHash,
        bytes32 merkleRoot,
        address receiverAddress,
        uint256 amount,
        uint256 claimDate,
        string calldata memo,
        bytes calldata rootSignature,
        bytes32[] calldata merkleProof,
        IEscrowBatchPayout.PayoutSignerAuthorization calldata signerAuthorization
    ) external nonReentrant {
        if (escrowBatchPayoutContract == address(0)) {
            revert InvalidEscrowBatchPayoutContract();
        }
        if (!supportEscrowBatchPayoutContracts[escrowBatchPayoutContract]) {
            revert UnsupportedEscrowBatchPayoutContract();
        }
        IEscrowBatchPayout.EscrowBatch memory batch = IEscrowBatchPayout(
            escrowBatchPayoutContract
        ).getEscrowBatch(escrowBatchId);
        if (!batch.exists) revert EscrowBatchDoesNotExist();

        IEscrowBatchPayout(escrowBatchPayoutContract).claimPayment(
            IEscrowBatchPayout.EscrowPayment({
                receiver: receiverAddress,
                amount: amount,
                claimDate: claimDate,
                memo: memo
            }),
            escrowBatchId,
            scheduledBatchHash,
            merkleRoot,
            rootSignature,
            merkleProof,
            signerAuthorization
        );

        emit MerkleBatchPaymentClaimed(
            escrowBatchPayoutContract,
            batch.batchHash,
            receiverAddress,
            amount,
            batch.fundingToken,
            claimDate,
            block.timestamp,
            memo
        );
        emit PaymentExecuted(
            msg.sender,
            receiverAddress,
            batch.fundingToken,
            amount,
            memo
        );
    }

    function addFundsToEscrow(
        address escrowBatchPayoutContract,
        bytes32 escrowBatchId,
        BatchPaySummary calldata payoutSummary,
        uint256 amount,
        uint256 swapDeadline
    ) external payable nonReentrant {
        if (escrowBatchPayoutContract == address(0)) {
            revert InvalidEscrowBatchPayoutContract();
        }
        if (!supportEscrowBatchPayoutContracts[escrowBatchPayoutContract]) {
            revert UnsupportedEscrowBatchPayoutContract();
        }
        if (amount == 0) revert InvalidEscrowFundingAmount();

        IEscrowBatchPayout.EscrowBatch memory batch = IEscrowBatchPayout(
            escrowBatchPayoutContract
        ).getEscrowBatch(escrowBatchId);
        if (!batch.exists) revert EscrowBatchDoesNotExist();
        if (payoutSummary.path.length <= 1) revert InvalidEscrowSwapIntent();
        if (payoutSummary.path[payoutSummary.path.length - 1] != batch.fundingToken) {
            revert EscrowFundingTokenMismatch();
        }
        if (payoutSummary.amountOut < amount) revert EscrowAmountOutTooLow();

        _fundBatchOutput(payoutSummary, batch.fundingToken, amount, swapDeadline);
        IERC20(batch.fundingToken).safeIncreaseAllowance(
            escrowBatchPayoutContract,
            amount
        );

        IEscrowBatchPayout(escrowBatchPayoutContract).addFundsToEscrowBatch(
            escrowBatchId,
            amount
        );

        IERC20(batch.fundingToken).forceApprove(escrowBatchPayoutContract, 0);
        emit MerkleBatchFunded(
            escrowBatchPayoutContract,
            escrowBatchId,
            amount,
            batch.fundingToken,
            batch.batchHash,
            block.timestamp
        );
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
