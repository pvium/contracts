import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import {
    PaymentEntry,
    generateBatchData,
    getPaymentProof,
} from "../scripts/merkleHelper";

describe("UniversalDexRouter", function () {
    let universalDexRouter: any;
    let mockV2Router: any;
    let mockToken1: any;
    let mockToken2: any;
    let mockWETH: any;
    let owner: any;
    let admin: any;
    let feeReceiver: any;
    let user: any;
    let recipient: any;
    let ADMIN_ROLE: any;
    let DEFAULT_ADMIN_ROLE: any;
    let merkleBatchPayout: any;
    let batchSigner: any;
    let receiver1: any;
    let receiver2: any;

    beforeEach(async function () {
        [owner, admin, feeReceiver, user, recipient, batchSigner, receiver1, receiver2] = await ethers.getSigners();

        // Deploy mock tokens
        const MockToken = await ethers.getContractFactory("MockERC20");
        mockToken1 = await MockToken.deploy("Token1", "TK1", ethers.parseUnits("10000", 18));
        await mockToken1.waitForDeployment();

        mockToken2 = await MockToken.deploy("Token2", "TK2", ethers.parseUnits("10000", 18));
        await mockToken2.waitForDeployment();

        mockWETH = await MockToken.deploy("Wrapped ETH", "WETH", ethers.parseUnits("10000", 18));
        await mockWETH.waitForDeployment();

        // Deploy mock V2 router
        const MockV2Router = await ethers.getContractFactory("MockUniswapV2Router");
        mockV2Router = await MockV2Router.deploy();
        await mockV2Router.waitForDeployment();

        // Deploy MerkleBatchPayout contract first
        const MerkleBatchPayout = await ethers.getContractFactory("MerkleBatchPayout");
        merkleBatchPayout = await MerkleBatchPayout.deploy();
        await merkleBatchPayout.waitForDeployment();

        // Deploy UniversalDexRouter with MerkleBatchPayout address
        const UniversalDexRouter = await ethers.getContractFactory("UniversalDexRouter");
        universalDexRouter = await UniversalDexRouter.deploy(
            await mockV2Router.getAddress(),
            await mockWETH.getAddress(),
            feeReceiver.address,
            owner.address,
            admin.address,
            await merkleBatchPayout.getAddress()
        );
        await universalDexRouter.waitForDeployment();

        // Get role identifiers
        ADMIN_ROLE = await universalDexRouter.ADMIN_ROLE();
        DEFAULT_ADMIN_ROLE = await universalDexRouter.DEFAULT_ADMIN_ROLE();

        // Setup mock router with tokens
        await mockToken1.transfer(await mockV2Router.getAddress(), ethers.parseUnits("1000", 18));
        await mockToken2.transfer(await mockV2Router.getAddress(), ethers.parseUnits("1000", 18));
        await mockWETH.transfer(await mockV2Router.getAddress(), ethers.parseUnits("1000", 18));

        // Transfer tokens to user and approve router
        await mockToken1.transfer(user.address, ethers.parseUnits("1000", 18));
        await mockToken2.transfer(user.address, ethers.parseUnits("1000", 18));
        await mockToken1.connect(user).approve(await universalDexRouter.getAddress(), ethers.MaxUint256);
        await mockToken2.connect(user).approve(await universalDexRouter.getAddress(), ethers.MaxUint256);

        // Add MerkleBatchPayout contract to supported contracts (already set in constructor)
        await universalDexRouter.connect(admin).setSupportedMerkleBatchPayoutContract(
            await merkleBatchPayout.getAddress(),
            true
        );

        // Transfer tokens to batchSigner for batch funding
        await mockToken2.transfer(batchSigner.address, ethers.parseUnits("1000", 18));
        await mockToken2.connect(batchSigner).approve(await universalDexRouter.getAddress(), ethers.MaxUint256);
    });

    describe("Deployment", function () {
        it("Should set the correct router address", async function () {
            expect(await universalDexRouter.router()).to.equal(await mockV2Router.getAddress());
        });

        it("Should set the correct WETH address", async function () {
            expect(await universalDexRouter.WETH()).to.equal(await mockWETH.getAddress());
        });

        it("Should set the correct fee receiver", async function () {
            expect(await universalDexRouter.feeReceiver()).to.equal(feeReceiver.address);
        });

        it("Should set the correct maxFeeBps", async function () {
            expect(await universalDexRouter.maxFeeBps()).to.equal(30);
        });

        it("Should grant roles correctly", async function () {
            expect(await universalDexRouter.hasRole(DEFAULT_ADMIN_ROLE, owner.address)).to.be.true;
            expect(await universalDexRouter.hasRole(ADMIN_ROLE, admin.address)).to.be.true;
        });

        it("Should revert with invalid router address", async function () {
            const UniversalDexRouter = await ethers.getContractFactory("UniversalDexRouter");
            await expect(
                UniversalDexRouter.deploy(
                    ethers.ZeroAddress,
                    await mockWETH.getAddress(),
                    feeReceiver.address,
                    owner.address,
                    admin.address,
                    await merkleBatchPayout.getAddress()
                )
            ).to.be.revertedWith("Invalid router address");
        });

        it("Should revert with invalid WETH address", async function () {
            const UniversalDexRouter = await ethers.getContractFactory("UniversalDexRouter");
            await expect(
                UniversalDexRouter.deploy(
                    await mockV2Router.getAddress(),
                    ethers.ZeroAddress,
                    feeReceiver.address,
                    owner.address,
                    admin.address,
                    await merkleBatchPayout.getAddress()
                )
            ).to.be.revertedWith("Invalid WETH address");
        });

        it("Should revert with invalid fee receiver address", async function () {
            const UniversalDexRouter = await ethers.getContractFactory("UniversalDexRouter");
            await expect(
                UniversalDexRouter.deploy(
                    await mockV2Router.getAddress(),
                    await mockWETH.getAddress(),
                    ethers.ZeroAddress,
                    owner.address,
                    admin.address,
                    await merkleBatchPayout.getAddress()
                )
            ).to.be.revertedWith("Invalid fee receiver address");
        });
    });

    describe("Fee Receiver Management", function () {
        it("Should allow admin to update fee receiver", async function () {
            const newFeeReceiver = user.address;
            await expect(universalDexRouter.connect(admin).setFeeReceiver(newFeeReceiver))
                .to.emit(universalDexRouter, "FeeReceiverUpdated")
                .withArgs(feeReceiver.address, newFeeReceiver);
            expect(await universalDexRouter.feeReceiver()).to.equal(newFeeReceiver);
        });

        it("Should revert if non-admin tries to update fee receiver", async function () {
            await expect(
                universalDexRouter.connect(user).setFeeReceiver(user.address)
            ).to.be.revertedWithCustomError(universalDexRouter, "AccessControlUnauthorizedAccount");
        });

        it("Should revert with invalid fee receiver address", async function () {
            await expect(
                universalDexRouter.connect(admin).setFeeReceiver(ethers.ZeroAddress)
            ).to.be.revertedWith("Invalid fee receiver address");
        });
    });

    describe("V2 Swaps - swapExactTokensForTokens", function () {
        it("Should successfully swap tokens for tokens and emit both events", async function () {
            const amountIn = ethers.parseUnits("100", 18);
            const amountOutMin = ethers.parseUnits("100", 18);
            const paymentAmount = ethers.parseUnits("99.7", 18); // 0.3 fee (0.3% max)
            const deadline = (await time.latest()) + 3600;

            const swapParams = {
                amountIn: amountIn,
                amountOutMin: amountOutMin,
                path: [await mockToken1.getAddress(), await mockToken2.getAddress()],
                to: recipient.address,
                paymentAmount: paymentAmount,
                deadline: deadline,
                memo: "Test swap"
            };

            const recipientBalanceBefore = await mockToken2.balanceOf(recipient.address);
            const feeReceiverBalanceBefore = await mockToken2.balanceOf(feeReceiver.address);
            const userBalanceBefore = await mockToken2.balanceOf(user.address);

            const tx = await universalDexRouter.connect(user).swapExactTokensForTokens(swapParams);

            // Check SwapFee event
            await expect(tx).to.emit(universalDexRouter, "SwapFee");

            // Check SwapExecuted event
            await expect(tx).to.emit(universalDexRouter, "SwapExecuted")
                .withArgs(
                    user.address,
                    recipient.address,
                    await mockToken1.getAddress(),
                    await mockToken2.getAddress(),
                    amountIn,
                    amountIn, // Mock returns 1:1
                    paymentAmount,
                    "Test swap"
                );

            const recipientBalanceAfter = await mockToken2.balanceOf(recipient.address);
            const feeReceiverBalanceAfter = await mockToken2.balanceOf(feeReceiver.address);
            const userBalanceAfter = await mockToken2.balanceOf(user.address);

            // Mock router returns amountIn as output (1:1 ratio = 100)
            // Recipient receives paymentAmount
            expect(recipientBalanceAfter - recipientBalanceBefore).to.equal(paymentAmount);

            // Fee receiver gets the fee
            const expectedFee = amountOutMin - paymentAmount;
            expect(feeReceiverBalanceAfter - feeReceiverBalanceBefore).to.equal(expectedFee);

            // User (sender) gets NO excess since amountIn == amountOutMin
            expect(userBalanceAfter).to.equal(userBalanceBefore);
        });

        it("Should revert if payment amount exceeds minimum output", async function () {
            const amountIn = ethers.parseUnits("10", 18);
            const amountOutMin = ethers.parseUnits("9", 18);
            const paymentAmount = ethers.parseUnits("10", 18);
            const deadline = (await time.latest()) + 3600;

            const swapParams = {
                amountIn: amountIn,
                amountOutMin: amountOutMin,
                path: [await mockToken1.getAddress(), await mockToken2.getAddress()],
                to: recipient.address,
                paymentAmount: paymentAmount,
                deadline: deadline,
                memo: "Test swap"
            };

            await expect(
                universalDexRouter.connect(user).swapExactTokensForTokens(swapParams)
            ).to.be.revertedWith("Payment amount exceeds minimum output");
        });

        it("Should store swap data and update counters correctly", async function () {
            const amountIn = ethers.parseUnits("100", 18);
            const amountOutMin = ethers.parseUnits("100", 18);
            const paymentAmount = ethers.parseUnits("99.7", 18);
            const deadline = (await time.latest()) + 3600;
            const memo = "Test swap memo";

            const swapParams = {
                amountIn: amountIn,
                amountOutMin: amountOutMin,
                path: [await mockToken1.getAddress(), await mockToken2.getAddress()],
                to: recipient.address,
                paymentAmount: paymentAmount,
                deadline: deadline,
                memo: memo
            };

            const swapCountBefore = await universalDexRouter.swapCounts(recipient.address);
            const tokenTotalBefore = await universalDexRouter.swapTotalsToken(await mockToken2.getAddress());
            const recipientTotalBefore = await universalDexRouter.swapTotalsReceipient(recipient.address);

            await universalDexRouter.connect(user).swapExactTokensForTokens(swapParams);

            const lastSwapId = await universalDexRouter.lastSwapId();
            const swapData = await universalDexRouter.swaps(lastSwapId);

            expect(swapData.recipient).to.equal(recipient.address);
            expect(swapData.paymentAmount).to.equal(paymentAmount);
            expect(swapData.memo).to.equal(memo);

            // Check counters
            expect(await universalDexRouter.swapCounts(recipient.address)).to.equal(swapCountBefore + 1n);
            expect(await universalDexRouter.swapTotalsToken(await mockToken2.getAddress())).to.equal(tokenTotalBefore + paymentAmount);
            expect(await universalDexRouter.swapTotalsReceipient(recipient.address)).to.equal(recipientTotalBefore + paymentAmount);
        });
    });

    describe("V2 Swaps - swapExactETHForTokens", function () {
        it("Should successfully swap ETH for tokens and emit both events", async function () {
            const amountIn = ethers.parseEther("1");
            const amountOutMin = amountIn;
            const paymentAmount = ethers.parseUnits("0.997", 18); // 0.003 fee (0.3%)
            const deadline = (await time.latest()) + 3600;

            const swapParams = {
                amountOutMin: amountOutMin,
                path: [await mockWETH.getAddress(), await mockToken1.getAddress()],
                to: recipient.address,
                paymentAmount: paymentAmount,
                deadline: deadline,
                memo: "ETH to Token swap"
            };

            await owner.sendTransaction({
                to: await mockV2Router.getAddress(),
                value: ethers.parseEther("10")
            });

            const recipientBalanceBefore = await mockToken1.balanceOf(recipient.address);
            const feeReceiverBalanceBefore = await mockToken1.balanceOf(feeReceiver.address);

            const tx = await universalDexRouter.connect(user).swapExactETHForTokens(swapParams, { value: amountIn });

            await expect(tx).to.emit(universalDexRouter, "SwapFee");
            await expect(tx).to.emit(universalDexRouter, "SwapExecuted");

            const recipientBalanceAfter = await mockToken1.balanceOf(recipient.address);
            const feeReceiverBalanceAfter = await mockToken1.balanceOf(feeReceiver.address);

            expect(recipientBalanceAfter - recipientBalanceBefore).to.equal(paymentAmount);

            const expectedFee = amountOutMin - paymentAmount;
            expect(feeReceiverBalanceAfter - feeReceiverBalanceBefore).to.equal(expectedFee);
        });

        it("Should revert if path doesn't start with WETH", async function () {
            const amountIn = ethers.parseEther("1");
            const amountOutMin = ethers.parseUnits("900", 18);
            const paymentAmount = ethers.parseUnits("800", 18);
            const deadline = (await time.latest()) + 3600;

            const swapParams = {
                amountOutMin: amountOutMin,
                path: [await mockToken1.getAddress(), await mockToken2.getAddress()],
                to: recipient.address,
                paymentAmount: paymentAmount,
                deadline: deadline,
                memo: "ETH to Token swap"
            };

            await expect(
                universalDexRouter.connect(user).swapExactETHForTokens(swapParams, { value: amountIn })
            ).to.be.revertedWith("Path must start with WETH");
        });
    });

    describe("V2 Swaps - swapTokensForExactTokens", function () {
        it("Should successfully swap tokens for exact tokens and refund unused input", async function () {
            const amountIn = ethers.parseUnits("110", 18); // Max willing to spend
            const amountOutMin = ethers.parseUnits("100", 18); // Exact amount wanted
            const paymentAmount = ethers.parseUnits("99.7", 18);
            const deadline = (await time.latest()) + 3600;

            const swapParams = {
                amountIn: amountIn,
                amountOutMin: amountOutMin,
                path: [await mockToken1.getAddress(), await mockToken2.getAddress()],
                to: recipient.address,
                paymentAmount: paymentAmount,
                deadline: deadline,
                memo: "Exact output swap"
            };

            const userToken1BalanceBefore = await mockToken1.balanceOf(user.address);
            const recipientBalanceBefore = await mockToken2.balanceOf(recipient.address);

            const tx = await universalDexRouter.connect(user).swapTokensForExactTokens(swapParams);

            await expect(tx).to.emit(universalDexRouter, "SwapFee");
            await expect(tx).to.emit(universalDexRouter, "SwapExecuted");

            const userToken1BalanceAfter = await mockToken1.balanceOf(user.address);
            const recipientBalanceAfter = await mockToken2.balanceOf(recipient.address);

            // Recipient gets payment amount
            expect(recipientBalanceAfter - recipientBalanceBefore).to.equal(paymentAmount);

            // User should get refund of unused input tokens
            // Mock uses amountOutMin as actual input needed
            expect(userToken1BalanceBefore - userToken1BalanceAfter).to.equal(amountOutMin);
        });
    });

    describe("V2 Swaps - swapETHForExactTokens", function () {
        it("Should successfully swap ETH for exact tokens and refund unused ETH", async function () {
            const ethSent = ethers.parseEther("1.1"); // Max willing to spend
            const amountOutMin = ethers.parseEther("1"); // Exact amount wanted (1:1 with ETH in mock)
            const paymentAmount = ethers.parseEther("0.997"); // 0.003 fee (0.3%)
            const deadline = (await time.latest()) + 3600;

            const swapParams = {
                amountOutMin: amountOutMin,
                path: [await mockWETH.getAddress(), await mockToken1.getAddress()],
                to: recipient.address,
                paymentAmount: paymentAmount,
                deadline: deadline,
                memo: "ETH for exact tokens"
            };

            await owner.sendTransaction({
                to: await mockV2Router.getAddress(),
                value: ethers.parseEther("10")
            });

            const userEthBalanceBefore = await ethers.provider.getBalance(user.address);
            const recipientBalanceBefore = await mockToken1.balanceOf(recipient.address);

            const tx = await universalDexRouter.connect(user).swapETHForExactTokens(swapParams, { value: ethSent });
            const receipt = await tx.wait();
            const gasUsed = receipt!.gasUsed * (receipt!.gasPrice || 0n);

            await expect(tx).to.emit(universalDexRouter, "SwapFee");
            await expect(tx).to.emit(universalDexRouter, "SwapExecuted");

            const userEthBalanceAfter = await ethers.provider.getBalance(user.address);
            const recipientBalanceAfter = await mockToken1.balanceOf(recipient.address);

            // Recipient gets tokens
            expect(recipientBalanceAfter - recipientBalanceBefore).to.equal(paymentAmount);

            // User should get ETH refund (mock uses amountOutMin as ETH needed)
            const expectedEthUsed = amountOutMin;
            expect(userEthBalanceBefore - userEthBalanceAfter - gasUsed).to.equal(expectedEthUsed);
        });
    });

    describe("V2 Swaps - swapExactTokensForETH", function () {
        it("Should successfully swap tokens for ETH", async function () {
            const amountIn = ethers.parseUnits("1", 18); // 1 token
            const amountOutMin = ethers.parseEther("1"); // Expecting 1 ETH (1:1 mock ratio)
            const paymentAmount = ethers.parseEther("0.997"); // 0.003 fee (0.3%)
            const deadline = (await time.latest()) + 3600;

            const swapParams = {
                amountIn: amountIn,
                amountOutMin: amountOutMin,
                path: [await mockToken1.getAddress(), await mockWETH.getAddress()],
                to: recipient.address,
                paymentAmount: paymentAmount,
                deadline: deadline,
                memo: "Token to ETH swap"
            };

            await owner.sendTransaction({
                to: await mockV2Router.getAddress(),
                value: ethers.parseEther("10")
            });

            const recipientBalanceBefore = await ethers.provider.getBalance(recipient.address);
            const feeReceiverBalanceBefore = await ethers.provider.getBalance(feeReceiver.address);

            await universalDexRouter.connect(user).swapExactTokensForETH(swapParams);

            const recipientBalanceAfter = await ethers.provider.getBalance(recipient.address);
            const feeReceiverBalanceAfter = await ethers.provider.getBalance(feeReceiver.address);

            expect(recipientBalanceAfter - recipientBalanceBefore).to.equal(paymentAmount);

            const expectedFee = amountOutMin - paymentAmount;
            expect(feeReceiverBalanceAfter - feeReceiverBalanceBefore).to.equal(expectedFee);
        });

        it("Should revert if path doesn't end with WETH", async function () {
            const amountIn = ethers.parseUnits("10", 18);
            const amountOutMin = ethers.parseEther("0.9");
            const paymentAmount = ethers.parseEther("0.8");
            const deadline = (await time.latest()) + 3600;

            const swapParams = {
                amountIn: amountIn,
                amountOutMin: amountOutMin,
                path: [await mockToken1.getAddress(), await mockToken2.getAddress()],
                to: recipient.address,
                paymentAmount: paymentAmount,
                deadline: deadline,
                memo: "Token to ETH swap"
            };

            await expect(
                universalDexRouter.connect(user).swapExactTokensForETH(swapParams)
            ).to.be.revertedWith("Path must end with WETH");
        });
    });

    describe("Quote Functions", function () {
        it("Should return quote for exact output on V2", async function () {
            const amountOut = ethers.parseUnits("10", 18);
            const path = [await mockToken1.getAddress(), await mockToken2.getAddress()];

            const amounts = await universalDexRouter.quoteForExactOutputV2(amountOut, path);
            expect(amounts.length).to.be.gt(0);
            expect(amounts[amounts.length - 1]).to.equal(amountOut);
        });

        it("Should return quote for exact input on V2", async function () {
            const amountIn = ethers.parseUnits("10", 18);
            const path = [await mockToken1.getAddress(), await mockToken2.getAddress()];

            const amounts = await universalDexRouter.quoteForExactInputV2(amountIn, path);
            expect(amounts.length).to.be.gt(0);
            expect(amounts[0]).to.equal(amountIn);
        });
    });

    describe("Swap Data Retrieval", function () {
        it("Should retrieve swaps by range", async function () {
            for (let i = 0; i < 3; i++) {
                const swapParams = {
                    amountIn: ethers.parseUnits("100", 18),
                    amountOutMin: ethers.parseUnits("100", 18),
                    path: [await mockToken1.getAddress(), await mockToken2.getAddress()],
                    to: recipient.address,
                    paymentAmount: ethers.parseUnits("99.7", 18),
                    deadline: (await time.latest()) + 3600,
                    memo: `Swap ${i + 1}`
                };
                await universalDexRouter.connect(user).swapExactTokensForTokens(swapParams);
            }

            const swaps = await universalDexRouter.getSwapsByRange(1, 3);
            expect(swaps.length).to.equal(3);
            expect(swaps[0].memo).to.equal("Swap 1");
            expect(swaps[2].memo).to.equal("Swap 3");
        });

        it("Should revert with invalid range", async function () {
            await expect(
                universalDexRouter.getSwapsByRange(5, 3)
            ).to.be.revertedWith("Invalid range");
        });

        it("Should revert if range exceeds last swap ID", async function () {
            await expect(
                universalDexRouter.getSwapsByRange(1, 100)
            ).to.be.revertedWith("Range exceeds last swap ID");
        });
    });

    describe("Emergency Withdrawal", function () {
        it("Should allow default admin to withdraw tokens", async function () {
            const amount = ethers.parseUnits("100", 18);
            await mockToken1.transfer(await universalDexRouter.getAddress(), amount);

            const ownerBalanceBefore = await mockToken1.balanceOf(owner.address);

            await universalDexRouter.connect(owner).emergencyWithdraw(
                await mockToken1.getAddress(),
                owner.address,
                amount
            );

            const ownerBalanceAfter = await mockToken1.balanceOf(owner.address);
            expect(ownerBalanceAfter - ownerBalanceBefore).to.equal(amount);
        });

        it("Should allow default admin to withdraw ETH", async function () {
            const amount = ethers.parseEther("1");
            await owner.sendTransaction({
                to: await universalDexRouter.getAddress(),
                value: amount
            });

            const ownerBalanceBefore = await ethers.provider.getBalance(owner.address);

            const tx = await universalDexRouter.connect(owner).emergencyWithdraw(
                ethers.ZeroAddress,
                owner.address,
                amount
            );
            const receipt = await tx.wait();
            const gasUsed = receipt!.gasUsed * (receipt!.gasPrice || 0n);

            const ownerBalanceAfter = await ethers.provider.getBalance(owner.address);
            expect(ownerBalanceAfter - ownerBalanceBefore + gasUsed).to.equal(amount);
        });

        it("Should revert if non-admin tries to withdraw", async function () {
            await expect(
                universalDexRouter.connect(user).emergencyWithdraw(
                    await mockToken1.getAddress(),
                    user.address,
                    ethers.parseUnits("100", 18)
                )
            ).to.be.revertedWithCustomError(universalDexRouter, "AccessControlUnauthorizedAccount");
        });

        it("Should revert with invalid recipient address", async function () {
            await expect(
                universalDexRouter.connect(owner).emergencyWithdraw(
                    await mockToken1.getAddress(),
                    ethers.ZeroAddress,
                    ethers.parseUnits("100", 18)
                )
            ).to.be.revertedWith("Invalid recipient address");
        });
    });

    describe("Access Control", function () {
        it("Should allow granting and revoking ADMIN_ROLE", async function () {
            await universalDexRouter.connect(owner).grantRole(ADMIN_ROLE, user.address);
            expect(await universalDexRouter.hasRole(ADMIN_ROLE, user.address)).to.be.true;

            await expect(universalDexRouter.connect(user).setFeeReceiver(owner.address))
                .to.emit(universalDexRouter, "FeeReceiverUpdated");

            await universalDexRouter.connect(owner).revokeRole(ADMIN_ROLE, user.address);
            expect(await universalDexRouter.hasRole(ADMIN_ROLE, user.address)).to.be.false;

            await expect(
                universalDexRouter.connect(user).setFeeReceiver(feeReceiver.address)
            ).to.be.revertedWithCustomError(universalDexRouter, "AccessControlUnauthorizedAccount");
        });
    });

    describe("Receive Function", function () {
        it("Should accept ETH", async function () {
            const amount = ethers.parseEther("1");
            await expect(
                owner.sendTransaction({
                    to: await universalDexRouter.getAddress(),
                    value: amount
                })
            ).to.not.be.reverted;

            expect(await ethers.provider.getBalance(await universalDexRouter.getAddress())).to.equal(amount);
        });
    });

    describe("Fee Calculation", function () {
        it("Should calculate fee correctly", async function () {
            const amountIn = ethers.parseUnits("1000", 18);
            const amountOutMin = ethers.parseUnits("1000", 18);
            const paymentAmount = ethers.parseUnits("997", 18); // 3 fee (0.3% fee, exactly at max)
            const deadline = (await time.latest()) + 3600;

            const swapParams = {
                amountIn: amountIn,
                amountOutMin: amountOutMin,
                path: [await mockToken1.getAddress(), await mockToken2.getAddress()],
                to: recipient.address,
                paymentAmount: paymentAmount,
                deadline: deadline,
                memo: "Fee test"
            };

            const feeReceiverBalanceBefore = await mockToken2.balanceOf(feeReceiver.address);

            await universalDexRouter.connect(user).swapExactTokensForTokens(swapParams);

            const feeReceiverBalanceAfter = await mockToken2.balanceOf(feeReceiver.address);
            const feeCollected = feeReceiverBalanceAfter - feeReceiverBalanceBefore;

            expect(feeCollected).to.equal(amountOutMin - paymentAmount);
        });

        it("Should revert if fee exceeds max allowed (0.3%)", async function () {
            const amountIn = ethers.parseUnits("100", 18);
            const amountOutMin = ethers.parseUnits("100", 18);
            const paymentAmount = ethers.parseUnits("96", 18); // 4% fee, exceeds 0.3% max
            const deadline = (await time.latest()) + 3600;

            const swapParams = {
                amountIn: amountIn,
                amountOutMin: amountOutMin,
                path: [await mockToken1.getAddress(), await mockToken2.getAddress()],
                to: recipient.address,
                paymentAmount: paymentAmount,
                deadline: deadline,
                memo: "High fee test"
            };

            await expect(
                universalDexRouter.connect(user).swapExactTokensForTokens(swapParams)
            ).to.be.revertedWith("Fee exceed max allowed");
        });
    });

    describe("Merkle Batch Payout - createMerkleBatch", function () {
        let payments: PaymentEntry[];
        let batchData: any;
        let creatorWithdrawDate: number;
        let signatureTimestamp: number;

        beforeEach(async function () {
            const now = Math.floor(Date.now() / 1000);
            creatorWithdrawDate = now + 86400 * 30; // 30 days from now
            signatureTimestamp = now;

            payments = [
                {
                    receiverAddress: receiver1.address,
                    amount: ethers.parseUnits("100", 18).toString(),
                    claimableDate: now + 60,
                    memo: "Payment to receiver 1"
                },
                {
                    receiverAddress: receiver2.address,
                    amount: ethers.parseUnits("50", 18).toString(),
                    claimableDate: now + 120,
                    memo: "Payment to receiver 2"
                }
            ];

            const chainId = (await ethers.provider.getNetwork()).chainId;
            const totalAmount = ethers.parseUnits("150", 18);
            batchData = await generateBatchData(
                payments,
                "test-batch-" + Date.now(),
                batchSigner,
                await mockToken2.getAddress(),
                totalAmount,
                signatureTimestamp,
                Number(chainId),
                creatorWithdrawDate,
                0
            );
        });

        it("Should successfully create a Merkle batch with swap funding", async function () {
            const totalAmount = ethers.parseUnits("150", 18);
            const swapAmountIn = ethers.parseUnits("160", 18);

            const batchPaySummary = {
                amountIn: swapAmountIn,
                amountOut: totalAmount,
                path: [await mockToken1.getAddress(), await mockToken2.getAddress()]
            };

            await expect(
                universalDexRouter.connect(user).createMerkleBatch(
                    await merkleBatchPayout.getAddress(),
                    batchPaySummary,
                    batchData.batchHash,
                    signatureTimestamp,
                    batchData.signerAddress,
                    batchData.merkleRoot,
                    creatorWithdrawDate,
                    0,
                    ethers.ZeroAddress,
                    batchData.signature,
                    totalAmount,
                    (await time.latest()) + 3600
                )
            ).to.emit(merkleBatchPayout, "BatchCreated");

            const batch = await merkleBatchPayout.getBatch(batchData.batchId);
            expect(batch.exists).to.be.true;
            expect(batch.signer).to.equal(batchData.signerAddress);
            expect(batch.merkleRoot).to.equal(batchData.merkleRoot);
            expect(batch.fundingToken).to.equal(await mockToken2.getAddress());
            expect(batch.totalFunded).to.equal(totalAmount);
            expect(batch.totalClaimed).to.equal(0);
        });

        it("Should revert with invalid Merkle batch payout contract address", async function () {
            const totalAmount = ethers.parseUnits("150", 18);
            const batchPaySummary = {
                amountIn: ethers.parseUnits("160", 18),
                amountOut: totalAmount,
                path: [await mockToken1.getAddress(), await mockToken2.getAddress()]
            };

            await expect(
                universalDexRouter.connect(user).createMerkleBatch(
                    ethers.ZeroAddress,
                    batchPaySummary,
                    batchData.batchHash,
                    signatureTimestamp,
                    batchData.signerAddress,
                    batchData.merkleRoot,
                    creatorWithdrawDate,
                    0,
                    ethers.ZeroAddress,
                    batchData.signature,
                    totalAmount,
                    (await time.latest()) + 3600
                )
            ).to.be.revertedWith("Invalid Merkle batch payout contract");
        });

        it("Should revert with unsupported Merkle batch payout contract", async function () {
            const totalAmount = ethers.parseUnits("150", 18);
            const batchPaySummary = {
                amountIn: ethers.parseUnits("160", 18),
                amountOut: totalAmount,
                path: [await mockToken1.getAddress(), await mockToken2.getAddress()]
            };

            // Remove support for the contract
            await universalDexRouter.connect(admin).setSupportedMerkleBatchPayoutContract(
                await merkleBatchPayout.getAddress(),
                false
            );

            await expect(
                universalDexRouter.connect(user).createMerkleBatch(
                    await merkleBatchPayout.getAddress(),
                    batchPaySummary,
                    batchData.batchHash,
                    signatureTimestamp,
                    batchData.signerAddress,
                    batchData.merkleRoot,
                    creatorWithdrawDate,
                    0,
                    ethers.ZeroAddress,
                    batchData.signature,
                    totalAmount,
                    (await time.latest()) + 3600
                )
            ).to.be.revertedWith("Unsupported Merkle batch payout contract");

            // Re-enable for other tests
            await universalDexRouter.connect(admin).setSupportedMerkleBatchPayoutContract(
                await merkleBatchPayout.getAddress(),
                true
            );
        });

        it("Should revert with invalid signer address", async function () {
            const totalAmount = ethers.parseUnits("150", 18);
            const batchPaySummary = {
                amountIn: ethers.parseUnits("160", 18),
                amountOut: totalAmount,
                path: [await mockToken1.getAddress(), await mockToken2.getAddress()]
            };

            await expect(
                universalDexRouter.connect(user).createMerkleBatch(
                    await merkleBatchPayout.getAddress(),
                    batchPaySummary,
                    batchData.batchHash,
                    signatureTimestamp,
                    ethers.ZeroAddress,
                    batchData.merkleRoot,
                    creatorWithdrawDate,
                    0,
                    ethers.ZeroAddress,
                    batchData.signature,
                    totalAmount,
                    (await time.latest()) + 3600
                )
            ).to.be.revertedWith("Invalid signer");
        });

        it("Should revert with invalid merkle root", async function () {
            const totalAmount = ethers.parseUnits("150", 18);
            const batchPaySummary = {
                amountIn: ethers.parseUnits("160", 18),
                amountOut: totalAmount,
                path: [await mockToken1.getAddress(), await mockToken2.getAddress()]
            };

            await expect(
                universalDexRouter.connect(user).createMerkleBatch(
                    await merkleBatchPayout.getAddress(),
                    batchPaySummary,
                    batchData.batchHash,
                    signatureTimestamp,
                    batchData.signerAddress,
                    ethers.ZeroHash,
                    creatorWithdrawDate,
                    0,
                    ethers.ZeroAddress,
                    batchData.signature,
                    totalAmount,
                    (await time.latest()) + 3600
                )
            ).to.be.revertedWith("Invalid merkle root");
        });

        it("Should revert with invalid funding token address", async function () {
            const totalAmount = ethers.parseUnits("150", 18);
            const batchPaySummary = {
                amountIn: ethers.parseUnits("160", 18),
                amountOut: totalAmount,
                path: [await mockToken1.getAddress(), ethers.ZeroAddress] // Last element in path is funding token
            };

            await expect(
                universalDexRouter.connect(user).createMerkleBatch(
                    await merkleBatchPayout.getAddress(),
                    batchPaySummary,
                    batchData.batchHash,
                    signatureTimestamp,
                    batchData.signerAddress,
                    batchData.merkleRoot,
                    creatorWithdrawDate,
                    0,
                    ethers.ZeroAddress,
                    batchData.signature,
                    totalAmount,
                    (await time.latest()) + 3600
                )
            ).to.be.revertedWith("Invalid funding token");
        });

        it("Should handle same input and output token without swap (direct transfer)", async function () {
            const totalAmount = ethers.parseUnits("150", 18);

            // Path with same token at start and end - should skip swap and do direct transfer
            const batchPaySummary = {
                amountIn: totalAmount,
                amountOut: totalAmount,
                path: [await mockToken2.getAddress(), await mockToken2.getAddress()]
            };

            await expect(
                universalDexRouter.connect(user).createMerkleBatch(
                    await merkleBatchPayout.getAddress(),
                    batchPaySummary,
                    batchData.batchHash,
                    signatureTimestamp,
                    batchData.signerAddress,
                    batchData.merkleRoot,
                    creatorWithdrawDate,
                    0,
                    ethers.ZeroAddress,
                    batchData.signature,
                    totalAmount,
                    (await time.latest()) + 3600
                )
            ).to.emit(merkleBatchPayout, "BatchCreated");

            const batch = await merkleBatchPayout.getBatch(batchData.batchId);
            expect(batch.exists).to.be.true;
            expect(batch.signer).to.equal(batchData.signerAddress);
            expect(batch.fundingToken).to.equal(await mockToken2.getAddress());
            expect(batch.totalFunded).to.equal(totalAmount);
            expect(batch.totalClaimed).to.equal(0);
        });

        // Note: This test is commented out because the function signature was changed
        // to accept a single BatchPaySummary instead of an array
        // it("Should handle multiple swaps to fund batch", async function () {
        //     const totalAmount = ethers.parseUnits("150", 18);

        //     const batchPaySummary = [
        //         {
        //             amountIn: ethers.parseUnits("100", 18),
        //             amountOut: ethers.parseUnits("100", 18),
        //             path: [await mockToken1.getAddress(), await mockToken2.getAddress()]
        //         },
        //         {
        //             amountIn: ethers.parseUnits("50", 18),
        //             amountOut: ethers.parseUnits("50", 18),
        //             path: [await mockToken1.getAddress(), await mockToken2.getAddress()]
        //         }
        //     ];

        //     await expect(
        //         universalDexRouter.connect(user).createMerkleBatch(
        //             await merkleBatchPayout.getAddress(),
        //             batchPaySummary,
        //             batchData.batchHash,
        //             signatureTimestamp,
        //             batchData.signerAddress,
        //             batchData.merkleRoot,
        //             creatorWithdrawDate,
        //             await mockToken2.getAddress(),
        //             batchData.signature,
        //             totalAmount,
        //             (await time.latest()) + 3600
        //         )
        //     ).to.emit(merkleBatchPayout, "BatchCreated");

        //     const batch = await merkleBatchPayout.getBatch(batchData.batchId);
        //     expect(batch.totalFunded).to.equal(totalAmount);
        // });
    });

    describe("Merkle Batch Payout - claimMerkleBatchPayment", function () {
        let payments: PaymentEntry[];
        let batchData: any;
        let creatorWithdrawDate: number;
        let proof1: string[];
        let proof2: string[];
        let signatureTimestamp: number;

        beforeEach(async function () {
            const now = Math.floor(Date.now() / 1000);
            creatorWithdrawDate = now + 86400 * 30;
            signatureTimestamp = now;

            payments = [
                {
                    receiverAddress: receiver1.address,
                    amount: ethers.parseUnits("100", 18).toString(),
                    claimableDate: now + 10, // Claimable soon
                    memo: "Payment to receiver 1"
                },
                {
                    receiverAddress: receiver2.address,
                    amount: ethers.parseUnits("50", 18).toString(),
                    claimableDate: now + 10,
                    memo: "Payment to receiver 2"
                }
            ];

            const chainId = (await ethers.provider.getNetwork()).chainId;
            const totalAmount = ethers.parseUnits("150", 18);
            batchData = await generateBatchData(
                payments,
                "claim-test-" + Date.now(),
                batchSigner,
                await mockToken2.getAddress(),
                totalAmount,
                signatureTimestamp,
                Number(chainId),
                creatorWithdrawDate,
                0
            );

            // Create the batch first
            const batchPaySummary = {
                amountIn: ethers.parseUnits("160", 18),
                amountOut: totalAmount,
                path: [await mockToken1.getAddress(), await mockToken2.getAddress()]
            };

            await universalDexRouter.connect(user).createMerkleBatch(
                await merkleBatchPayout.getAddress(),
                batchPaySummary,
                batchData.batchHash,
                signatureTimestamp,
                batchData.signerAddress,
                batchData.merkleRoot,
                creatorWithdrawDate,
                0,
                ethers.ZeroAddress,
                batchData.signature,
                totalAmount,
                    (await time.latest()) + 3600
            );

            // Generate proofs
            proof1 = getPaymentProof(batchData.tree, batchData.batchId, payments[0]);
            proof2 = getPaymentProof(batchData.tree, batchData.batchId, payments[1]);

            // Wait for claimable date
            await time.increase(15);
        });

        it("Should successfully claim a payment from Merkle batch", async function () {
            const receiver1BalanceBefore = await mockToken2.balanceOf(receiver1.address);

            await expect(
                universalDexRouter.connect(receiver1).claimMerkleBatchPayment(
                    await merkleBatchPayout.getAddress(),
                    batchData.batchId,
                    payments[0].receiverAddress,
                    payments[0].amount,
                    payments[0].claimableDate,
                    payments[0].memo,
                    proof1
                )
            ).to.emit(merkleBatchPayout, "PaymentClaimed")
                .withArgs(
                    batchData.batchId,
                    receiver1.address,
                    payments[0].amount,
                    await mockToken2.getAddress(),
                    payments[0].memo
                );

            const receiver1BalanceAfter = await mockToken2.balanceOf(receiver1.address);
            expect(receiver1BalanceAfter - receiver1BalanceBefore).to.equal(payments[0].amount);

            // Check batch state
            const batch = await merkleBatchPayout.getBatch(batchData.batchId);
            expect(batch.totalClaimed).to.equal(payments[0].amount);
        });

        it("Should allow multiple different receivers to claim", async function () {
            // Receiver 1 claims
            await universalDexRouter.connect(receiver1).claimMerkleBatchPayment(
                await merkleBatchPayout.getAddress(),
                batchData.batchId,
                payments[0].receiverAddress,
                payments[0].amount,
                payments[0].claimableDate,
                payments[0].memo,
                proof1
            );

            // Receiver 2 claims
            const receiver2BalanceBefore = await mockToken2.balanceOf(receiver2.address);

            await expect(
                universalDexRouter.connect(receiver2).claimMerkleBatchPayment(
                    await merkleBatchPayout.getAddress(),
                    batchData.batchId,
                    payments[1].receiverAddress,
                    payments[1].amount,
                    payments[1].claimableDate,
                    payments[1].memo,
                    proof2
                )
            ).to.emit(merkleBatchPayout, "PaymentClaimed");

            const receiver2BalanceAfter = await mockToken2.balanceOf(receiver2.address);
            expect(receiver2BalanceAfter - receiver2BalanceBefore).to.equal(payments[1].amount);

            // Check total claimed
            const batch = await merkleBatchPayout.getBatch(batchData.batchId);
            expect(batch.totalClaimed).to.equal(
                BigInt(payments[0].amount) + BigInt(payments[1].amount)
            );
        });

        it("Should revert when claiming twice", async function () {
            // First claim succeeds
            await universalDexRouter.connect(receiver1).claimMerkleBatchPayment(
                await merkleBatchPayout.getAddress(),
                batchData.batchId,
                payments[0].receiverAddress,
                payments[0].amount,
                payments[0].claimableDate,
                payments[0].memo,
                proof1
            );

            // Second claim fails
            await expect(
                universalDexRouter.connect(receiver1).claimMerkleBatchPayment(
                    await merkleBatchPayout.getAddress(),
                    batchData.batchId,
                    payments[0].receiverAddress,
                    payments[0].amount,
                    payments[0].claimableDate,
                    payments[0].memo,
                    proof1
                )
            ).to.be.revertedWith("Payment already claimed");
        });

        it("Should revert with invalid Merkle batch payout contract", async function () {
            await expect(
                universalDexRouter.connect(receiver1).claimMerkleBatchPayment(
                    ethers.ZeroAddress,
                    batchData.batchId,
                    payments[0].receiverAddress,
                    payments[0].amount,
                    payments[0].claimableDate,
                    payments[0].memo,
                    proof1
                )
            ).to.be.revertedWith("Invalid Merkle batch payout contract");
        });

        it("Should revert with unsupported Merkle batch payout contract", async function () {
            await universalDexRouter.connect(admin).setSupportedMerkleBatchPayoutContract(
                await merkleBatchPayout.getAddress(),
                false
            );

            await expect(
                universalDexRouter.connect(receiver1).claimMerkleBatchPayment(
                    await merkleBatchPayout.getAddress(),
                    batchData.batchId,
                    payments[0].receiverAddress,
                    payments[0].amount,
                    payments[0].claimableDate,
                    payments[0].memo,
                    proof1
                )
            ).to.be.revertedWith("Unsupported Merkle batch payout contract");

            await universalDexRouter.connect(admin).setSupportedMerkleBatchPayoutContract(
                await merkleBatchPayout.getAddress(),
                true
            );
        });

        it("Should revert with non-existent batch", async function () {
            const fakeBatchId = ethers.keccak256(ethers.toUtf8Bytes("fake-batch"));

            await expect(
                universalDexRouter.connect(receiver1).claimMerkleBatchPayment(
                    await merkleBatchPayout.getAddress(),
                    fakeBatchId,
                    payments[0].receiverAddress,
                    payments[0].amount,
                    payments[0].claimableDate,
                    payments[0].memo,
                    proof1
                )
            ).to.be.revertedWith("Batch does not exist");
        });
    });

    describe("Merkle Batch Payout - addFundsToMerkleBatch", function () {
        let payments: PaymentEntry[];
        let batchData: any;
        let creatorWithdrawDate: number;
        let signatureTimestamp: number;

        beforeEach(async function () {
            const now = Math.floor(Date.now() / 1000);
            creatorWithdrawDate = now + 86400 * 30;
            signatureTimestamp = now;

            payments = [
                {
                    receiverAddress: receiver1.address,
                    amount: ethers.parseUnits("100", 18).toString(),
                    claimableDate: now + 10,
                    memo: "Payment to receiver 1"
                }
            ];

            const chainId = (await ethers.provider.getNetwork()).chainId;
            const totalAmount = ethers.parseUnits("100", 18);
            batchData = await generateBatchData(
                payments,
                "add-funds-test-" + Date.now(),
                batchSigner,
                await mockToken2.getAddress(),
                totalAmount,
                signatureTimestamp,
                Number(chainId),
                creatorWithdrawDate,
                0
            );

            // Create the batch
            const batchPaySummary = {
                amountIn: ethers.parseUnits("105", 18),
                amountOut: totalAmount,
                path: [await mockToken1.getAddress(), await mockToken2.getAddress()]
            };

            await universalDexRouter.connect(user).createMerkleBatch(
                await merkleBatchPayout.getAddress(),
                batchPaySummary,
                batchData.batchHash,
                signatureTimestamp,
                batchData.signerAddress,
                batchData.merkleRoot,
                creatorWithdrawDate,
                0,
                ethers.ZeroAddress,
                batchData.signature,
                totalAmount,
                    (await time.latest()) + 3600
            );
        });

        it("Should successfully add funds to an existing Merkle batch", async function () {
            const additionalAmount = ethers.parseUnits("50", 18);

            const batchBefore = await merkleBatchPayout.getBatch(batchData.batchId);
            const totalFundedBefore = batchBefore.totalFunded;

            await expect(
                universalDexRouter.connect(batchSigner).addFundsToMerkleBatch(
                    await merkleBatchPayout.getAddress(),
                    batchData.batchId,
                    additionalAmount
                )
            ).to.emit(merkleBatchPayout, "BatchFunded")
                .withArgs(
                    batchData.batchId,
                    await mockToken2.getAddress(),
                    additionalAmount
                );

            const batchAfter = await merkleBatchPayout.getBatch(batchData.batchId);
            expect(batchAfter.totalFunded).to.equal(totalFundedBefore + additionalAmount);
        });

        it("Should allow anyone to add funds to a batch", async function () {
            const additionalAmount = ethers.parseUnits("25", 18);

            // Transfer tokens to user first
            await mockToken2.transfer(user.address, additionalAmount);
            await mockToken2.connect(user).approve(
                await universalDexRouter.getAddress(),
                additionalAmount
            );

            const batchBefore = await merkleBatchPayout.getBatch(batchData.batchId);
            const totalFundedBefore = batchBefore.totalFunded;

            await universalDexRouter.connect(user).addFundsToMerkleBatch(
                await merkleBatchPayout.getAddress(),
                batchData.batchId,
                additionalAmount
            );

            const batchAfter = await merkleBatchPayout.getBatch(batchData.batchId);
            expect(batchAfter.totalFunded).to.equal(totalFundedBefore + additionalAmount);
        });

        it("Should revert with invalid Merkle batch payout contract", async function () {
            await expect(
                universalDexRouter.connect(batchSigner).addFundsToMerkleBatch(
                    ethers.ZeroAddress,
                    batchData.batchId,
                    ethers.parseUnits("50", 18)
                )
            ).to.be.revertedWith("Invalid Merkle batch payout contract");
        });

        it("Should revert with unsupported Merkle batch payout contract", async function () {
            await universalDexRouter.connect(admin).setSupportedMerkleBatchPayoutContract(
                await merkleBatchPayout.getAddress(),
                false
            );

            await expect(
                universalDexRouter.connect(batchSigner).addFundsToMerkleBatch(
                    await merkleBatchPayout.getAddress(),
                    batchData.batchId,
                    ethers.parseUnits("50", 18)
                )
            ).to.be.revertedWith("Unsupported Merkle batch payout contract");

            await universalDexRouter.connect(admin).setSupportedMerkleBatchPayoutContract(
                await merkleBatchPayout.getAddress(),
                true
            );
        });

        it("Should revert with zero amount", async function () {
            await expect(
                universalDexRouter.connect(batchSigner).addFundsToMerkleBatch(
                    await merkleBatchPayout.getAddress(),
                    batchData.batchId,
                    0
                )
            ).to.be.revertedWith("Amount must be greater than 0");
        });

        it("Should revert with non-existent batch", async function () {
            const fakeBatchId = ethers.keccak256(ethers.toUtf8Bytes("fake-batch"));

            await expect(
                universalDexRouter.connect(batchSigner).addFundsToMerkleBatch(
                    await merkleBatchPayout.getAddress(),
                    fakeBatchId,
                    ethers.parseUnits("50", 18)
                )
            ).to.be.revertedWith("Batch does not exist");
        });

        it("Should correctly handle adding funds after partial claims", async function () {
            // Wait for claimable date
            await time.increase(15);

            // Claim part of the batch
            const proof = getPaymentProof(batchData.tree, batchData.batchId, payments[0]);
            await universalDexRouter.connect(receiver1).claimMerkleBatchPayment(
                await merkleBatchPayout.getAddress(),
                batchData.batchId,
                payments[0].receiverAddress,
                payments[0].amount,
                payments[0].claimableDate,
                payments[0].memo,
                proof
            );

            const batchBeforeFunding = await merkleBatchPayout.getBatch(batchData.batchId);
            expect(batchBeforeFunding.totalClaimed).to.equal(payments[0].amount);

            // Add more funds
            const additionalAmount = ethers.parseUnits("100", 18);
            await universalDexRouter.connect(batchSigner).addFundsToMerkleBatch(
                await merkleBatchPayout.getAddress(),
                batchData.batchId,
                additionalAmount
            );

            const batchAfterFunding = await merkleBatchPayout.getBatch(batchData.batchId);
            expect(batchAfterFunding.totalFunded).to.equal(
                batchBeforeFunding.totalFunded + additionalAmount
            );
            expect(batchAfterFunding.totalClaimed).to.equal(payments[0].amount);
        });
    });

    describe("Merkle Batch Payout Support Management", function () {
        it("Should allow admin to add Merkle batch payout support", async function () {
            const newContract = user.address; // Using user address as dummy contract

            await expect(
                universalDexRouter.connect(admin).setSupportedMerkleBatchPayoutContract(
                    newContract,
                    true
                )
            ).to.emit(universalDexRouter, "MerkleBatchPayoutContractUpdated")
                .withArgs(newContract, true);

            expect(
                await universalDexRouter.supportMerkleBatchPayoutContracts(newContract)
            ).to.be.true;
        });

        it("Should allow admin to remove Merkle batch payout support", async function () {
            await expect(
                universalDexRouter.connect(admin).setSupportedMerkleBatchPayoutContract(
                    await merkleBatchPayout.getAddress(),
                    false
                )
            ).to.emit(universalDexRouter, "MerkleBatchPayoutContractUpdated")
                .withArgs(await merkleBatchPayout.getAddress(), false);

            expect(
                await universalDexRouter.supportMerkleBatchPayoutContracts(
                    await merkleBatchPayout.getAddress()
                )
            ).to.be.false;

            // Re-enable for other tests
            await universalDexRouter.connect(admin).setSupportedMerkleBatchPayoutContract(
                await merkleBatchPayout.getAddress(),
                true
            );
        });

        it("Should revert if non-admin tries to add support", async function () {
            await expect(
                universalDexRouter.connect(user).setSupportedMerkleBatchPayoutContract(
                    user.address,
                    true
                )
            ).to.be.revertedWithCustomError(universalDexRouter, "AccessControlUnauthorizedAccount");
        });

        it("Should revert with invalid contract address", async function () {
            await expect(
                universalDexRouter.connect(admin).setSupportedMerkleBatchPayoutContract(
                    ethers.ZeroAddress,
                    true
                )
            ).to.be.revertedWith("Invalid Merkle batch payout contract");
        });
    });

});
