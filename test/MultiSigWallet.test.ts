import { expect } from "chai";
import { ethers } from "hardhat";

describe("MultiSigWallet", function () {
    let wallet: any;
    let token: any;
    let owner1: any;
    let owner2: any;
    let owner3: any;
    let recipient: any;
    let outsider: any;

    beforeEach(async function () {
        [owner1, owner2, owner3, recipient, outsider] = await ethers.getSigners();

        const MultiSigWallet = await ethers.getContractFactory("MultiSigWallet");
        wallet = await MultiSigWallet.deploy(
            [owner1.address, owner2.address, owner3.address],
            2, // requiredConfirmations
            2, // requiredOwnerChange
            2  // requiredRequirementChange
        );
        await wallet.waitForDeployment();

        const MockERC20 = await ethers.getContractFactory("MockERC20");
        token = await MockERC20.deploy(
            "Mock Token",
            "MTK",
            ethers.parseUnits("100000", 18)
        );
        await token.waitForDeployment();
    });

    describe("Deployment", function () {
        it("Should set owners and required confirmations", async function () {
            const owners = await wallet.getOwners();

            expect(owners).to.deep.equal([
                owner1.address,
                owner2.address,
                owner3.address,
            ]);
            expect(await wallet.requiredConfirmations()).to.equal(2);
            expect(await wallet.requiredOwnerChange()).to.equal(2);
            expect(await wallet.requiredRequirementChange()).to.equal(2);
            expect(await wallet.isOwner(owner1.address)).to.be.true;
            expect(await wallet.isOwner(owner2.address)).to.be.true;
            expect(await wallet.isOwner(owner3.address)).to.be.true;
        });

        it("Should revert with empty owners", async function () {
            const MultiSigWallet = await ethers.getContractFactory("MultiSigWallet");

            await expect(
                MultiSigWallet.deploy([], 1, 1, 1)
            ).to.be.revertedWith("MultiSig: no owners");
        });

        it("Should revert with duplicate owners", async function () {
            const MultiSigWallet = await ethers.getContractFactory("MultiSigWallet");

            await expect(
                MultiSigWallet.deploy([owner1.address, owner1.address], 1, 1, 1)
            ).to.be.revertedWith("MultiSig: duplicate owner");
        });

        it("Should revert when required confirmations exceed owner count", async function () {
            const MultiSigWallet = await ethers.getContractFactory("MultiSigWallet");

            await expect(
                MultiSigWallet.deploy([owner1.address, owner2.address], 3, 2, 2)
            ).to.be.revertedWith("MultiSig: invalid requiredConfirmations");
        });
    });

    describe("ETH Transactions", function () {
        beforeEach(async function () {
            await owner1.sendTransaction({
                to: await wallet.getAddress(),
                value: ethers.parseEther("5"),
            });
        });

        it("Should submit, confirm, and execute an ETH withdrawal", async function () {
            const amount = ethers.parseEther("1");

            await expect(
                wallet.connect(owner1).submitETHTransaction(recipient.address, amount, "0x")
            )
                .to.emit(wallet, "TransactionSubmitted")
                .withArgs(0, owner1.address, recipient.address, amount, ethers.ZeroAddress, "0x");

            await expect(wallet.connect(owner1).confirm(0))
                .to.emit(wallet, "TransactionConfirmed")
                .withArgs(0, owner1.address);

            await expect(wallet.connect(owner1).execute(0)).to.be.revertedWith(
                "MultiSig: not enough confirmations"
            );

            await expect(wallet.connect(owner2).confirm(0))
                .to.emit(wallet, "TransactionConfirmed")
                .withArgs(0, owner2.address);

            await expect(() => wallet.connect(owner3).execute(0)).to.changeEtherBalances(
                [wallet, recipient],
                [-amount, amount]
            );

            const txn = await wallet.getTransaction(0);
            expect(txn.executed).to.be.true;
            expect(txn.confirmationCount).to.equal(2);
        });

        it("Should allow revoking a confirmation before execution", async function () {
            const amount = ethers.parseEther("0.5");

            await wallet.connect(owner1).submitETHTransaction(recipient.address, amount, "0x");
            await wallet.connect(owner1).confirm(0);
            await wallet.connect(owner2).confirm(0);

            await expect(wallet.connect(owner2).revokeConfirmation(0))
                .to.emit(wallet, "ConfirmationRevoked")
                .withArgs(0, owner2.address);

            const txn = await wallet.getTransaction(0);
            expect(txn.confirmationCount).to.equal(1);

            await expect(wallet.connect(owner1).execute(0)).to.be.revertedWith(
                "MultiSig: not enough confirmations"
            );
        });

        it("Should reject non-owners from submitting or confirming", async function () {
            const amount = ethers.parseEther("0.25");

            await expect(
                wallet.connect(outsider).submitETHTransaction(recipient.address, amount, "0x")
            ).to.be.revertedWith("MultiSig: not an owner");

            await wallet.connect(owner1).submitETHTransaction(recipient.address, amount, "0x");

            await expect(wallet.connect(outsider).confirm(0)).to.be.revertedWith(
                "MultiSig: not an owner"
            );
        });

        it("Should reject duplicate confirmations", async function () {
            await wallet.connect(owner1).submitETHTransaction(recipient.address, ethers.parseEther("1"), "0x");
            await wallet.connect(owner1).confirm(0);

            await expect(wallet.connect(owner1).confirm(0)).to.be.revertedWith(
                "MultiSig: already confirmed"
            );
        });
    });

    describe("Token Transactions", function () {
        beforeEach(async function () {
            await token.transfer(await wallet.getAddress(), ethers.parseUnits("1000", 18));
        });

        it("Should execute an ERC20 withdrawal after threshold confirmations", async function () {
            const amount = ethers.parseUnits("250", 18);

            await expect(
                wallet
                    .connect(owner1)
                    .submitTokenTransaction(recipient.address, await token.getAddress(), amount, "0x")
            )
                .to.emit(wallet, "TransactionSubmitted")
                .withArgs(0, owner1.address, recipient.address, 0, await token.getAddress(), "0x");

            await wallet.connect(owner1).confirm(0);
            await wallet.connect(owner2).confirm(0);

            await expect(() => wallet.connect(owner3).execute(0)).to.changeTokenBalances(
                token,
                [wallet, recipient],
                [-amount, amount]
            );

            const txn = await wallet.getTransaction(0);
            expect(txn.token).to.equal(await token.getAddress());
            expect(txn.tokenAmount).to.equal(amount);
            expect(txn.executed).to.be.true;
        });

        it("Should reject token submissions when wallet balance is insufficient", async function () {
            await expect(
                wallet.connect(owner1).submitTokenTransaction(
                    recipient.address,
                    await token.getAddress(),
                    ethers.parseUnits("5000", 18),
                    "0x"
                )
            ).to.be.revertedWith("MultiSig: insufficient token balance");
        });
    });

    describe("Signature-Based Withdrawals", function () {
        beforeEach(async function () {
            await owner1.sendTransaction({
                to: await wallet.getAddress(),
                value: ethers.parseEther("5"),
            });
        });

        async function buildReceiptAndSignatures(
            tokenAddress: string,
            items: Array<{ to: string; value: bigint }>,
            batchId: bigint
        ) {
            const network = await ethers.provider.getNetwork();
            const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
                ["address", "uint256", "address", "tuple(address to,uint256 value)[]", "uint256"],
                [
                    await wallet.getAddress(),
                    network.chainId,
                    tokenAddress,
                    items,
                    batchId,
                ]
            );
            const receipt = ethers.keccak256(encoded);

            const signatures = await Promise.all([
                owner1.signMessage(ethers.getBytes(receipt)),
                owner2.signMessage(ethers.getBytes(receipt)),
                owner3.signMessage(ethers.getBytes(receipt)),
            ]);

            return { receipt, signatures };
        }

        it("Should withdraw ETH by verifying all owner signatures at once", async function () {
            const amount = ethers.parseEther("1");
            const items = [{ to: recipient.address, value: amount }];
            const batchId = 1n;
            const token = ethers.ZeroAddress;

            const { receipt, signatures } = await buildReceiptAndSignatures(token, items, batchId);

            await expect(() =>
                wallet
                    .connect(owner1)
                    .withdrawWithOwnerSignatures(token, items, batchId, signatures)
            ).to.changeEtherBalances([wallet, recipient], [-amount, amount]);

            expect(await wallet.isReceiptUsed(receipt)).to.equal(true);
            expect(await wallet.isBatchIdUsed(batchId)).to.equal(true);
            const receipts = await wallet.getWithdrawalReceipts();
            expect(receipts).to.deep.equal([receipt]);
            const batchIds = await wallet.getWithdrawalBatchIds();
            expect(batchIds).to.deep.equal([batchId]);
        });

        it("Should withdraw with the minimum required signatures (threshold)", async function () {
            const amount = ethers.parseEther("1");
            const items = [{ to: recipient.address, value: amount }];
            const batchId = 2n;
            const token = ethers.ZeroAddress;

            const { signatures: allSigs } = await buildReceiptAndSignatures(token, items, batchId);
            // Use only the required number of signatures (first 2 of 3)
            const thresholdSigs = allSigs.slice(0, 2);

            await expect(() =>
                wallet
                    .connect(owner1)
                    .withdrawWithOwnerSignatures(token, items, batchId, thresholdSigs)
            ).to.changeEtherBalances([wallet, recipient], [-amount, amount]);
        });

        it("Should reject withdrawal when signature count is below threshold", async function () {
            const amount = ethers.parseEther("1");
            const items = [{ to: recipient.address, value: amount }];
            const batchId = 3n;
            const token = ethers.ZeroAddress;

            const network = await ethers.provider.getNetwork();
            const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
                ["address", "uint256", "address", "tuple(address to,uint256 value)[]", "uint256"],
                [
                    await wallet.getAddress(),
                    network.chainId,
                    token,
                    items,
                    batchId,
                ]
            );
            const receipt = ethers.keccak256(encoded);

            const insufficientSignatures = await Promise.all([
                owner1.signMessage(ethers.getBytes(receipt)),
            ]);

            await expect(
                wallet
                    .connect(owner1)
                    .withdrawWithOwnerSignatures(token, items, batchId, insufficientSignatures)
            ).to.be.revertedWith("MultiSig: insufficient signatures");
        });

        it("Should reject signatures built with a stale/future batchId", async function () {
            const amount = ethers.parseEther("1");
            const items = [{ to: recipient.address, value: amount }];
            const signedBatchId = 3n;
            const callBatchId = 4n;
            const token = ethers.ZeroAddress;

            const { signatures } = await buildReceiptAndSignatures(token, items, signedBatchId);

            await expect(
                wallet
                    .connect(owner1)
                    .withdrawWithOwnerSignatures(token, items, callBatchId, signatures)
            ).to.be.revertedWith("MultiSig: invalid signer");
        });

        it("Should reject replaying old signatures after nonce advances", async function () {
            const amount = ethers.parseEther("1");
            const items = [{ to: recipient.address, value: amount }];
            const batchId = 5n;
            const token = ethers.ZeroAddress;

            const { signatures } = await buildReceiptAndSignatures(token, items, batchId);

            await wallet
                .connect(owner1)
                .withdrawWithOwnerSignatures(token, items, batchId, signatures);

            await expect(
                wallet
                    .connect(owner1)
                    .withdrawWithOwnerSignatures(token, items, batchId, signatures)
            ).to.be.revertedWith("MultiSig: batchId already used");
        });
    });

    describe("Governance", function () {
        async function buildAddOwnerSigs(newOwner: string, batchId: bigint) {
            const network = await ethers.provider.getNetwork();
            const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
                ["address", "uint256", "string", "address", "uint256"],
                [await wallet.getAddress(), network.chainId, "addOwner", newOwner, batchId]
            );
            const receipt = ethers.keccak256(encoded);
            const signatures = await Promise.all([
                owner1.signMessage(ethers.getBytes(receipt)),
                owner2.signMessage(ethers.getBytes(receipt)),
            ]);
            return { receipt, signatures };
        }

        async function buildRemoveOwnerSigs(ownerAddr: string, batchId: bigint) {
            const network = await ethers.provider.getNetwork();
            const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
                ["address", "uint256", "string", "address", "uint256"],
                [await wallet.getAddress(), network.chainId, "removeOwner", ownerAddr, batchId]
            );
            const receipt = ethers.keccak256(encoded);
            const signatures = await Promise.all([
                owner1.signMessage(ethers.getBytes(receipt)),
                owner2.signMessage(ethers.getBytes(receipt)),
            ]);
            return { receipt, signatures };
        }

        async function buildChangeReqSigs(
            newConf: bigint,
            newOwnerChange: bigint,
            newReqChange: bigint,
            batchId: bigint
        ) {
            const network = await ethers.provider.getNetwork();
            const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
                ["address", "uint256", "string", "uint256", "uint256", "uint256", "uint256"],
                [
                    await wallet.getAddress(),
                    network.chainId,
                    "changeRequirements",
                    newConf,
                    newOwnerChange,
                    newReqChange,
                    batchId,
                ]
            );
            const receipt = ethers.keccak256(encoded);
            const signatures = await Promise.all([
                owner1.signMessage(ethers.getBytes(receipt)),
                owner2.signMessage(ethers.getBytes(receipt)),
            ]);
            return { receipt, signatures };
        }

        it("Should add a new owner with sufficient signatures", async function () {
            const batchId = 10n;
            const { signatures } = await buildAddOwnerSigs(outsider.address, batchId);

            await expect(
                wallet.connect(owner1).addOwnerWithSignatures(outsider.address, batchId, signatures)
            ).to.emit(wallet, "OwnerAdded").withArgs(outsider.address);

            expect(await wallet.isOwner(outsider.address)).to.be.true;
            expect((await wallet.getOwners()).length).to.equal(4);
        });

        it("Should reject adding owner with insufficient signatures", async function () {
            const batchId = 11n;
            const network = await ethers.provider.getNetwork();
            const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
                ["address", "uint256", "string", "address", "uint256"],
                [await wallet.getAddress(), network.chainId, "addOwner", outsider.address, batchId]
            );
            const receipt = ethers.keccak256(encoded);
            const singleSig = [await owner1.signMessage(ethers.getBytes(receipt))];

            await expect(
                wallet.connect(owner1).addOwnerWithSignatures(outsider.address, batchId, singleSig)
            ).to.be.revertedWith("MultiSig: insufficient signatures");
        });

        it("Should remove an existing owner with sufficient signatures", async function () {
            // Deploy a 4-owner wallet so removing one still leaves 3 > requiredOwnerChange(2)
            const MultiSigWallet4 = await ethers.getContractFactory("MultiSigWallet");
            const wallet4 = await MultiSigWallet4.deploy(
                [owner1.address, owner2.address, owner3.address, recipient.address],
                2, 2, 2
            );
            await wallet4.waitForDeployment();

            const batchId = 12n;
            const network = await ethers.provider.getNetwork();
            const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
                ["address", "uint256", "string", "address", "uint256"],
                [await wallet4.getAddress(), network.chainId, "removeOwner", owner3.address, batchId]
            );
            const receipt = ethers.keccak256(encoded);
            const sigs = await Promise.all([
                owner1.signMessage(ethers.getBytes(receipt)),
                owner2.signMessage(ethers.getBytes(receipt)),
            ]);

            await expect(
                wallet4.connect(owner1).removeOwnerWithSignatures(owner3.address, batchId, sigs)
            ).to.emit(wallet4, "OwnerRemoved").withArgs(owner3.address);

            expect(await wallet4.isOwner(owner3.address)).to.be.false;
            expect((await wallet4.getOwners()).length).to.equal(3);
        });

        it("Should reject removing an owner when it would violate a required threshold", async function () {
            // 3 owners, required=2: removing any owner would leave 2 owners
            // and 2 is NOT > 2 (strict less-than constraint) → must revert
            const batchId = 20n;
            const { signatures } = await buildRemoveOwnerSigs(owner3.address, batchId);
            await expect(
                wallet.connect(owner1).removeOwnerWithSignatures(owner3.address, batchId, signatures)
            ).to.be.revertedWith("MultiSig: would break requiredConfirmations");
        });

        it("Should change all three required thresholds with sufficient signatures", async function () {
            const batchId = 30n;
            const { signatures } = await buildChangeReqSigs(1n, 2n, 2n, batchId);

            await expect(
                wallet.connect(owner1).changeRequirementsWithSignatures(1n, 2n, 2n, batchId, signatures)
            ).to.emit(wallet, "RequirementChanged").withArgs(1n, 2n, 2n);

            expect(await wallet.requiredConfirmations()).to.equal(1n);
            expect(await wallet.requiredOwnerChange()).to.equal(2n);
            expect(await wallet.requiredRequirementChange()).to.equal(2n);
        });

        it("Should reject requirement change with an out-of-range value", async function () {
            const batchId = 31n;
            const { signatures } = await buildChangeReqSigs(5n, 2n, 2n, batchId); // 5 > 3 owners

            await expect(
                wallet.connect(owner1).changeRequirementsWithSignatures(5n, 2n, 2n, batchId, signatures)
            ).to.be.revertedWith("MultiSig: invalid requiredConfirmations");
        });
    });
});