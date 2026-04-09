import { expect } from "chai";
import { ethers } from "hardhat";

describe("MultiSigFactory", function () {
    let factory: any;
    let creator: any;
    let owner2: any;
    let owner3: any;
    let otherUser: any;

    beforeEach(async function () {
        [creator, owner2, owner3, otherUser] = await ethers.getSigners();

        const MultiSigFactory = await ethers.getContractFactory("MultiSigFactory");
        factory = await MultiSigFactory.deploy();
        await factory.waitForDeployment();
    });

    it("Should create a wallet and register it for the creator", async function () {
        const owners = [creator.address, owner2.address, owner3.address];
        const predictedWallet = await factory.createWallet.staticCall(owners, 2, 2, 2);

        await expect(factory.connect(creator).createWallet(owners, 2, 2, 2))
            .to.emit(factory, "WalletCreated")
            .withArgs(predictedWallet, creator.address, owners, 2, 2, 2);

        expect(await factory.totalWallets()).to.equal(1);
        expect(await factory.isWallet(predictedWallet)).to.be.true;
        expect(await factory.allWallets(0)).to.equal(predictedWallet);

        const creatorWallets = await factory.getWalletsByCreator(creator.address);
        expect(creatorWallets).to.deep.equal([predictedWallet]);

        const wallet = await ethers.getContractAt("MultiSigWallet", predictedWallet);
        expect(await wallet.requiredConfirmations()).to.equal(2);
        expect(await wallet.getOwners()).to.deep.equal(owners);
    });

    it("Should keep separate wallet registries per creator", async function () {
        const creatorWallet = await factory.createWallet.staticCall(
            [creator.address, owner2.address],
            1, 1, 1
        );
        await factory.connect(creator).createWallet([creator.address, owner2.address], 1, 1, 1);

        const otherWallet = await factory.createWallet.staticCall(
            [otherUser.address, owner3.address],
            1, 1, 1
        );
        await factory.connect(otherUser).createWallet([otherUser.address, owner3.address], 1, 1, 1);

        expect(await factory.getWalletsByCreator(creator.address)).to.deep.equal([creatorWallet]);
        expect(await factory.getWalletsByCreator(otherUser.address)).to.deep.equal([otherWallet]);
        expect(await factory.getAllWallets()).to.deep.equal([creatorWallet, otherWallet]);
    });

    it("Should revert when no owners are provided", async function () {
        await expect(factory.createWallet([], 1, 1, 1)).to.be.revertedWith(
            "MultiSigFactory: no owners"
        );
    });

    it("Should revert when required confirmations are invalid", async function () {
        await expect(
            factory.createWallet([creator.address, owner2.address], 0, 1, 1)
        ).to.be.revertedWith("MultiSigFactory: invalid required confirmations");

        await expect(
            factory.createWallet([creator.address, owner2.address], 2, 1, 1)
        ).to.be.revertedWith("MultiSigFactory: invalid required confirmations");
    });

    it("Should bubble up wallet validation errors from duplicate owners", async function () {
        await expect(
            factory.createWallet([creator.address, creator.address], 1, 1, 1)
        ).to.be.revertedWith("MultiSig: duplicate owner");
    });
});