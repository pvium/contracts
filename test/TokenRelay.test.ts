import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";

describe("TokenRelay", function () {
    let tokenRelay;
    let mockToken;
    let owner;
    let admin;
    let dao;
    let user;
    let relayer;
    let receiver;
    let domain;
    let types;
    let ADMIN_ROLE;
    let DAO_ROLE;

    const FEE_PERCENTAGE = 100; // 1%
    const MAX_FEE_PERCENTAGE = 1000; // 10%
    const MINIMUM_AMOUNT = ethers.parseUnits("1", 18);

    beforeEach(async function () {
        [owner, admin, dao, user, relayer, receiver] = await ethers.getSigners();

        // Deploy a mock ERC20 token
        const MockToken = await ethers.getContractFactory("MockERC20");
        mockToken = await MockToken.deploy("Mock Token", "MTK", ethers.parseUnits("10000", 18));
        await mockToken.waitForDeployment();

        // Deploy TokenRelay
        const TokenRelay = await ethers.getContractFactory("TokenRelay");
        tokenRelay = await TokenRelay.deploy(
            FEE_PERCENTAGE,
            MAX_FEE_PERCENTAGE,
            MINIMUM_AMOUNT,
            "TokenRelay",  // EIP-712 name
            "1"            // EIP-712 version
        );
        await tokenRelay.waitForDeployment();

        // Get role identifiers
        ADMIN_ROLE = await tokenRelay.ADMIN_ROLE();
        DAO_ROLE = await tokenRelay.DAO_ROLE();

        // Setup EIP-712 domain and types
        domain = {
            name: "TokenRelay",
            version: "1",
            chainId: (await ethers.provider.getNetwork()).chainId,
            verifyingContract: await tokenRelay.getAddress(),
        };

        types = {
            TransferRequest: [
                { name: "token", type: "address" },
                { name: "amount", type: "uint256" },
                { name: "receiver", type: "address" },
                { name: "maxFee", type: "uint256" },
                { name: "signer", type: "address" },
                { name: "nonce", type: "uint256" },
                { name: "deadline", type: "uint256" },
            ],
        };

        // Add mock token to supported tokens
        await tokenRelay.connect(owner).addSupportedToken(await mockToken.getAddress());

        // Transfer tokens to user and approve relay contract
        await mockToken.transfer(user.address, ethers.parseUnits("1000", 18));
        await mockToken.connect(user).approve(await tokenRelay.getAddress(), ethers.MaxUint256);
    });

    describe("Deployment", function () {
        it("Should set the correct fee percentage", async function () {
            expect(await tokenRelay.feePercentage()).to.equal(FEE_PERCENTAGE);
        });

        it("Should set the correct max fee percentage", async function () {
            expect(await tokenRelay.maxFeePercentage()).to.equal(MAX_FEE_PERCENTAGE);
        });

        it("Should set the correct minimum amount", async function () {
            expect(await tokenRelay.minimumAmount()).to.equal(MINIMUM_AMOUNT);
        });

        it("Should grant roles to deployer", async function () {
            const DEFAULT_ADMIN_ROLE = await tokenRelay.DEFAULT_ADMIN_ROLE();
            expect(await tokenRelay.hasRole(DEFAULT_ADMIN_ROLE, owner.address)).to.be.true;
            expect(await tokenRelay.hasRole(ADMIN_ROLE, owner.address)).to.be.true;
            expect(await tokenRelay.hasRole(DAO_ROLE, owner.address)).to.be.true;
        });
    });

    describe("Supported Tokens", function () {
        it("Should add a supported token", async function () {
            const newToken = await (await ethers.getContractFactory("MockERC20")).deploy("New", "NEW", 1000);
            await expect(tokenRelay.connect(owner).addSupportedToken(await newToken.getAddress()))
                .to.emit(tokenRelay, "TokenAdded")
                .withArgs(await newToken.getAddress());
            expect(await tokenRelay.isTokenSupported(await newToken.getAddress())).to.be.true;
        });

        it("Should remove a supported token", async function () {
            await expect(tokenRelay.connect(owner).removeSupportedToken(await mockToken.getAddress()))
                .to.emit(tokenRelay, "TokenRemoved")
                .withArgs(await mockToken.getAddress());
            expect(await tokenRelay.isTokenSupported(await mockToken.getAddress())).to.be.false;
        });

        it("Should revert if non-admin tries to add token", async function () {
            const newToken = await (await ethers.getContractFactory("MockERC20")).deploy("New", "NEW", 1000);
            await expect(
                tokenRelay.connect(user).addSupportedToken(await newToken.getAddress())
            ).to.be.revertedWithCustomError(tokenRelay, "AccessControlUnauthorizedAccount");
        });
    });

    describe("Fee and Minimum Amount Management", function () {
        it("Should update fee percentage", async function () {
            const newFee = 200; // 2%
            await expect(tokenRelay.connect(owner).setFeePercentage(newFee))
                .to.emit(tokenRelay, "FeePercentageUpdated")
                .withArgs(FEE_PERCENTAGE, newFee);
            expect(await tokenRelay.feePercentage()).to.equal(newFee);
        });

        it("Should revert if fee percentage exceeds max", async function () {
            await expect(
                tokenRelay.connect(owner).setFeePercentage(1001) // > maxFeePercentage
            ).to.be.revertedWithCustomError(tokenRelay, "FeeExceedsMaxAllowed");
        });

        it("Should revert if non-admin tries to set fee", async function () {
            await expect(
                tokenRelay.connect(user).setFeePercentage(200)
            ).to.be.revertedWithCustomError(tokenRelay, "AccessControlUnauthorizedAccount");
        });

        it("Should update minimum amount", async function () {
            const newMinimum = ethers.parseUnits("5", 18);
            await expect(tokenRelay.connect(owner).setMinimumAmount(newMinimum))
                .to.emit(tokenRelay, "MinimumAmountUpdated")
                .withArgs(MINIMUM_AMOUNT, newMinimum);
            expect(await tokenRelay.minimumAmount()).to.equal(newMinimum);
        });

        it("Should revert if non-admin tries to set minimum amount", async function () {
            await expect(
                tokenRelay.connect(user).setMinimumAmount(ethers.parseUnits("5", 18))
            ).to.be.revertedWithCustomError(tokenRelay, "AccessControlUnauthorizedAccount");
        });
    });

    describe("DAO Role - Max Fee Management", function () {
        it("Should update max fee percentage", async function () {
            const newMaxFee = 500; // 5%
            await expect(tokenRelay.connect(owner).setMaxFeePercentage(newMaxFee))
                .to.emit(tokenRelay, "MaxFeePercentageUpdated")
                .withArgs(MAX_FEE_PERCENTAGE, newMaxFee);
            expect(await tokenRelay.maxFeePercentage()).to.equal(newMaxFee);
        });

        it("Should adjust current fee if it exceeds new max", async function () {
            // Set fee to 800 (8%)
            await tokenRelay.connect(owner).setFeePercentage(800);

            // Set max fee to 500 (5%) - should also adjust current fee
            await tokenRelay.connect(owner).setMaxFeePercentage(500);

            expect(await tokenRelay.maxFeePercentage()).to.equal(500);
            expect(await tokenRelay.feePercentage()).to.equal(500); // Auto-adjusted
        });

        it("Should revert if non-DAO tries to set max fee", async function () {
            await expect(
                tokenRelay.connect(user).setMaxFeePercentage(500)
            ).to.be.revertedWithCustomError(tokenRelay, "AccessControlUnauthorizedAccount");
        });

        it("Should allow setting fee below new max without adjustment", async function () {
            // Set fee to 200 (2%)
            await tokenRelay.connect(owner).setFeePercentage(200);

            // Set max fee to 500 (5%)
            await tokenRelay.connect(owner).setMaxFeePercentage(500);

            expect(await tokenRelay.maxFeePercentage()).to.equal(500);
            expect(await tokenRelay.feePercentage()).to.equal(200); // Not adjusted
        });
    });

    describe("Role Management", function () {
        it("Should allow granting ADMIN_ROLE to another account", async function () {
            await tokenRelay.connect(owner).grantRole(ADMIN_ROLE, admin.address);
            expect(await tokenRelay.hasRole(ADMIN_ROLE, admin.address)).to.be.true;

            // Admin should be able to add tokens
            const newToken = await (await ethers.getContractFactory("MockERC20")).deploy("Test", "TST", 1000);
            await expect(tokenRelay.connect(admin).addSupportedToken(await newToken.getAddress()))
                .to.emit(tokenRelay, "TokenAdded");
        });

        it("Should allow granting DAO_ROLE to another account", async function () {
            await tokenRelay.connect(owner).grantRole(DAO_ROLE, dao.address);
            expect(await tokenRelay.hasRole(DAO_ROLE, dao.address)).to.be.true;

            // DAO should be able to set max fee
            await expect(tokenRelay.connect(dao).setMaxFeePercentage(500))
                .to.emit(tokenRelay, "MaxFeePercentageUpdated");
        });

        it("Should allow revoking ADMIN_ROLE", async function () {
            await tokenRelay.connect(owner).grantRole(ADMIN_ROLE, admin.address);
            await tokenRelay.connect(owner).revokeRole(ADMIN_ROLE, admin.address);
            expect(await tokenRelay.hasRole(ADMIN_ROLE, admin.address)).to.be.false;

            // Admin should no longer be able to add tokens
            const newToken = await (await ethers.getContractFactory("MockERC20")).deploy("Test", "TST", 1000);
            await expect(
                tokenRelay.connect(admin).addSupportedToken(await newToken.getAddress())
            ).to.be.revertedWithCustomError(tokenRelay, "AccessControlUnauthorizedAccount");
        });
    });

    describe("Relay Transfer", function () {
        it("Should successfully relay a transfer", async function () {
            const amount = ethers.parseUnits("100", 18);
            const maxFee = ethers.parseUnits("2", 18);
            const nonce = await tokenRelay.getNonce(user.address);
            const deadline = (await time.latest()) + 3600;

            const transferRequest = {
                token: await mockToken.getAddress(),
                amount: amount,
                receiver: receiver.address,
                maxFee: maxFee,
                signer: user.address,
                nonce: nonce,
                deadline: deadline,
            };

            const signature = await user.signTypedData(domain, types, transferRequest);

            const expectedFee = (amount * BigInt(FEE_PERCENTAGE)) / 10000n;
            const expectedAmount = amount - expectedFee;

            await expect(
                tokenRelay.connect(relayer).relayTransfer({
                    token: transferRequest.token,
                    amount: transferRequest.amount,
                    receiver: transferRequest.receiver,
                    maxFee: transferRequest.maxFee,
                    signer: transferRequest.signer,
                    deadline: transferRequest.deadline,
                    signature: signature
                })
            )
                .to.emit(tokenRelay, "TokenTransferred")
                .withArgs(
                    await mockToken.getAddress(),
                    user.address,
                    receiver.address,
                    expectedAmount,
                    expectedFee,
                    nonce
                );

            // Check balances
            expect(await mockToken.balanceOf(receiver.address)).to.equal(expectedAmount);
            expect(await mockToken.balanceOf(relayer.address)).to.equal(expectedFee);

            // Check nonce incremented
            expect(await tokenRelay.getNonce(user.address)).to.equal(nonce + 1n);
        });

        it("Should revert if token is not supported", async function () {
            const unsupportedToken = await (await ethers.getContractFactory("MockERC20")).deploy("BAD", "BAD", 1000);
            const amount = ethers.parseUnits("100", 18);
            const nonce = await tokenRelay.getNonce(user.address);
            const deadline = (await time.latest()) + 3600;

            const transferRequest = {
                token: await unsupportedToken.getAddress(),
                amount: amount,
                receiver: receiver.address,
                maxFee: ethers.parseUnits("2", 18),
                signer: user.address,
                nonce: nonce,
                deadline: deadline,
            };

            const signature = await user.signTypedData(domain, types, transferRequest);

            await expect(
                tokenRelay.connect(relayer).relayTransfer({
                    token: transferRequest.token,
                    amount: transferRequest.amount,
                    receiver: transferRequest.receiver,
                    maxFee: transferRequest.maxFee,
                    signer: transferRequest.signer,
                    deadline: transferRequest.deadline,
                    signature: signature
                })
            ).to.be.revertedWithCustomError(tokenRelay, "UnsupportedToken");
        });

        it("Should revert if deadline has passed", async function () {
            const amount = ethers.parseUnits("100", 18);
            const nonce = await tokenRelay.getNonce(user.address);
            const deadline = (await time.latest()) - 1; // Past deadline

            const transferRequest = {
                token: await mockToken.getAddress(),
                amount: amount,
                receiver: receiver.address,
                maxFee: ethers.parseUnits("2", 18),
                signer: user.address,
                nonce: nonce,
                deadline: deadline,
            };

            const signature = await user.signTypedData(domain, types, transferRequest);

            await expect(
                tokenRelay.connect(relayer).relayTransfer({
                    token: transferRequest.token,
                    amount: transferRequest.amount,
                    receiver: transferRequest.receiver,
                    maxFee: transferRequest.maxFee,
                    signer: transferRequest.signer,
                    deadline: transferRequest.deadline,
                    signature: signature
                })
            ).to.be.revertedWithCustomError(tokenRelay, "DeadlineExpired");
        });

        it("Should revert if nonce is incorrect", async function () {
            const amount = ethers.parseUnits("100", 18);
            const wrongNonce = 5;
            const deadline = (await time.latest()) + 3600;

            const transferRequest = {
                token: await mockToken.getAddress(),
                amount: amount,
                receiver: receiver.address,
                maxFee: ethers.parseUnits("2", 18),
                signer: user.address,
                nonce: wrongNonce,
                deadline: deadline,
            };

            const signature = await user.signTypedData(domain, types, transferRequest);

            await expect(
                tokenRelay.connect(relayer).relayTransfer({
                    token: transferRequest.token,
                    amount: transferRequest.amount,
                    receiver: transferRequest.receiver,
                    maxFee: transferRequest.maxFee,
                    signer: transferRequest.signer,
                    deadline: transferRequest.deadline,
                    signature: signature
                })
            ).to.be.revertedWithCustomError(tokenRelay, "InvalidSignature");
        });

        it("Should revert if amount is below minimum", async function () {
            const amount = ethers.parseUnits("0.5", 18); // Below minimum
            const nonce = await tokenRelay.getNonce(user.address);
            const deadline = (await time.latest()) + 3600;

            const transferRequest = {
                token: await mockToken.getAddress(),
                amount: amount,
                receiver: receiver.address,
                maxFee: ethers.parseUnits("1", 18),
                signer: user.address,
                nonce: nonce,
                deadline: deadline,
            };

            const signature = await user.signTypedData(domain, types, transferRequest);

            await expect(
                tokenRelay.connect(relayer).relayTransfer({
                    token: transferRequest.token,
                    amount: transferRequest.amount,
                    receiver: transferRequest.receiver,
                    maxFee: transferRequest.maxFee,
                    signer: transferRequest.signer,
                    deadline: transferRequest.deadline,
                    signature: signature
                })
            ).to.be.revertedWithCustomError(tokenRelay, "AmountTooLow");
        });

        it("Should revert if fee exceeds maxFee", async function () {
            const amount = ethers.parseUnits("100", 18);
            const maxFee = ethers.parseUnits("0.5", 18); // Less than 1% of 100
            const nonce = await tokenRelay.getNonce(user.address);
            const deadline = (await time.latest()) + 3600;

            const transferRequest = {
                token: await mockToken.getAddress(),
                amount: amount,
                receiver: receiver.address,
                maxFee: maxFee,
                signer: user.address,
                nonce: nonce,
                deadline: deadline,
            };

            const signature = await user.signTypedData(domain, types, transferRequest);

            await expect(
                tokenRelay.connect(relayer).relayTransfer({
                    token: transferRequest.token,
                    amount: transferRequest.amount,
                    receiver: transferRequest.receiver,
                    maxFee: transferRequest.maxFee,
                    signer: transferRequest.signer,
                    deadline: transferRequest.deadline,
                    signature: signature
                })
            ).to.be.revertedWithCustomError(tokenRelay, "FeeTooHigh");
        });

        it("Should revert if signature is invalid", async function () {
            const amount = ethers.parseUnits("100", 18);
            const nonce = await tokenRelay.getNonce(user.address);
            const deadline = (await time.latest()) + 3600;

            const transferRequest = {
                token: await mockToken.getAddress(),
                amount: amount,
                receiver: receiver.address,
                maxFee: ethers.parseUnits("2", 18),
                signer: user.address,
                nonce: nonce,
                deadline: deadline,
            };

            // Sign with wrong signer
            const signature = await relayer.signTypedData(domain, types, transferRequest);

            await expect(
                tokenRelay.connect(relayer).relayTransfer({
                    token: transferRequest.token,
                    amount: transferRequest.amount,
                    receiver: transferRequest.receiver,
                    maxFee: transferRequest.maxFee,
                    signer: transferRequest.signer,
                    deadline: transferRequest.deadline,
                    signature: signature
                })
            ).to.be.revertedWithCustomError(tokenRelay, "InvalidSignature");
        });

        it("Should prevent replay attacks", async function () {
            const amount = ethers.parseUnits("100", 18);
            const maxFee = ethers.parseUnits("2", 18);
            const nonce = await tokenRelay.getNonce(user.address);
            const deadline = (await time.latest()) + 3600;

            const transferRequest = {
                token: await mockToken.getAddress(),
                amount: amount,
                receiver: receiver.address,
                maxFee: maxFee,
                signer: user.address,
                nonce: nonce,
                deadline: deadline,
            };

            const signature = await user.signTypedData(domain, types, transferRequest);

            // First transfer succeeds
            await tokenRelay.connect(relayer).relayTransfer({
                token: transferRequest.token,
                amount: transferRequest.amount,
                receiver: transferRequest.receiver,
                maxFee: transferRequest.maxFee,
                signer: transferRequest.signer,
                deadline: transferRequest.deadline,
                signature: signature
            });

            // Second transfer with same signature should fail
            await expect(
                tokenRelay.connect(relayer).relayTransfer({
                    token: transferRequest.token,
                    amount: transferRequest.amount,
                    receiver: transferRequest.receiver,
                    maxFee: transferRequest.maxFee,
                    signer: transferRequest.signer,
                    deadline: transferRequest.deadline,
                    signature: signature
                })
            ).to.be.revertedWithCustomError(tokenRelay, "InvalidSignature");
        });
    });
});
