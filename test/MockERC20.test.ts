import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";

describe("MockERC20", function () {
    let mockToken;
    let owner;
    let spender;
    let recipient;
    let domain;
    let permitTypes;

    const INITIAL_SUPPLY = ethers.parseUnits("10000", 18);
    const TOKEN_NAME = "Mock Token";
    const TOKEN_SYMBOL = "MTK";

    beforeEach(async function () {
        [owner, spender, recipient] = await ethers.getSigners();

        // Deploy MockERC20
        const MockToken = await ethers.getContractFactory("MockERC20");
        mockToken = await MockToken.deploy(TOKEN_NAME, TOKEN_SYMBOL, INITIAL_SUPPLY);
        await mockToken.waitForDeployment();

        // Setup EIP-712 domain
        domain = {
            name: TOKEN_NAME,
            version: "1",
            chainId: (await ethers.provider.getNetwork()).chainId,
            verifyingContract: await mockToken.getAddress(),
        };

        // Setup permit types
        permitTypes = {
            Permit: [
                { name: "owner", type: "address" },
                { name: "spender", type: "address" },
                { name: "value", type: "uint256" },
                { name: "nonce", type: "uint256" },
                { name: "deadline", type: "uint256" },
            ],
        };
    });

    describe("Deployment", function () {
        it("Should set the correct name", async function () {
            expect(await mockToken.name()).to.equal(TOKEN_NAME);
        });

        it("Should set the correct symbol", async function () {
            expect(await mockToken.symbol()).to.equal(TOKEN_SYMBOL);
        });

        it("Should set the correct decimals", async function () {
            expect(await mockToken.decimals()).to.equal(18);
        });

        it("Should mint initial supply to deployer", async function () {
            expect(await mockToken.balanceOf(owner.address)).to.equal(INITIAL_SUPPLY);
        });

        it("Should set the correct total supply", async function () {
            expect(await mockToken.totalSupply()).to.equal(INITIAL_SUPPLY);
        });
    });

    describe("Basic ERC20 Functionality", function () {
        it("Should transfer tokens correctly", async function () {
            const amount = ethers.parseUnits("100", 18);

            await expect(mockToken.transfer(recipient.address, amount))
                .to.emit(mockToken, "Transfer")
                .withArgs(owner.address, recipient.address, amount);

            expect(await mockToken.balanceOf(recipient.address)).to.equal(amount);
            expect(await mockToken.balanceOf(owner.address)).to.equal(INITIAL_SUPPLY - amount);
        });

        it("Should approve tokens correctly", async function () {
            const amount = ethers.parseUnits("100", 18);

            await expect(mockToken.approve(spender.address, amount))
                .to.emit(mockToken, "Approval")
                .withArgs(owner.address, spender.address, amount);

            expect(await mockToken.allowance(owner.address, spender.address)).to.equal(amount);
        });

        it("Should transferFrom tokens correctly", async function () {
            const amount = ethers.parseUnits("100", 18);

            await mockToken.approve(spender.address, amount);

            await expect(mockToken.connect(spender).transferFrom(owner.address, recipient.address, amount))
                .to.emit(mockToken, "Transfer")
                .withArgs(owner.address, recipient.address, amount);

            expect(await mockToken.balanceOf(recipient.address)).to.equal(amount);
            expect(await mockToken.allowance(owner.address, spender.address)).to.equal(0);
        });

        it("Should revert on insufficient balance", async function () {
            const amount = INITIAL_SUPPLY + 1n;

            await expect(
                mockToken.transfer(recipient.address, amount)
            ).to.be.revertedWithCustomError(mockToken, "ERC20InsufficientBalance");
        });

        it("Should revert on insufficient allowance", async function () {
            const amount = ethers.parseUnits("100", 18);

            await expect(
                mockToken.connect(spender).transferFrom(owner.address, recipient.address, amount)
            ).to.be.revertedWithCustomError(mockToken, "ERC20InsufficientAllowance");
        });
    });

    describe("Minting", function () {
        it("Should mint tokens to address", async function () {
            const amount = ethers.parseUnits("1000", 18);

            await expect(mockToken.mint(recipient.address, amount))
                .to.emit(mockToken, "Transfer")
                .withArgs(ethers.ZeroAddress, recipient.address, amount);

            expect(await mockToken.balanceOf(recipient.address)).to.equal(amount);
            expect(await mockToken.totalSupply()).to.equal(INITIAL_SUPPLY + amount);
        });

        it("Should allow anyone to mint (testing only)", async function () {
            const amount = ethers.parseUnits("500", 18);

            await expect(mockToken.connect(spender).mint(recipient.address, amount))
                .to.emit(mockToken, "Transfer")
                .withArgs(ethers.ZeroAddress, recipient.address, amount);

            expect(await mockToken.balanceOf(recipient.address)).to.equal(amount);
        });
    });

    describe("EIP-712 Domain Separator", function () {
        it("Should return correct domain separator", async function () {
            const domainSeparator = await mockToken.DOMAIN_SEPARATOR();
            expect(domainSeparator).to.be.properHex(64);
        });

        it("Should have consistent domain separator", async function () {
            const separator1 = await mockToken.DOMAIN_SEPARATOR();
            const separator2 = await mockToken.DOMAIN_SEPARATOR();
            expect(separator1).to.equal(separator2);
        });
    });

    describe("Nonces", function () {
        it("Should start with nonce 0", async function () {
            expect(await mockToken.nonces(owner.address)).to.equal(0);
        });

        it("Should increment nonce after permit", async function () {
            const amount = ethers.parseUnits("100", 18);
            const deadline = (await time.latest()) + 3600;
            const nonce = await mockToken.nonces(owner.address);

            const permitValue = {
                owner: owner.address,
                spender: spender.address,
                value: amount,
                nonce: nonce,
                deadline: deadline,
            };

            const signature = await owner.signTypedData(domain, permitTypes, permitValue);
            const { v, r, s } = ethers.Signature.from(signature);

            await mockToken.permit(owner.address, spender.address, amount, deadline, v, r, s);

            expect(await mockToken.nonces(owner.address)).to.equal(1);
        });

        it("Should track different nonces for different addresses", async function () {
            const amount = ethers.parseUnits("100", 18);
            const deadline = (await time.latest()) + 3600;

            // Owner permits
            const ownerNonce = await mockToken.nonces(owner.address);
            const ownerPermitValue = {
                owner: owner.address,
                spender: spender.address,
                value: amount,
                nonce: ownerNonce,
                deadline: deadline,
            };
            const ownerSignature = await owner.signTypedData(domain, permitTypes, ownerPermitValue);
            const ownerSig = ethers.Signature.from(ownerSignature);
            await mockToken.permit(owner.address, spender.address, amount, deadline, ownerSig.v, ownerSig.r, ownerSig.s);

            // Recipient permits (needs to have tokens first)
            await mockToken.mint(recipient.address, amount);
            const recipientNonce = await mockToken.nonces(recipient.address);
            const recipientPermitValue = {
                owner: recipient.address,
                spender: spender.address,
                value: amount,
                nonce: recipientNonce,
                deadline: deadline,
            };
            const recipientSignature = await recipient.signTypedData(domain, permitTypes, recipientPermitValue);
            const recipientSig = ethers.Signature.from(recipientSignature);
            await mockToken.permit(recipient.address, spender.address, amount, deadline, recipientSig.v, recipientSig.r, recipientSig.s);

            expect(await mockToken.nonces(owner.address)).to.equal(1);
            expect(await mockToken.nonces(recipient.address)).to.equal(1);
            expect(await mockToken.nonces(spender.address)).to.equal(0); // Never used permit
        });
    });

    describe("Permit - Gasless Approvals", function () {
        it("Should approve tokens using permit signature", async function () {
            const amount = ethers.parseUnits("100", 18);
            const deadline = (await time.latest()) + 3600;
            const nonce = await mockToken.nonces(owner.address);

            const permitValue = {
                owner: owner.address,
                spender: spender.address,
                value: amount,
                nonce: nonce,
                deadline: deadline,
            };

            const signature = await owner.signTypedData(domain, permitTypes, permitValue);
            const { v, r, s } = ethers.Signature.from(signature);

            await expect(
                mockToken.permit(owner.address, spender.address, amount, deadline, v, r, s)
            )
                .to.emit(mockToken, "Approval")
                .withArgs(owner.address, spender.address, amount);

            expect(await mockToken.allowance(owner.address, spender.address)).to.equal(amount);
        });

        it("Should allow spender to execute permit on behalf of owner", async function () {
            const amount = ethers.parseUnits("100", 18);
            const deadline = (await time.latest()) + 3600;
            const nonce = await mockToken.nonces(owner.address);

            const permitValue = {
                owner: owner.address,
                spender: spender.address,
                value: amount,
                nonce: nonce,
                deadline: deadline,
            };

            const signature = await owner.signTypedData(domain, permitTypes, permitValue);
            const { v, r, s } = ethers.Signature.from(signature);

            // Spender executes permit (gasless for owner)
            await mockToken.connect(spender).permit(owner.address, spender.address, amount, deadline, v, r, s);

            expect(await mockToken.allowance(owner.address, spender.address)).to.equal(amount);
        });

        it("Should allow transferFrom after permit", async function () {
            const amount = ethers.parseUnits("100", 18);
            const deadline = (await time.latest()) + 3600;
            const nonce = await mockToken.nonces(owner.address);

            const permitValue = {
                owner: owner.address,
                spender: spender.address,
                value: amount,
                nonce: nonce,
                deadline: deadline,
            };

            const signature = await owner.signTypedData(domain, permitTypes, permitValue);
            const { v, r, s } = ethers.Signature.from(signature);

            await mockToken.permit(owner.address, spender.address, amount, deadline, v, r, s);

            await expect(
                mockToken.connect(spender).transferFrom(owner.address, recipient.address, amount)
            )
                .to.emit(mockToken, "Transfer")
                .withArgs(owner.address, recipient.address, amount);

            expect(await mockToken.balanceOf(recipient.address)).to.equal(amount);
        });

        it("Should revert with expired deadline", async function () {
            const amount = ethers.parseUnits("100", 18);
            const deadline = (await time.latest()) - 1; // Past deadline
            const nonce = await mockToken.nonces(owner.address);

            const permitValue = {
                owner: owner.address,
                spender: spender.address,
                value: amount,
                nonce: nonce,
                deadline: deadline,
            };

            const signature = await owner.signTypedData(domain, permitTypes, permitValue);
            const { v, r, s } = ethers.Signature.from(signature);

            await expect(
                mockToken.permit(owner.address, spender.address, amount, deadline, v, r, s)
            ).to.be.revertedWithCustomError(mockToken, "ERC2612ExpiredSignature");
        });

        it("Should revert with invalid signature", async function () {
            const amount = ethers.parseUnits("100", 18);
            const deadline = (await time.latest()) + 3600;
            const nonce = await mockToken.nonces(owner.address);

            const permitValue = {
                owner: owner.address,
                spender: spender.address,
                value: amount,
                nonce: nonce,
                deadline: deadline,
            };

            // Sign with wrong signer
            const signature = await spender.signTypedData(domain, permitTypes, permitValue);
            const { v, r, s } = ethers.Signature.from(signature);

            await expect(
                mockToken.permit(owner.address, spender.address, amount, deadline, v, r, s)
            ).to.be.revertedWithCustomError(mockToken, "ERC2612InvalidSigner");
        });

        it("Should revert with wrong nonce", async function () {
            const amount = ethers.parseUnits("100", 18);
            const deadline = (await time.latest()) + 3600;
            const wrongNonce = 5; // Not the actual nonce

            const permitValue = {
                owner: owner.address,
                spender: spender.address,
                value: amount,
                nonce: wrongNonce,
                deadline: deadline,
            };

            const signature = await owner.signTypedData(domain, permitTypes, permitValue);
            const { v, r, s } = ethers.Signature.from(signature);

            await expect(
                mockToken.permit(owner.address, spender.address, amount, deadline, v, r, s)
            ).to.be.revertedWithCustomError(mockToken, "ERC2612InvalidSigner");
        });

        it("Should prevent replay attacks", async function () {
            const amount = ethers.parseUnits("100", 18);
            const deadline = (await time.latest()) + 3600;
            const nonce = await mockToken.nonces(owner.address);

            const permitValue = {
                owner: owner.address,
                spender: spender.address,
                value: amount,
                nonce: nonce,
                deadline: deadline,
            };

            const signature = await owner.signTypedData(domain, permitTypes, permitValue);
            const { v, r, s } = ethers.Signature.from(signature);

            // First permit succeeds
            await mockToken.permit(owner.address, spender.address, amount, deadline, v, r, s);

            // Second permit with same signature fails (nonce has incremented)
            await expect(
                mockToken.permit(owner.address, spender.address, amount, deadline, v, r, s)
            ).to.be.revertedWithCustomError(mockToken, "ERC2612InvalidSigner");
        });

        it("Should handle multiple permits with sequential nonces", async function () {
            const amount1 = ethers.parseUnits("100", 18);
            const amount2 = ethers.parseUnits("200", 18);
            const deadline = (await time.latest()) + 3600;

            // First permit
            const nonce1 = await mockToken.nonces(owner.address);
            const permitValue1 = {
                owner: owner.address,
                spender: spender.address,
                value: amount1,
                nonce: nonce1,
                deadline: deadline,
            };
            const signature1 = await owner.signTypedData(domain, permitTypes, permitValue1);
            const sig1 = ethers.Signature.from(signature1);
            await mockToken.permit(owner.address, spender.address, amount1, deadline, sig1.v, sig1.r, sig1.s);

            // Second permit (nonce incremented)
            const nonce2 = await mockToken.nonces(owner.address);
            expect(nonce2).to.equal(1);

            const permitValue2 = {
                owner: owner.address,
                spender: recipient.address,
                value: amount2,
                nonce: nonce2,
                deadline: deadline,
            };
            const signature2 = await owner.signTypedData(domain, permitTypes, permitValue2);
            const sig2 = ethers.Signature.from(signature2);
            await mockToken.permit(owner.address, recipient.address, amount2, deadline, sig2.v, sig2.r, sig2.s);

            expect(await mockToken.allowance(owner.address, spender.address)).to.equal(amount1);
            expect(await mockToken.allowance(owner.address, recipient.address)).to.equal(amount2);
            expect(await mockToken.nonces(owner.address)).to.equal(2);
        });

        it("Should handle max uint256 approval", async function () {
            const amount = ethers.MaxUint256;
            const deadline = (await time.latest()) + 3600;
            const nonce = await mockToken.nonces(owner.address);

            const permitValue = {
                owner: owner.address,
                spender: spender.address,
                value: amount,
                nonce: nonce,
                deadline: deadline,
            };

            const signature = await owner.signTypedData(domain, permitTypes, permitValue);
            const { v, r, s } = ethers.Signature.from(signature);

            await mockToken.permit(owner.address, spender.address, amount, deadline, v, r, s);

            expect(await mockToken.allowance(owner.address, spender.address)).to.equal(ethers.MaxUint256);
        });
    });

    describe("Permit Integration", function () {
        it("Should enable complete gasless token transfer workflow", async function () {
            const amount = ethers.parseUnits("100", 18);
            const deadline = (await time.latest()) + 3600;
            const nonce = await mockToken.nonces(owner.address);

            // 1. Owner signs permit off-chain (no gas cost for owner)
            const permitValue = {
                owner: owner.address,
                spender: spender.address,
                value: amount,
                nonce: nonce,
                deadline: deadline,
            };
            const signature = await owner.signTypedData(domain, permitTypes, permitValue);
            const { v, r, s } = ethers.Signature.from(signature);

            // 2. Spender executes permit (pays gas)
            await mockToken.connect(spender).permit(owner.address, spender.address, amount, deadline, v, r, s);

            // 3. Spender transfers tokens from owner to recipient
            await mockToken.connect(spender).transferFrom(owner.address, recipient.address, amount);

            // Verify final state
            expect(await mockToken.balanceOf(recipient.address)).to.equal(amount);
            expect(await mockToken.balanceOf(owner.address)).to.equal(INITIAL_SUPPLY - amount);
            expect(await mockToken.allowance(owner.address, spender.address)).to.equal(0);
        });
    });
});
