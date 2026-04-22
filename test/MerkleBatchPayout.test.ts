import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import {
    PaymentEntry,
    generateBatchData,
    getPaymentProof,
    verifyMerkleProof,
} from "../scripts/merkleHelper";

describe("MerkleBatchPayout", function () {
    let merkleBatchPayout: any;
    let mockToken: any;
    let owner: any;
    let signer: any;
    let receiver1: any;
    let receiver2: any;
    let other: any;

    beforeEach(async function () {
        [owner, signer, receiver1, receiver2, other] = await ethers.getSigners();

        // Deploy mock ERC20 token
        const MockToken = await ethers.getContractFactory("MockERC20");
        mockToken = await MockToken.deploy("Test Token", "TEST", ethers.parseUnits("10000", 18));
        await mockToken.waitForDeployment();

        // Deploy MerkleBatchPayout
        const MerkleBatchPayout = await ethers.getContractFactory("MerkleBatchPayout");
        merkleBatchPayout = await MerkleBatchPayout.deploy();
        await merkleBatchPayout.waitForDeployment();

        // Transfer tokens to signer for batch funding
        await mockToken.transfer(signer.address, ethers.parseUnits("1000", 18));
        await mockToken.connect(signer).approve(await merkleBatchPayout.getAddress(), ethers.MaxUint256);
    });

    describe("Batch Creation", function () {
        it("Should successfully create a batch with valid signature", async function () {
            const now = Math.floor(Date.now() / 1000);
            const gracePeriod = 86400 * 30; // 30 days
            const disapprovalDeadline = 0;
            const signatureTimestamp = now;

            const payments: PaymentEntry[] = [
                {
                    receiverAddress: receiver1.address,
                    amount: ethers.parseUnits("100", 18).toString(),
                    claimableDate: now + 60,
                    memo: "Payment 1"
                },
                {
                    receiverAddress: receiver2.address,
                    amount: ethers.parseUnits("50", 18).toString(),
                    claimableDate: now + 120,
                    memo: "Payment 2"
                }
            ];

            const chainId = (await ethers.provider.getNetwork()).chainId;
            const totalAmount = ethers.parseUnits("150", 18);

            const batchData = await generateBatchData(
                payments,
                "test-batch-" + Date.now(),
                signer,
                await mockToken.getAddress(),
                totalAmount,
                signatureTimestamp,
                Number(chainId),
                gracePeriod,
                disapprovalDeadline
            );

            console.log("Generated batchData:");
            console.log("- batchHash (userBatchId):", batchData.batchHash);
            console.log("- contractBatchHash:", batchData.contractBatchHash);
            console.log("- merkleRoot:", batchData.merkleRoot);
            console.log("- signerAddress:", batchData.signerAddress);
            console.log("- signature:", batchData.signature);

            await expect(
                merkleBatchPayout.connect(signer).createBatch(
                    batchData.batchHash,
                    signatureTimestamp,
                    batchData.signerAddress,
                    batchData.merkleRoot,
                    gracePeriod,
                    disapprovalDeadline,
                    await mockToken.getAddress(),
                    totalAmount,
                    ethers.ZeroAddress,
                    batchData.signature
                )
            ).to.emit(merkleBatchPayout, "BatchCreated");

            const batch = await merkleBatchPayout.getBatch(batchData.batchId);
            expect(batch.exists).to.be.true;
            expect(batch.signer).to.equal(batchData.signerAddress);
            expect(batch.merkleRoot).to.equal(batchData.merkleRoot);
            expect(batch.fundingToken).to.equal(await mockToken.getAddress());
            expect(batch.totalFunded).to.equal(totalAmount);
            expect(batch.totalClaimed).to.equal(0);
        });

        it("Should revert with invalid signer address", async function () {
            await expect(
                merkleBatchPayout.createBatch(
                    ethers.ZeroHash,
                    Math.floor(Date.now() / 1000),
                    ethers.ZeroAddress,
                    ethers.ZeroHash,
                    0,
                    0,
                    await mockToken.getAddress(),
                    ethers.parseUnits("100", 18),
                    ethers.ZeroAddress,
                    "0x"
                )
            ).to.be.revertedWith("Invalid signer address");
        });

        it("Should revert with invalid merkle root", async function () {
            await expect(
                merkleBatchPayout.createBatch(
                    ethers.ZeroHash,
                    Math.floor(Date.now() / 1000),
                    signer.address,
                    ethers.ZeroHash,
                    0,
                    0,
                    await mockToken.getAddress(),
                    ethers.parseUnits("100", 18),
                    ethers.ZeroAddress,
                    "0x"
                )
            ).to.be.revertedWith("Invalid merkle root");
        });

        it("Should revert with invalid funding token", async function () {
            await expect(
                merkleBatchPayout.createBatch(
                    ethers.ZeroHash,
                    Math.floor(Date.now() / 1000),
                    signer.address,
                    ethers.keccak256(ethers.toUtf8Bytes("test")),
                    0,
                    0,
                    ethers.ZeroAddress,
                    ethers.parseUnits("100", 18),
                    ethers.ZeroAddress,
                    "0x"
                )
            ).to.be.revertedWith("Invalid funding token");
        });

        it("Should revert with zero amount", async function () {
            await expect(
                merkleBatchPayout.createBatch(
                    ethers.ZeroHash,
                    Math.floor(Date.now() / 1000),
                    signer.address,
                    ethers.keccak256(ethers.toUtf8Bytes("test")),
                    0,
                    0,
                    await mockToken.getAddress(),
                    0,
                    ethers.ZeroAddress,
                    "0x"
                )
            ).to.be.revertedWith("Amount must be greater than 0");
        });

        it("Should revert with invalid signature", async function () {
            const now = Math.floor(Date.now() / 1000);
            const gracePeriod = 86400 * 30;
            const disapprovalDeadline = 0;
            const signatureTimestamp = now;

            const payments: PaymentEntry[] = [
                {
                    receiverAddress: receiver1.address,
                    amount: ethers.parseUnits("100", 18).toString(),
                    claimableDate: now + 60,
                    memo: "Payment 1"
                }
            ];

            const chainId = (await ethers.provider.getNetwork()).chainId;
            const totalAmount = ethers.parseUnits("100", 18);

            const batchData = await generateBatchData(
                payments,
                "test-batch-" + Date.now(),
                signer,
                await mockToken.getAddress(),
                totalAmount,
                signatureTimestamp,
                Number(chainId),
                gracePeriod,
                disapprovalDeadline
            );

            // Create a fake signature by signing with a different account
            const fakeSignature = await other.signMessage(ethers.getBytes(ethers.keccak256(ethers.toUtf8Bytes("fake"))));

            await expect(
                merkleBatchPayout.connect(signer).createBatch(
                    batchData.batchHash,
                    signatureTimestamp,
                    batchData.signerAddress,
                    batchData.merkleRoot,
                    gracePeriod,
                    disapprovalDeadline,
                    await mockToken.getAddress(),
                    totalAmount,
                    ethers.ZeroAddress,
                    fakeSignature
                )
            ).to.be.revertedWith("Invalid signature");
        });
    });

    describe("Payment Claiming", function () {
        let batchData: any;
        let payments: PaymentEntry[];
        let gracePeriod: number;
        let disapprovalDeadline: number;
        let signatureTimestamp: number;

        beforeEach(async function () {
            const now = Math.floor(Date.now() / 1000);
            gracePeriod = 86400 * 30;
            disapprovalDeadline = 0;
            signatureTimestamp = now;

            payments = [
                {
                    receiverAddress: receiver1.address,
                    amount: ethers.parseUnits("100", 18).toString(),
                    claimableDate: now + 10,
                    memo: "Payment 1"
                },
                {
                    receiverAddress: receiver2.address,
                    amount: ethers.parseUnits("50", 18).toString(),
                    claimableDate: now + 10,
                    memo: "Payment 2"
                }
            ];

            const chainId = (await ethers.provider.getNetwork()).chainId;
            const totalAmount = ethers.parseUnits("150", 18);

            batchData = await generateBatchData(
                payments,
                "claim-test-" + Date.now(),
                signer,
                await mockToken.getAddress(),
                totalAmount,
                signatureTimestamp,
                Number(chainId),
                gracePeriod,
                disapprovalDeadline
            );

            await merkleBatchPayout.connect(signer).createBatch(
                batchData.batchHash,
                signatureTimestamp,
                batchData.signerAddress,
                batchData.merkleRoot,
                gracePeriod,
                disapprovalDeadline,
                await mockToken.getAddress(),
                totalAmount,
                ethers.ZeroAddress,
                batchData.signature
            );

            // Wait for claimable date
            await time.increase(15);
        });

        it("Should successfully claim a payment with valid proof", async function () {
            const proof = getPaymentProof(batchData.tree, batchData.contractBatchHash, payments[0]);

            const payment = {
                batchId: batchData.batchId,
                merkleRoot: batchData.merkleRoot,
                receiver: payments[0].receiverAddress,
                fundingToken: await mockToken.getAddress(),
                amount: payments[0].amount,
                claimDate: payments[0].claimableDate,
                memo: payments[0].memo
            };

            const receiver1BalanceBefore = await mockToken.balanceOf(receiver1.address);

            await expect(
                merkleBatchPayout.claimPayment(payment, proof)
            ).to.emit(merkleBatchPayout, "PaymentClaimed");

            const receiver1BalanceAfter = await mockToken.balanceOf(receiver1.address);
            expect(receiver1BalanceAfter - receiver1BalanceBefore).to.equal(payments[0].amount);

            const batch = await merkleBatchPayout.getBatch(batchData.batchId);
            expect(batch.totalClaimed).to.equal(payments[0].amount);
        });

        it("Should revert when claiming with invalid proof", async function () {
            // Use proof from payment 2 for payment 1
            const wrongProof = getPaymentProof(batchData.tree, batchData.contractBatchHash, payments[1]);

            const payment = {
                batchId: batchData.batchId,
                merkleRoot: batchData.merkleRoot,
                receiver: payments[0].receiverAddress,
                fundingToken: await mockToken.getAddress(),
                amount: payments[0].amount,
                claimDate: payments[0].claimableDate,
                memo: payments[0].memo
            };

            await expect(
                merkleBatchPayout.claimPayment(payment, wrongProof)
            ).to.be.revertedWith("Invalid merkle proof");
        });

        it("Should revert when claiming twice", async function () {
            const proof = getPaymentProof(batchData.tree, batchData.contractBatchHash, payments[0]);

            const payment = {
                batchId: batchData.batchId,
                merkleRoot: batchData.merkleRoot,
                receiver: payments[0].receiverAddress,
                fundingToken: await mockToken.getAddress(),
                amount: payments[0].amount,
                claimDate: payments[0].claimableDate,
                memo: payments[0].memo
            };

            // First claim succeeds
            await merkleBatchPayout.claimPayment(payment, proof);

            // Second claim fails
            await expect(
                merkleBatchPayout.claimPayment(payment, proof)
            ).to.be.revertedWith("Payment already claimed");
        });

        it("Should allow multiple receivers to claim independently", async function () {
            const proof1 = getPaymentProof(batchData.tree, batchData.contractBatchHash, payments[0]);
            const proof2 = getPaymentProof(batchData.tree, batchData.contractBatchHash, payments[1]);

            const payment1 = {
                batchId: batchData.batchId,
                merkleRoot: batchData.merkleRoot,
                receiver: payments[0].receiverAddress,
                fundingToken: await mockToken.getAddress(),
                amount: payments[0].amount,
                claimDate: payments[0].claimableDate,
                memo: payments[0].memo
            };

            const payment2 = {
                batchId: batchData.batchId,
                merkleRoot: batchData.merkleRoot,
                receiver: payments[1].receiverAddress,
                fundingToken: await mockToken.getAddress(),
                amount: payments[1].amount,
                claimDate: payments[1].claimableDate,
                memo: payments[1].memo
            };

            const receiver1BalanceBefore = await mockToken.balanceOf(receiver1.address);
            const receiver2BalanceBefore = await mockToken.balanceOf(receiver2.address);

            // Receiver 1 claims
            await merkleBatchPayout.claimPayment(payment1, proof1);

            // Receiver 2 claims
            await merkleBatchPayout.claimPayment(payment2, proof2);

            const receiver1BalanceAfter = await mockToken.balanceOf(receiver1.address);
            const receiver2BalanceAfter = await mockToken.balanceOf(receiver2.address);

            expect(receiver1BalanceAfter - receiver1BalanceBefore).to.equal(payments[0].amount);
            expect(receiver2BalanceAfter - receiver2BalanceBefore).to.equal(payments[1].amount);

            const batch = await merkleBatchPayout.getBatch(batchData.batchId);
            expect(batch.totalClaimed).to.equal(BigInt(payments[0].amount) + BigInt(payments[1].amount));
        });
    });

    describe("Batch with 3 Payments", function () {
        let batchData: any;
        let payments: PaymentEntry[];
        let gracePeriod: number;
        let disapprovalDeadline: number;
        let signatureTimestamp: number;
        let receiver3: any;

        beforeEach(async function () {
            [, , , , , receiver3] = await ethers.getSigners();

            const now = Math.floor(Date.now() / 1000);
            gracePeriod = 86400 * 30;
            disapprovalDeadline = 0;
            signatureTimestamp = now;

            payments = [
                {
                    receiverAddress: receiver1.address,
                    amount: ethers.parseUnits("100", 18).toString(),
                    claimableDate: now + 10,
                    memo: "Payment to receiver 1"
                },
                {
                    receiverAddress: receiver2.address,
                    amount: ethers.parseUnits("50", 18).toString(),
                    claimableDate: now + 10,
                    memo: "Payment to receiver 2"
                },
                {
                    receiverAddress: receiver3.address,
                    amount: ethers.parseUnits("75", 18).toString(),
                    claimableDate: now + 10,
                    memo: "Payment to receiver 3"
                }
            ];

            const chainId = (await ethers.provider.getNetwork()).chainId;
            const totalAmount = ethers.parseUnits("225", 18);

            batchData = await generateBatchData(
                payments,
                "3-payment-batch-" + Date.now(),
                signer,
                await mockToken.getAddress(),
                totalAmount,
                signatureTimestamp,
                Number(chainId),
                gracePeriod,
                disapprovalDeadline
            );

            await merkleBatchPayout.connect(signer).createBatch(
                batchData.batchHash,
                signatureTimestamp,
                batchData.signerAddress,
                batchData.merkleRoot,
                gracePeriod,
                disapprovalDeadline,
                await mockToken.getAddress(),
                totalAmount,
                ethers.ZeroAddress,
                batchData.signature
            );

            // Wait for claimable date
            await time.increase(15);
        });

        it("Should successfully create batch with 3 payments", async function () {
            const batch = await merkleBatchPayout.getBatch(batchData.batchId);
            expect(batch.exists).to.be.true;
            expect(batch.totalFunded).to.equal(ethers.parseUnits("225", 18));
            expect(batch.totalClaimed).to.equal(0);
        });

        it("Should allow all 3 receivers to claim their payments", async function () {
            const proof1 = getPaymentProof(batchData.tree, batchData.contractBatchHash, payments[0]);
            const proof2 = getPaymentProof(batchData.tree, batchData.contractBatchHash, payments[1]);
            const proof3 = getPaymentProof(batchData.tree, batchData.contractBatchHash, payments[2]);

            const payment1 = {
                batchId: batchData.batchId,
                merkleRoot: batchData.merkleRoot,
                receiver: payments[0].receiverAddress,
                fundingToken: await mockToken.getAddress(),
                amount: payments[0].amount,
                claimDate: payments[0].claimableDate,
                memo: payments[0].memo
            };

            const payment2 = {
                batchId: batchData.batchId,
                merkleRoot: batchData.merkleRoot,
                receiver: payments[1].receiverAddress,
                fundingToken: await mockToken.getAddress(),
                amount: payments[1].amount,
                claimDate: payments[1].claimableDate,
                memo: payments[1].memo
            };

            const payment3 = {
                batchId: batchData.batchId,
                merkleRoot: batchData.merkleRoot,
                receiver: payments[2].receiverAddress,
                fundingToken: await mockToken.getAddress(),
                amount: payments[2].amount,
                claimDate: payments[2].claimableDate,
                memo: payments[2].memo
            };

            // Claim all 3 payments
            await merkleBatchPayout.claimPayment(payment1, proof1);
            await merkleBatchPayout.claimPayment(payment2, proof2);
            await merkleBatchPayout.claimPayment(payment3, proof3);

            // Verify balances
            expect(await mockToken.balanceOf(receiver1.address)).to.equal(payments[0].amount);
            expect(await mockToken.balanceOf(receiver2.address)).to.equal(payments[1].amount);
            expect(await mockToken.balanceOf(receiver3.address)).to.equal(payments[2].amount);

            // Verify batch state
            const batch = await merkleBatchPayout.getBatch(batchData.batchId);
            expect(batch.totalClaimed).to.equal(ethers.parseUnits("225", 18));
            expect(batch.claimCount).to.equal(3);
        });

        it("Should allow claims in any order", async function () {
            const proof1 = getPaymentProof(batchData.tree, batchData.contractBatchHash, payments[0]);
            const proof2 = getPaymentProof(batchData.tree, batchData.contractBatchHash, payments[1]);
            const proof3 = getPaymentProof(batchData.tree, batchData.contractBatchHash, payments[2]);

            const payment1 = {
                batchId: batchData.batchId,
                merkleRoot: batchData.merkleRoot,
                receiver: payments[0].receiverAddress,
                fundingToken: await mockToken.getAddress(),
                amount: payments[0].amount,
                claimDate: payments[0].claimableDate,
                memo: payments[0].memo
            };

            const payment2 = {
                batchId: batchData.batchId,
                merkleRoot: batchData.merkleRoot,
                receiver: payments[1].receiverAddress,
                fundingToken: await mockToken.getAddress(),
                amount: payments[1].amount,
                claimDate: payments[1].claimableDate,
                memo: payments[1].memo
            };

            const payment3 = {
                batchId: batchData.batchId,
                merkleRoot: batchData.merkleRoot,
                receiver: payments[2].receiverAddress,
                fundingToken: await mockToken.getAddress(),
                amount: payments[2].amount,
                claimDate: payments[2].claimableDate,
                memo: payments[2].memo
            };

            // Claim in different order: 3, 1, 2
            await merkleBatchPayout.claimPayment(payment3, proof3);
            await merkleBatchPayout.claimPayment(payment1, proof1);
            await merkleBatchPayout.claimPayment(payment2, proof2);

            // Verify all payments were successful
            const batch = await merkleBatchPayout.getBatch(batchData.batchId);
            expect(batch.totalClaimed).to.equal(ethers.parseUnits("225", 18));
            expect(batch.claimCount).to.equal(3);
        });

        it("Should prevent using wrong proof for different payment", async function () {
            // Try to use proof from payment 1 for payment 2
            const wrongProof = getPaymentProof(batchData.tree, batchData.contractBatchHash, payments[0]);

            const payment2 = {
                batchId: batchData.batchId,
                merkleRoot: batchData.merkleRoot,
                receiver: payments[1].receiverAddress,
                fundingToken: await mockToken.getAddress(),
                amount: payments[1].amount,
                claimDate: payments[1].claimableDate,
                memo: payments[1].memo
            };

            await expect(
                merkleBatchPayout.claimPayment(payment2, wrongProof)
            ).to.be.revertedWith("Invalid merkle proof");
        });

        it("Should verify all 3 proofs using JavaScript helper before contract submission", async function () {
            const proof1 = getPaymentProof(batchData.tree, batchData.contractBatchHash, payments[0]);
            const proof2 = getPaymentProof(batchData.tree, batchData.contractBatchHash, payments[1]);
            const proof3 = getPaymentProof(batchData.tree, batchData.contractBatchHash, payments[2]);

            // Verify all proofs using JavaScript helper
            const isValid1 = verifyMerkleProof(proof1, batchData.merkleRoot, batchData.contractBatchHash, payments[0]);
            const isValid2 = verifyMerkleProof(proof2, batchData.merkleRoot, batchData.contractBatchHash, payments[1]);
            const isValid3 = verifyMerkleProof(proof3, batchData.merkleRoot, batchData.contractBatchHash, payments[2]);

            expect(isValid1).to.be.true;
            expect(isValid2).to.be.true;
            expect(isValid3).to.be.true;

            console.log("✓ All 3 proofs verified with JavaScript helper");
            console.log("  - Payment 1 (100 tokens): Valid");
            console.log("  - Payment 2 (50 tokens): Valid");
            console.log("  - Payment 3 (75 tokens): Valid");

            // Now verify they work on-chain too
            const payment1 = {
                batchId: batchData.batchId,
                merkleRoot: batchData.merkleRoot,
                receiver: payments[0].receiverAddress,
                fundingToken: await mockToken.getAddress(),
                amount: payments[0].amount,
                claimDate: payments[0].claimableDate,
                memo: payments[0].memo
            };

            const payment2 = {
                batchId: batchData.batchId,
                merkleRoot: batchData.merkleRoot,
                receiver: payments[1].receiverAddress,
                fundingToken: await mockToken.getAddress(),
                amount: payments[1].amount,
                claimDate: payments[1].claimableDate,
                memo: payments[1].memo
            };

            const payment3 = {
                batchId: batchData.batchId,
                merkleRoot: batchData.merkleRoot,
                receiver: payments[2].receiverAddress,
                fundingToken: await mockToken.getAddress(),
                amount: payments[2].amount,
                claimDate: payments[2].claimableDate,
                memo: payments[2].memo
            };

            // All should succeed on-chain
            await expect(merkleBatchPayout.claimPayment(payment1, proof1))
                .to.emit(merkleBatchPayout, "PaymentClaimed");
            await expect(merkleBatchPayout.claimPayment(payment2, proof2))
                .to.emit(merkleBatchPayout, "PaymentClaimed");
            await expect(merkleBatchPayout.claimPayment(payment3, proof3))
                .to.emit(merkleBatchPayout, "PaymentClaimed");

            console.log("✓ All 3 payments successfully claimed on-chain");
        });

        it("Should detect invalid proofs using JavaScript helper", async function () {
            // Get correct proof for payment 1
            const correctProof = getPaymentProof(batchData.tree, batchData.contractBatchHash, payments[0]);

            // Get proof for payment 2 (wrong proof for payment 1)
            const wrongProof = getPaymentProof(batchData.tree, batchData.contractBatchHash, payments[1]);

            // Verify correct proof works
            const isValidCorrect = verifyMerkleProof(
                correctProof,
                batchData.merkleRoot,
                batchData.contractBatchHash,
                payments[0]
            );
            expect(isValidCorrect).to.be.true;

            // Verify wrong proof fails
            const isValidWrong = verifyMerkleProof(
                wrongProof,
                batchData.merkleRoot,
                batchData.contractBatchHash,
                payments[0]  // Using payment 0 data with payment 1 proof
            );
            expect(isValidWrong).to.be.false;

            console.log("✓ JavaScript helper correctly detects invalid proofs");
        });

        it("Should verify proofs match between JavaScript and Solidity", async function () {
            // Generate all 3 proofs
            const proofs = [
                getPaymentProof(batchData.tree, batchData.contractBatchHash, payments[0]),
                getPaymentProof(batchData.tree, batchData.contractBatchHash, payments[1]),
                getPaymentProof(batchData.tree, batchData.contractBatchHash, payments[2])
            ];

            console.log("\nVerifying JavaScript merkle proof generation:");
            console.log("Merkle Root:", batchData.merkleRoot);
            console.log("Batch Hash (for leaves):", batchData.contractBatchHash);

            for (let i = 0; i < payments.length; i++) {
                // Verify with JavaScript
                const jsValid = verifyMerkleProof(
                    proofs[i],
                    batchData.merkleRoot,
                    batchData.contractBatchHash,
                    payments[i]
                );

                console.log(`\nPayment ${i + 1}:`);
                console.log(`  Receiver: ${payments[i].receiverAddress}`);
                console.log(`  Amount: ${payments[i].amount}`);
                console.log(`  Proof length: ${proofs[i].length}`);
                console.log(`  JS Verification: ${jsValid ? '✓ Valid' : '✗ Invalid'}`);

                expect(jsValid).to.be.true;

                // Now verify on-chain
                const payment = {
                    batchId: batchData.batchId,
                    merkleRoot: batchData.merkleRoot,
                    receiver: payments[i].receiverAddress,
                    fundingToken: await mockToken.getAddress(),
                    amount: payments[i].amount,
                    claimDate: payments[i].claimableDate,
                    memo: payments[i].memo
                };

                await expect(merkleBatchPayout.claimPayment(payment, proofs[i]))
                    .to.emit(merkleBatchPayout, "PaymentClaimed");

                console.log(`  Contract Verification: ✓ Valid (payment claimed)`);
            }

            const batch = await merkleBatchPayout.getBatch(batchData.batchId);
            expect(batch.claimCount).to.equal(3);
            console.log("\n✓ All proofs verified identically in JavaScript and Solidity");
        });
    });

    describe("Add Funds", function () {
        let batchData: any;
        let payments: PaymentEntry[];

        beforeEach(async function () {
            const now = Math.floor(Date.now() / 1000);
            const gracePeriod = 86400 * 30;
            const disapprovalDeadline = 0;
            const signatureTimestamp = now;

            payments = [
                {
                    receiverAddress: receiver1.address,
                    amount: ethers.parseUnits("100", 18).toString(),
                    claimableDate: now + 60,
                    memo: "Payment 1"
                }
            ];

            const chainId = (await ethers.provider.getNetwork()).chainId;
            const totalAmount = ethers.parseUnits("100", 18);

            batchData = await generateBatchData(
                payments,
                "add-funds-test-" + Date.now(),
                signer,
                await mockToken.getAddress(),
                totalAmount,
                signatureTimestamp,
                Number(chainId),
                gracePeriod,
                disapprovalDeadline
            );

            await merkleBatchPayout.connect(signer).createBatch(
                batchData.batchHash,
                signatureTimestamp,
                batchData.signerAddress,
                batchData.merkleRoot,
                gracePeriod,
                disapprovalDeadline,
                await mockToken.getAddress(),
                totalAmount,
                ethers.ZeroAddress,
                batchData.signature
            );
        });

        it("Should successfully add funds to existing batch", async function () {
            const additionalAmount = ethers.parseUnits("50", 18);

            const batchBefore = await merkleBatchPayout.getBatch(batchData.batchId);
            const totalFundedBefore = batchBefore.totalFunded;

            await expect(
                merkleBatchPayout.connect(signer).addFundsToBatch(
                    batchData.batchId,
                    additionalAmount
                )
            ).to.emit(merkleBatchPayout, "BatchFunded");

            const batchAfter = await merkleBatchPayout.getBatch(batchData.batchId);
            expect(batchAfter.totalFunded).to.equal(totalFundedBefore + additionalAmount);
        });

        it("Should revert when adding funds to non-existent batch", async function () {
            const fakeBatchId = ethers.keccak256(ethers.toUtf8Bytes("fake-batch"));

            await expect(
                merkleBatchPayout.connect(signer).addFundsToBatch(
                    fakeBatchId,
                    ethers.parseUnits("50", 18)
                )
            ).to.be.revertedWith("Batch does not exist");
        });
    });

    describe("Cancel Claims and Withdraw Canceled Funds", function () {
        let batchData: any;
        let payments: PaymentEntry[];
        let signatureTimestamp: number;
        let gracePeriod: number;
        let disapprovalDeadline: number;

        function toPayment(payment: PaymentEntry) {
            return {
                batchId: batchData.batchId,
                merkleRoot: batchData.merkleRoot,
                receiver: payment.receiverAddress,
                amount: payment.amount,
                claimDate: payment.claimableDate,
                memo: payment.memo
            };
        }

        beforeEach(async function () {
            const now = await time.latest();
            gracePeriod = 3600;
            disapprovalDeadline = 60;
            signatureTimestamp = now;

            payments = [
                {
                    receiverAddress: receiver1.address,
                    amount: ethers.parseUnits("100", 18).toString(),
                    claimableDate: now + 3600,
                    memo: "Cancelable payment 1"
                },
                {
                    receiverAddress: receiver2.address,
                    amount: ethers.parseUnits("50", 18).toString(),
                    claimableDate: now + 3600,
                    memo: "Cancelable payment 2"
                }
            ];

            const chainId = (await ethers.provider.getNetwork()).chainId;
            const totalAmount = ethers.parseUnits("150", 18);

            batchData = await generateBatchData(
                payments,
                "cancel-test-" + now,
                signer,
                await mockToken.getAddress(),
                totalAmount,
                signatureTimestamp,
                Number(chainId),
                gracePeriod,
                disapprovalDeadline
            );

            await merkleBatchPayout.connect(signer).createBatch(
                batchData.batchHash,
                signatureTimestamp,
                batchData.signerAddress,
                batchData.merkleRoot,
                gracePeriod,
                disapprovalDeadline,
                await mockToken.getAddress(),
                totalAmount,
                ethers.ZeroAddress,
                batchData.signature
            );
        });

        it("Should cancel a valid claim and prevent it from being claimed", async function () {
            const proof = getPaymentProof(batchData.tree, batchData.contractBatchHash, payments[0]);
            const payment = toPayment(payments[0]);

            await expect(
                merkleBatchPayout.connect(signer).cancelClaim(payment, proof)
            ).to.emit(merkleBatchPayout, "ClaimDisabled");

            const batch = await merkleBatchPayout.getBatch(batchData.batchId);
            expect(batch.totalCanceled).to.equal(payments[0].amount);

            await time.increaseTo(payments[0].claimableDate);

            await expect(
                merkleBatchPayout.claimPayment(payment, proof)
            ).to.be.revertedWith("Claim disabled");
        });

        it("Should reject cancellation with an invalid merkle proof", async function () {
            const wrongProof = getPaymentProof(batchData.tree, batchData.contractBatchHash, payments[1]);

            await expect(
                merkleBatchPayout.connect(signer).cancelClaim(toPayment(payments[0]), wrongProof)
            ).to.be.revertedWith("Invalid merkle proof");
        });

        it("Should cancel multiple valid claims in one transaction", async function () {
            const proof1 = getPaymentProof(batchData.tree, batchData.contractBatchHash, payments[0]);
            const proof2 = getPaymentProof(batchData.tree, batchData.contractBatchHash, payments[1]);

            await expect(
                merkleBatchPayout.connect(signer).cancelClaimMulti(
                    [toPayment(payments[0]), toPayment(payments[1])],
                    [proof1, proof2]
                )
            ).to.emit(merkleBatchPayout, "ClaimDisabled");

            const batch = await merkleBatchPayout.getBatch(batchData.batchId);
            expect(batch.totalCanceled).to.equal(
                BigInt(payments[0].amount) + BigInt(payments[1].amount)
            );
        });

        it("Should reject multi-cancel calls with mismatched proof count", async function () {
            const proof1 = getPaymentProof(batchData.tree, batchData.contractBatchHash, payments[0]);

            await expect(
                merkleBatchPayout.connect(signer).cancelClaimMulti(
                    [toPayment(payments[0]), toPayment(payments[1])],
                    [proof1]
                )
            ).to.be.revertedWith("Invalid proof count");
        });

        it("Should let the signer withdraw canceled funds once", async function () {
            const proof = getPaymentProof(batchData.tree, batchData.contractBatchHash, payments[0]);
            const payment = toPayment(payments[0]);
            const amount = BigInt(payments[0].amount);

            await merkleBatchPayout.connect(signer).cancelClaim(payment, proof);

            const signerBalanceBefore = await mockToken.balanceOf(signer.address);

            await expect(
                merkleBatchPayout.connect(signer).withdrawCanceledFunds(batchData.batchId)
            ).to.emit(merkleBatchPayout, "BatchWithdrawn");

            expect(await mockToken.balanceOf(signer.address)).to.equal(
                signerBalanceBefore + amount
            );

            const batch = await merkleBatchPayout.getBatch(batchData.batchId);
            expect(batch.totalCanceled).to.equal(amount);
            expect(batch.totalClaimed).to.equal(amount);
            expect(await merkleBatchPayout.withdrawnCanceledFunds(batchData.batchId)).to.equal(amount);

            await expect(
                merkleBatchPayout.connect(signer).withdrawCanceledFunds(batchData.batchId)
            ).to.be.revertedWith("No funds to withdraw");
        });

        it("Should reject canceled fund withdrawals from unauthorized accounts", async function () {
            const proof = getPaymentProof(batchData.tree, batchData.contractBatchHash, payments[0]);

            await merkleBatchPayout.connect(signer).cancelClaim(toPayment(payments[0]), proof);

            await expect(
                merkleBatchPayout.connect(other).withdrawCanceledFunds(batchData.batchId)
            ).to.be.revertedWith("Only batch creator can withdraw");
        });

        it("Should withdraw canceled funds after another payment has already been claimed", async function () {
            const now = await time.latest();
            const mixedPayments: PaymentEntry[] = [
                {
                    receiverAddress: receiver1.address,
                    amount: ethers.parseUnits("100", 18).toString(),
                    claimableDate: now + 10,
                    memo: "Claimed payment"
                },
                {
                    receiverAddress: receiver2.address,
                    amount: ethers.parseUnits("50", 18).toString(),
                    claimableDate: now + 3600,
                    memo: "Canceled payment"
                }
            ];
            const totalAmount = ethers.parseUnits("150", 18);
            const chainId = (await ethers.provider.getNetwork()).chainId;

            const mixedBatchData = await generateBatchData(
                mixedPayments,
                "mixed-cancel-test-" + now,
                signer,
                await mockToken.getAddress(),
                totalAmount,
                now,
                Number(chainId),
                gracePeriod,
                disapprovalDeadline
            );

            await merkleBatchPayout.connect(signer).createBatch(
                mixedBatchData.batchHash,
                now,
                mixedBatchData.signerAddress,
                mixedBatchData.merkleRoot,
                gracePeriod,
                disapprovalDeadline,
                await mockToken.getAddress(),
                totalAmount,
                ethers.ZeroAddress,
                mixedBatchData.signature
            );

            const claimedProof = getPaymentProof(
                mixedBatchData.tree,
                mixedBatchData.contractBatchHash,
                mixedPayments[0]
            );
            const canceledProof = getPaymentProof(
                mixedBatchData.tree,
                mixedBatchData.contractBatchHash,
                mixedPayments[1]
            );
            const claimedPayment = {
                batchId: mixedBatchData.batchId,
                merkleRoot: mixedBatchData.merkleRoot,
                receiver: mixedPayments[0].receiverAddress,
                amount: mixedPayments[0].amount,
                claimDate: mixedPayments[0].claimableDate,
                memo: mixedPayments[0].memo
            };
            const canceledPayment = {
                batchId: mixedBatchData.batchId,
                merkleRoot: mixedBatchData.merkleRoot,
                receiver: mixedPayments[1].receiverAddress,
                amount: mixedPayments[1].amount,
                claimDate: mixedPayments[1].claimableDate,
                memo: mixedPayments[1].memo
            };

            await time.increaseTo(mixedPayments[0].claimableDate);
            await merkleBatchPayout.claimPayment(claimedPayment, claimedProof);
            await merkleBatchPayout.connect(signer).cancelClaim(canceledPayment, canceledProof);

            const signerBalanceBefore = await mockToken.balanceOf(signer.address);
            await merkleBatchPayout.connect(signer).withdrawCanceledFunds(mixedBatchData.batchId);

            expect(await mockToken.balanceOf(signer.address)).to.equal(
                signerBalanceBefore + BigInt(mixedPayments[1].amount)
            );

            const batch = await merkleBatchPayout.getBatch(mixedBatchData.batchId);
            expect(batch.totalClaimed).to.equal(totalAmount);
            expect(batch.totalCanceled).to.equal(mixedPayments[1].amount);
        });
    });
});
