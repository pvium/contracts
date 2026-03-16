import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { SmartEscrowFactory, SmartEscrow, MockERC20 } from "../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

describe("SmartEscrow System", function () {
    let factory: SmartEscrowFactory;
    let mockUSDC: MockERC20;
    let mockUSDT: MockERC20;

    let pvium: HardhatEthersSigner;
    let appOwner: HardhatEthersSigner;
    let projectOwner: HardhatEthersSigner;
    let vendor1: HardhatEthersSigner;
    let vendor2: HardhatEthersSigner;
    let relayer: HardhatEthersSigner;

    const PVIUM_FEE_BPS = 100; // 1%
    const APP_FEE_BPS = 200;    // 2%
    const DISPUTE_WINDOW = 3 * 24 * 60 * 60; // 3 days
    const INITIAL_SUPPLY = ethers.parseUnits("1000000", 6); // 1M USDC/USDT
    const SIGNATURE_DOMAIN = ethers.id("PVIUM_SIGNATURE_MESSAGE");

    // Empty CallSignature for direct calls (no signature needed)
    const EMPTY_CALL_SIG = {
        payload: "0x",
        nonce: 0,
        signature: "0x"
    };

    beforeEach(async function () {
        [pvium, appOwner, projectOwner, vendor1, vendor2, relayer] = await ethers.getSigners();

        // Deploy mock tokens (USDC/USDT use 6 decimals)
        const MockToken = await ethers.getContractFactory("MockERC20");
        mockUSDC = await MockToken.deploy("USD Coin", "USDC", INITIAL_SUPPLY);
        await mockUSDC.waitForDeployment();

        mockUSDT = await MockToken.deploy("Tether USD", "USDT", INITIAL_SUPPLY);
        await mockUSDT.waitForDeployment();

        // Deploy deployer contract
        const Deployer = await ethers.getContractFactory("SmartEscrowDeployer");
        const deployer = await Deployer.deploy();
        await deployer.waitForDeployment();

        // Deploy factory with admin address and fee address
        const Factory = await ethers.getContractFactory("SmartEscrowFactory");
        factory = await Factory.deploy(
            PVIUM_FEE_BPS,
            pvium.address,
            pvium.address,
            await deployer.getAddress()
        );
        await factory.waitForDeployment();

        // Give project owner some tokens
        await mockUSDC.mint(projectOwner.address, ethers.parseUnits("100000", 6));
        await mockUSDT.mint(projectOwner.address, ethers.parseUnits("100000", 6));
    });

    describe("Factory Deployment", function () {
        it("Should set correct Pvium fee and address", async function () {
            expect(await factory.pviumFeeBps()).to.equal(PVIUM_FEE_BPS);
            expect(await factory.pviumFeeAddress()).to.equal(pvium.address);
        });

        it("Should allow Pvium to update fee", async function () {
            const newFee = 150;
            await expect(factory.connect(pvium).updatePviumFee(newFee))
                .to.emit(factory, "PviumFeeUpdated")
                .withArgs(PVIUM_FEE_BPS, newFee);

            expect(await factory.pviumFeeBps()).to.equal(newFee);
        });

        it("Should allow Pvium to update fee address", async function () {
            const newPviumFeeAddress = relayer.address;
            await expect(factory.connect(pvium).updatePviumFeeAddress(newPviumFeeAddress))
                .to.emit(factory, "PviumFeeAddressUpdated")
                .withArgs(pvium.address, newPviumFeeAddress);

            expect(await factory.pviumFeeAddress()).to.equal(newPviumFeeAddress);
        });

        it("Should reject non-Pvium admin fee update", async function () {
            await expect(
                factory.connect(appOwner).updatePviumFee(150)
            ).to.be.reverted;
        });

        it("Should allow granting and revoking admin roles", async function () {
            // Grant PVIUM_ADMIN_ROLE to appOwner (for attestations)
            await expect(factory.connect(pvium).grantPviumAdmin(appOwner.address))
                .to.emit(factory, "PviumAdminGranted")
                .withArgs(appOwner.address);

            // Verify appOwner CANNOT update fees (requires DEFAULT_ADMIN_ROLE, not PVIUM_ADMIN_ROLE)
            await expect(
                factory.connect(appOwner).updatePviumFee(125)
            ).to.be.reverted;

            // Verify pvium (who has DEFAULT_ADMIN_ROLE) CAN update fees
            const newFee = 125;
            await expect(factory.connect(pvium).updatePviumFee(newFee))
                .to.emit(factory, "PviumFeeUpdated")
                .withArgs(PVIUM_FEE_BPS, newFee);

            // Revoke PVIUM_ADMIN_ROLE from appOwner
            await expect(factory.connect(pvium).revokePviumAdmin(appOwner.address))
                .to.emit(factory, "PviumAdminRevoked")
                .withArgs(appOwner.address);
        });
    });

    describe("Project Creation", function () {
        it("Should create project with valid signature", async function () {
            const appId = "test-app";
            const projectId = "project-001";
            const metadata = "ipfs://Qm...";
            const lockDurationSeconds =
              (await time.latest()) + 90 * 24 * 60 * 60; // 90 days
            const minBalance = ethers.parseUnits('100', 6); // $100 per vendor
            const maxVendors = 10;

            const payload = {
              app: appId,
              projectId: projectId,
              metadata: metadata,
              tokenAddress: await mockUSDC.getAddress(),
              refundAddress: projectOwner.address,
              appFeeAddress: appOwner.address,
              appAdminAddress: appOwner.address,
              appFeeBps: APP_FEE_BPS,
              disputeWindowSeconds: DISPUTE_WINDOW,
              lockDurationSeconds: lockDurationSeconds,
              minimumBalancePerVendor: minBalance,
              maxNumVendors: maxVendors,
            };

            const chainId = (await ethers.provider.getNetwork()).chainId;

            // App signs the payload
            const appMessageHash = ethers.keccak256(
              ethers.AbiCoder.defaultAbiCoder().encode(
                [
                  'bytes32',
                  'string',
                  'string',
                  'string',
                  'address',
                  'address',
                  'address',
                  'address',
                  'uint256',
                  'uint256',
                  'uint256',
                  'uint256',
                  'uint256',
                  'uint256',
                ],
                [
                  SIGNATURE_DOMAIN,
                  payload.app,
                  payload.projectId,
                  payload.metadata,
                  payload.tokenAddress,
                  payload.refundAddress,
                  payload.appFeeAddress,
                  payload.appAdminAddress,
                  payload.appFeeBps,
                  payload.disputeWindowSeconds,
                  payload.lockDurationSeconds,
                  payload.minimumBalancePerVendor,
                  PVIUM_FEE_BPS,
                  chainId,
                ],
              ),
            );
            const appSignature = await appOwner.signMessage(ethers.getBytes(appMessageHash));

            // Pvium attests the app owner
            const pviumMessageHash = ethers.keccak256(
                ethers.AbiCoder.defaultAbiCoder().encode(
                    ["bytes32", "bytes", "uint256"],
                    [SIGNATURE_DOMAIN, appSignature, chainId]
                )
            );
            const pviumSignature = await pvium.signMessage(ethers.getBytes(pviumMessageHash));

            await expect(factory.createProject(payload, appSignature, pviumSignature))
                .to.emit(factory, "EscrowContractCreated");

            const projectAddress = await factory.getProjectByUniqueId(appId, projectId);
            expect(projectAddress).to.not.equal(ethers.ZeroAddress);
        });

        it("Should reject duplicate project creation", async function () {
            const appId = "test-app";
            const projectId = "project-001";
            const metadata ="ipfs://Qm...";
            const lockDurationSeconds = 90 * 24 * 60 * 60; // duration the project will be locked before

            const payload = {
              app: appId,
              projectId: projectId,
              metadata: metadata,
              tokenAddress: await mockUSDC.getAddress(),
              refundAddress: projectOwner.address,
              appFeeAddress: appOwner.address,
              appAdminAddress: appOwner.address,
              appFeeBps: APP_FEE_BPS,
              disputeWindowSeconds: DISPUTE_WINDOW,
              lockDurationSeconds: lockDurationSeconds,
              minimumBalancePerVendor: ethers.parseUnits('100', 6),
              maxNumVendors: 10,
            };

            const chainId = (await ethers.provider.getNetwork()).chainId;

            // App signs the payload
            const appMessageHash = ethers.keccak256(
              ethers.AbiCoder.defaultAbiCoder().encode(
                [
                  'bytes32',
                  'string',
                  'string',
                  'string',
                  'address',
                  'address',
                  'address',
                  'address',
                  'uint256',
                  'uint256',
                  'uint256',
                  'uint256',
                  'uint256',
                  'uint256',
                ],
                [
                  SIGNATURE_DOMAIN,
                  payload.app,
                  payload.projectId,
                  payload.metadata,
                  payload.tokenAddress,
                  payload.refundAddress,
                  payload.appFeeAddress,
                  payload.appAdminAddress,
                  payload.appFeeBps,
                  payload.disputeWindowSeconds,
                  payload.lockDurationSeconds,
                  payload.minimumBalancePerVendor,
                  PVIUM_FEE_BPS,
                  chainId,
                ],
              ),
            );
            const appSignature = await appOwner.signMessage(ethers.getBytes(appMessageHash));

            // Pvium attests the app owner
            const pviumMessageHash = ethers.keccak256(
                ethers.AbiCoder.defaultAbiCoder().encode(
                    ["bytes32", "bytes", "uint256"],
                    [SIGNATURE_DOMAIN, appSignature, chainId]
                )
            );
            const pviumSignature = await pvium.signMessage(ethers.getBytes(pviumMessageHash));

            // First creation succeeds
            await factory.createProject(payload, appSignature, pviumSignature);

            // Second creation fails
            await expect(
                factory.createProject(payload, appSignature, pviumSignature)
            ).to.be.revertedWith("Project exists");
        });
    });

    async function createTestProject(
        appId: string,
        projectId: string,
        tokenAddress: string,
        minBalance: bigint = ethers.parseUnits("100", 6),
        maxVendors: number = 10
    ): Promise<string> {
        const metadata = "ipfs://test";
        const lockDurationSeconds = (await time.latest()) + 90 * 24 * 60 * 60;

        const payload = {
          app: appId,
          projectId: projectId,
          metadata: metadata,
          tokenAddress,
          refundAddress: projectOwner.address,
          appFeeAddress: appOwner.address,
          appAdminAddress: appOwner.address,
          appFeeBps: APP_FEE_BPS,
          disputeWindowSeconds: DISPUTE_WINDOW,
          lockDurationSeconds: lockDurationSeconds,
          minimumBalancePerVendor: minBalance,
          maxNumVendors: maxVendors,
        };

        const chainId = (await ethers.provider.getNetwork()).chainId;

        // App signs the payload
        const appMessageHash = ethers.keccak256(
          ethers.AbiCoder.defaultAbiCoder().encode(
            [
              'bytes32',
              'string',
              'string',
              'string',
              'address',
              'address',
              'address',
              'address',
              'uint256',
              'uint256',
              'uint256',
              'uint256',
              'uint256',
              'uint256',
            ],
            [
              SIGNATURE_DOMAIN,
              payload.app,
              payload.projectId,
              payload.metadata,
              payload.tokenAddress,
              payload.refundAddress,
              payload.appFeeAddress,
              payload.appAdminAddress,
              payload.appFeeBps,
              payload.disputeWindowSeconds,
              payload.lockDurationSeconds,
              payload.minimumBalancePerVendor,
              PVIUM_FEE_BPS,
              chainId,
            ],
          ),
        );
        const appSignature = await appOwner.signMessage(ethers.getBytes(appMessageHash));

        // Pvium attests the app owner
        const pviumMessageHash = ethers.keccak256(
            ethers.AbiCoder.defaultAbiCoder().encode(
                ["bytes32", "bytes", "uint256"],
                [SIGNATURE_DOMAIN, appSignature, chainId]
            )
        );
        const pviumSignature = await pvium.signMessage(ethers.getBytes(pviumMessageHash));

        await factory.createProject(payload, appSignature, pviumSignature);

        return await factory.getProjectByUniqueId(appId, projectId);
    }

    describe("Project Funding and Activation", function () {
        let projectAddress: string;
        let project: SmartEscrow;

        beforeEach(async function () {
            projectAddress = await createTestProject(
                "test-app",
                "project-001",
                await mockUSDC.getAddress()
            );
            project = await ethers.getContractAt("SmartEscrow", projectAddress);
        });

        it("Should allow funding the project", async function () {
            const fundAmount = ethers.parseUnits("1000", 6);

            await mockUSDC.connect(projectOwner).approve(projectAddress, fundAmount);

            await expect(project.connect(projectOwner).fundProject(fundAmount))
                .to.emit(project, "ProjectFunded")
                .withArgs(projectOwner.address, fundAmount);

            expect(await mockUSDC.balanceOf(projectAddress)).to.equal(fundAmount);
        });

        it("Should reject zero amount funding", async function () {
            await expect(
                project.connect(projectOwner).fundProject(0)
            ).to.be.revertedWith("Amount must be greater than 0");
        });

        it("Should allow adding vendors before activation", async function () {
            const vendors = [vendor1.address, vendor2.address];

            await expect(project.connect(appOwner).addVendors(vendors, EMPTY_CALL_SIG))
                .to.emit(project, "VendorsAdded")
                .withArgs(vendors);

            expect(await project.approvedVendors(vendor1.address)).to.be.true;
            expect(await project.approvedVendors(vendor2.address)).to.be.true;
            expect(await project.getVendorCount()).to.equal(2);
        });

        it("Should allow adding vendors with valid relayed signature", async function () {
            const vendors = [vendor1.address, vendor2.address];
            const nonce = 1; // Must be > 0 for relayed calls

            // Get project details
            const appId = await project.appId();
            const projectId = await project.projectId();
            const chainId = (await ethers.provider.getNetwork()).chainId;

            // Create payload for addVendors
            const payload = ethers.AbiCoder.defaultAbiCoder().encode(
                ["string", "address[]"],
                ["addVendors", vendors]
            );

            // App admin signs the call
            const messageHash = ethers.keccak256(
                ethers.AbiCoder.defaultAbiCoder().encode(
                    ["string", "string", "bytes", "uint256", "uint256"],
                    [appId, projectId, payload, nonce, chainId]
                )
            );
            const signature = await appOwner.signMessage(ethers.getBytes(messageHash));

            const callSig = {
                nonce: nonce,
                signature: signature
            };

            // Relayer submits the transaction
            await expect(project.connect(relayer).addVendors(vendors, callSig))
                .to.emit(project, "VendorsAdded")
                .withArgs(vendors);

            expect(await project.approvedVendors(vendor1.address)).to.be.true;
            expect(await project.approvedVendors(vendor2.address)).to.be.true;
            expect(await project.getVendorCount()).to.equal(2);

            // Verify nonce was consumed
            expect(await project.consumedNonce(relayer.address, nonce)).to.be.true;
        });

        it("Should reject adding vendors with invalid signature", async function () {
            const vendors = [vendor1.address, vendor2.address];
            const nonce = 1;

            const appId = await project.appId();
            const projectId = await project.projectId();
            const chainId = (await ethers.provider.getNetwork()).chainId;

            const payload = ethers.AbiCoder.defaultAbiCoder().encode(
                ["string", "address[]"],
                ["addVendors", vendors]
            );

            // Wrong signer (not an app admin)
            const messageHash = ethers.keccak256(
                ethers.AbiCoder.defaultAbiCoder().encode(
                    ["string", "string", "bytes", "uint256", "uint256"],
                    [appId, projectId, payload, nonce, chainId]
                )
            );
            const signature = await vendor1.signMessage(ethers.getBytes(messageHash));

            const callSig = {
                payload: payload,
                nonce: nonce,
                signature: signature
            };

            await expect(
                project.connect(relayer).addVendors(vendors, callSig)
            ).to.be.revertedWith("Invalid app admin signature");
        });

        it("Should reject reused nonce", async function () {
            const vendors = [vendor1.address];
            const nonce = 1;

            const appId = await project.appId();
            const projectId = await project.projectId();
            const chainId = (await ethers.provider.getNetwork()).chainId;

            const payload = ethers.AbiCoder.defaultAbiCoder().encode(
                ["string", "address[]"],
                ["addVendors", vendors]
            );

            const messageHash = ethers.keccak256(
                ethers.AbiCoder.defaultAbiCoder().encode(
                    ["string", "string", "bytes", "uint256", "uint256"],
                    [appId, projectId, payload, nonce, chainId]
                )
            );
            const signature = await appOwner.signMessage(ethers.getBytes(messageHash));

            const callSig = {
                payload: payload,
                nonce: nonce,
                signature: signature
            };

            // First call succeeds
            await project.connect(relayer).addVendors(vendors, callSig);

            // Second call with same nonce and same payload fails (nonce consumed)
            await expect(
                project.connect(relayer).addVendors(vendors, callSig)
            ).to.be.revertedWith("Nonce already consumed");
        });

        it("Should reject mismatched payload", async function () {
            const vendors = [vendor1.address];
            const wrongVendors = [vendor2.address];
            const nonce = 1;

            const appId = await project.appId();
            const projectId = await project.projectId();
            const chainId = (await ethers.provider.getNetwork()).chainId;

            // Sign for one set of vendors
            const payload = ethers.AbiCoder.defaultAbiCoder().encode(
                ["string", "address[]"],
                ["addVendors", vendors]
            );

            const messageHash = ethers.keccak256(
                ethers.AbiCoder.defaultAbiCoder().encode(
                    ["string", "string", "bytes", "uint256", "uint256"],
                    [appId, projectId, payload, nonce, chainId]
                )
            );
            const signature = await appOwner.signMessage(ethers.getBytes(messageHash));

            const callSig = {
                payload: payload,
                nonce: nonce,
                signature: signature
            };

            // Try to call with different vendors (payload mismatch)
            await expect(
                project.connect(relayer).addVendors(wrongVendors, callSig)
            ).to.be.revertedWith("Invalid app admin signature");
        });

        it("Should activate project with sufficient balance", async function () {
            const minBalance = ethers.parseUnits("100", 6);
            const vendors = [vendor1.address, vendor2.address];
            const requiredBalance = minBalance * BigInt(vendors.length);

            // Add vendors
            await project.connect(appOwner).addVendors(vendors, EMPTY_CALL_SIG);

            // Fund project
            await mockUSDC.connect(projectOwner).approve(projectAddress, requiredBalance);
            await project.connect(projectOwner).fundProject(requiredBalance);

            // Activate
            await expect(project.connect(appOwner).activateProject(EMPTY_CALL_SIG))
                .to.emit(project, "ProjectActivated");

            expect(await project.isActive()).to.be.true;
        });

        it("Should reject activation with insufficient balance", async function () {
            const minBalance = ethers.parseUnits("100", 6);
            const vendors = [vendor1.address, vendor2.address];
            const insufficientBalance = minBalance; // Only enough for 1 vendor

            await project.connect(appOwner).addVendors(vendors, EMPTY_CALL_SIG);
            await mockUSDC.connect(projectOwner).approve(projectAddress, insufficientBalance);
            await project.connect(projectOwner).fundProject(insufficientBalance);

            await expect(
                project.connect(appOwner).activateProject(EMPTY_CALL_SIG)
            ).to.be.revertedWith("Insufficient balance for activation");
        });

        it("Should reject adding vendors after activation", async function () {
            const vendors = [vendor1.address];
            const minBalance = ethers.parseUnits("100", 6);

            await project.connect(appOwner).addVendors(vendors, EMPTY_CALL_SIG);
            await mockUSDC.connect(projectOwner).approve(projectAddress, minBalance);
            await project.connect(projectOwner).fundProject(minBalance);
            await project.connect(appOwner).activateProject(EMPTY_CALL_SIG);

            await expect(
                project.connect(appOwner).addVendors([vendor2.address], EMPTY_CALL_SIG)
            ).to.be.revertedWith("Project already active");
        });
    });

    async function setupActiveProject(): Promise<{ project: SmartEscrow, projectAddress: string }> {
        const projectAddress = await createTestProject(
            "test-app",
            "project-001",
            await mockUSDC.getAddress()
        );
        const project = await ethers.getContractAt("SmartEscrow", projectAddress);

        // Add vendors and activate
        await project.connect(appOwner).addVendors([vendor1.address, vendor2.address], EMPTY_CALL_SIG);
        const minBalance = ethers.parseUnits("100", 6);
        const requiredBalance = minBalance * 2n;
        await mockUSDC.connect(projectOwner).approve(projectAddress, requiredBalance);
        await project.connect(projectOwner).fundProject(requiredBalance);
        await project.connect(appOwner).activateProject(EMPTY_CALL_SIG);

        return { project, projectAddress };
    }

    async function signClaim(
        appId: string,
        projectId: string,
        claimId: string,
        receiver: string,
        amount: bigint,
        claimableAfter: number,
        claimDeadline: number,
        nonce: bigint,
        signer: HardhatEthersSigner
    ): Promise<string> {
        const messageHash = ethers.keccak256(
            ethers.AbiCoder.defaultAbiCoder().encode(
                ["string", "string", "bytes32", "address", "uint256", "uint256", "uint256", "uint256"],
                [appId, projectId, claimId, receiver, amount, claimableAfter, claimDeadline, nonce]
            )
        );
        return await signer.signMessage(ethers.getBytes(messageHash));
    }

    describe("Scheduled Claims", function () {
        let project: SmartEscrow;
        let projectAddress: string;

        beforeEach(async function () {
            const setup = await setupActiveProject();
            project = setup.project;
            projectAddress = setup.projectAddress;
        });

        it("Should reject claim before claimableAfter time", async function () {
            const amount = ethers.parseUnits("100", 6);
            const claimId = ethers.id("claim-001");
            const currentTime = await time.latest();
            const claimableAfter = currentTime + 7 * 24 * 60 * 60; // 7 days from now
            const nonce = await project.nonces(vendor1.address);

            const appSignature = await signClaim(
                "test-app",
                "project-001",
                claimId,
                vendor1.address,
                amount,
                claimableAfter,
                0,
                nonce,
                appOwner
            );

            const payment = {
                app: "test-app",
                projectId: "project-001",
                claimId: claimId,
                receiver: vendor1.address,
                amount: amount,
                claimableAfter: claimableAfter,
                claimDeadline: 0,
                appSignature: appSignature
            };

            // Sign Pvium attestation
            const pviumMessageHash = ethers.keccak256(
                ethers.solidityPacked(
                    ["bytes", "string", "string", "bytes32", "uint256"],
                    [
                        ethers.toUtf8Bytes(""),
                        payment.app,
                        payment.projectId,
                        payment.claimId,
                        (await ethers.provider.getNetwork()).chainId
                    ]
                )
            );
            const pviumSignature = await pvium.signMessage(ethers.getBytes(pviumMessageHash));

            await expect(
                factory.finalizeClaim([payment], pviumSignature)
            ).to.be.revertedWith("Claim not yet claimable");
        });

        it("Should allow claim after claimableAfter time", async function () {
            const amount = ethers.parseUnits("100", 6);
            const claimId = ethers.id("claim-002");
            const currentTime = await time.latest();
            const claimableAfter = currentTime;
            const nonce = await project.nonces(vendor1.address);

            const appSignature = await signClaim(
                "test-app",
                "project-001",
                claimId,
                vendor1.address,
                amount,
                claimableAfter,
                0,
                nonce,
                appOwner
            );

            const payment = {
                app: "test-app",
                projectId: "project-001",
                claimId: claimId,
                receiver: vendor1.address,
                amount: amount,
                claimableAfter: claimableAfter,
                claimDeadline: 0,
                appSignature: appSignature
            };

            const chainId = (await ethers.provider.getNetwork()).chainId;
            const pviumMessageHash = ethers.keccak256(
                ethers.solidityPacked(
                    ["bytes", "string", "string", "bytes32", "uint256"],
                    [
                        ethers.toUtf8Bytes(""),
                        payment.app,
                        payment.projectId,
                        payment.claimId,
                        chainId
                    ]
                )
            );
            const pviumSignature = await pvium.signMessage(ethers.getBytes(pviumMessageHash));

            const vendorBalanceBefore = await mockUSDC.balanceOf(vendor1.address);

            await expect(factory.finalizeClaim([payment], pviumSignature))
                .to.emit(project, "ClaimFinalized");

            const vendorBalanceAfter = await mockUSDC.balanceOf(vendor1.address);
            const appFee = (amount * BigInt(APP_FEE_BPS)) / 10000n;
            const pviumFee = (amount * BigInt(PVIUM_FEE_BPS)) / 10000n;
            const expectedVendorAmount = amount - appFee - pviumFee;

            expect(vendorBalanceAfter - vendorBalanceBefore).to.equal(expectedVendorAmount);
        });

        it("Should reject claim after claimDeadline", async function () {
            const amount = ethers.parseUnits("100", 6);
            const claimId = ethers.id("claim-003");
            const currentTime = await time.latest();
            const claimableAfter = currentTime;
            const claimDeadline = currentTime + 1; // 1 second from now
            const nonce = await project.nonces(vendor1.address);

            const appSignature = await signClaim(
                "test-app",
                "project-001",
                claimId,
                vendor1.address,
                amount,
                claimableAfter,
                claimDeadline,
                nonce,
                appOwner
            );

            const payment = {
                app: "test-app",
                projectId: "project-001",
                claimId: claimId,
                receiver: vendor1.address,
                amount: amount,
                claimableAfter: claimableAfter,
                claimDeadline: claimDeadline,
                appSignature: appSignature
            };

            // Fast forward past deadline
            await time.increase(2);

            const chainId = (await ethers.provider.getNetwork()).chainId;
            const pviumMessageHash = ethers.keccak256(
                ethers.solidityPacked(
                    ["bytes", "string", "string", "bytes32", "uint256"],
                    [
                        ethers.toUtf8Bytes(""),
                        payment.app,
                        payment.projectId,
                        payment.claimId,
                        chainId
                    ]
                )
            );
            const pviumSignature = await pvium.signMessage(ethers.getBytes(pviumMessageHash));

            await expect(
                factory.finalizeClaim([payment], pviumSignature)
            ).to.be.revertedWith("Claim deadline expired");
        });

        it("Should verify claim signature off-chain", async function () {
            const amount = ethers.parseUnits("100", 6);
            const claimId = ethers.id("claim-004");
            const currentTime = await time.latest();
            const nonce = await project.nonces(vendor1.address);

            const appSignature = await signClaim(
                "test-app",
                "project-001",
                claimId,
                vendor1.address,
                amount,
                currentTime,
                0,
                nonce,
                appOwner
            );

            const payment = {
                app: "test-app",
                projectId: "project-001",
                claimId: claimId,
                receiver: vendor1.address,
                amount: amount,
                claimableAfter: currentTime,
                claimDeadline: 0,
                appSignature: appSignature
            };

            const [isValid, signer] = await project.verifyClaimSignature(payment);
            expect(isValid).to.be.true;
            expect(signer).to.equal(appOwner.address);
        });
    });

    describe("Disputes", function () {
        let project: SmartEscrow;
        let projectAddress: string;

        beforeEach(async function () {
            const setup = await setupActiveProject();
            project = setup.project;
            projectAddress = setup.projectAddress;
        });

        it("Should allow app to raise dispute with signature", async function () {
            const claimId = ethers.id("dispute-claim-001");
            const chainId = (await ethers.provider.getNetwork()).chainId;

            const messageHash = ethers.keccak256(
                ethers.AbiCoder.defaultAbiCoder().encode(
                    ["bytes32", "uint256"],
                    [claimId, chainId]
                )
            );
            const signature = await appOwner.signMessage(ethers.getBytes(messageHash));

            await expect(project.dispute(claimId, signature))
                .to.emit(project, "DisputeRaised")
                .withArgs(claimId, appOwner.address);

            const dispute = await project.getDispute(claimId);
            expect(dispute.active).to.be.true;
            expect(dispute.raisedBy).to.equal(appOwner.address);
        });

        it("Should allow vendor to raise dispute with signature", async function () {
            const claimId = ethers.id("dispute-claim-002");
            const chainId = (await ethers.provider.getNetwork()).chainId;

            const messageHash = ethers.keccak256(
                ethers.AbiCoder.defaultAbiCoder().encode(
                    ["bytes32", "uint256"],
                    [claimId, chainId]
                )
            );
            const signature = await vendor1.signMessage(ethers.getBytes(messageHash));

            await expect(project.dispute(claimId, signature))
                .to.emit(project, "DisputeRaised")
                .withArgs(claimId, vendor1.address);
        });

        it("Should reject dispute with invalid signature", async function () {
            const claimId = ethers.id("dispute-claim-003");
            const chainId = (await ethers.provider.getNetwork()).chainId;

            const messageHash = ethers.keccak256(
                ethers.AbiCoder.defaultAbiCoder().encode(
                    ["bytes32", "uint256"],
                    [claimId, chainId]
                )
            );
            // Sign with non-approved address
            const signature = await relayer.signMessage(ethers.getBytes(messageHash));

            await expect(
                project.dispute(claimId, signature)
            ).to.be.revertedWith("Invalid dispute signature");
        });

        it("Should block claim finalization during active dispute", async function () {
            const amount = ethers.parseUnits("100", 6);
            const claimId = ethers.id("disputed-claim");
            const currentTime = await time.latest();
            const nonce = await project.nonces(vendor1.address);

            // Raise dispute first
            const chainId = (await ethers.provider.getNetwork()).chainId;
            const disputeHash = ethers.keccak256(
                ethers.AbiCoder.defaultAbiCoder().encode(
                    ["bytes32", "uint256"],
                    [claimId, chainId]
                )
            );
            const disputeSignature = await appOwner.signMessage(ethers.getBytes(disputeHash));
            await project.dispute(claimId, disputeSignature);

            // Try to finalize claim
            const appSignature = await signClaim(
                "test-app",
                "project-001",
                claimId,
                vendor1.address,
                amount,
                currentTime,
                0,
                nonce,
                appOwner
            );

            const payment = {
                app: "test-app",
                projectId: "project-001",
                claimId: claimId,
                receiver: vendor1.address,
                amount: amount,
                claimableAfter: currentTime,
                claimDeadline: 0,
                appSignature: appSignature
            };

            const pviumMessageHash = ethers.keccak256(
                ethers.solidityPacked(
                    ["bytes", "string", "string", "bytes32", "uint256"],
                    [
                        ethers.toUtf8Bytes(""),
                        payment.app,
                        payment.projectId,
                        payment.claimId,
                        chainId
                    ]
                )
            );
            const pviumSignature = await pvium.signMessage(ethers.getBytes(pviumMessageHash));

            await expect(
                factory.finalizeClaim([payment], pviumSignature)
            ).to.be.revertedWith("Claim is disputed");
        });

        it("Should auto-clear dispute after deadline expires", async function () {
            const amount = ethers.parseUnits("100", 6);
            const claimId = ethers.id("auto-clear-dispute");
            const currentTime = await time.latest();
            const nonce = await project.nonces(vendor1.address);

            // Raise dispute
            const chainId = (await ethers.provider.getNetwork()).chainId;
            const disputeHash = ethers.keccak256(
                ethers.AbiCoder.defaultAbiCoder().encode(
                    ["bytes32", "uint256"],
                    [claimId, chainId]
                )
            );
            const disputeSignature = await appOwner.signMessage(ethers.getBytes(disputeHash));
            await project.dispute(claimId, disputeSignature);

            // Fast forward past dispute deadline
            await time.increase(DISPUTE_WINDOW + 1);

            // Try to finalize claim - should auto-clear dispute and succeed
            const appSignature = await signClaim(
                "test-app",
                "project-001",
                claimId,
                vendor1.address,
                amount,
                currentTime,
                0,
                nonce,
                appOwner
            );

            const payment = {
                app: "test-app",
                projectId: "project-001",
                claimId: claimId,
                receiver: vendor1.address,
                amount: amount,
                claimableAfter: currentTime,
                claimDeadline: 0,
                appSignature: appSignature
            };

            const pviumMessageHash = ethers.keccak256(
                ethers.solidityPacked(
                    ["bytes", "string", "string", "bytes32", "uint256"],
                    [
                        ethers.toUtf8Bytes(""),
                        payment.app,
                        payment.projectId,
                        payment.claimId,
                        chainId
                    ]
                )
            );
            const pviumSignature = await pvium.signMessage(ethers.getBytes(pviumMessageHash));

            await expect(factory.finalizeClaim([payment], pviumSignature))
                .to.emit(project, "ClaimFinalized");

            // Dispute should be auto-cleared
            const dispute = await project.getDispute(claimId);
            expect(dispute.active).to.be.false;
        });

        it("Should resolve dispute and cancel claim", async function () {
            const claimId = ethers.id("resolve-cancel");
            const chainId = (await ethers.provider.getNetwork()).chainId;

            // Raise dispute
            const disputeHash = ethers.keccak256(
                ethers.AbiCoder.defaultAbiCoder().encode(
                    ["bytes32", "uint256"],
                    [claimId, chainId]
                )
            );
            const disputeSignature = await appOwner.signMessage(ethers.getBytes(disputeHash));
            await project.dispute(claimId, disputeSignature);

            // Resolve dispute - reject claim
            const resolveHash = ethers.keccak256(
                ethers.AbiCoder.defaultAbiCoder().encode(
                    ["bytes32", "bool", "uint256"],
                    [claimId, false, chainId]
                )
            );
            const appResolveSignature = await appOwner.signMessage(ethers.getBytes(resolveHash));
            const pviumResolveSignature = await pvium.signMessage(ethers.getBytes(resolveHash));

            await expect(
                project.resolveDispute(claimId, false, appResolveSignature, pviumResolveSignature)
            ).to.emit(project, "DisputeResolved")
             .withArgs(claimId, false);

            // Claim should be permanently cancelled
            expect(await project.isCancelled(claimId)).to.be.true;
        });

        it("Should resolve dispute and allow claim", async function () {
            const claimId = ethers.id("resolve-allow");
            const chainId = (await ethers.provider.getNetwork()).chainId;

            // Raise dispute
            const disputeHash = ethers.keccak256(
                ethers.AbiCoder.defaultAbiCoder().encode(
                    ["bytes32", "uint256"],
                    [claimId, chainId]
                )
            );
            const disputeSignature = await appOwner.signMessage(ethers.getBytes(disputeHash));
            await project.dispute(claimId, disputeSignature);

            // Resolve dispute - allow claim
            const resolveHash = ethers.keccak256(
                ethers.AbiCoder.defaultAbiCoder().encode(
                    ["bytes32", "bool", "uint256"],
                    [claimId, true, chainId]
                )
            );
            const appResolveSignature = await appOwner.signMessage(ethers.getBytes(resolveHash));
            const pviumResolveSignature = await pvium.signMessage(ethers.getBytes(resolveHash));

            await expect(
                project.resolveDispute(claimId, true, appResolveSignature, pviumResolveSignature)
            ).to.emit(project, "DisputeResolved")
             .withArgs(claimId, true);

            // Dispute should be cleared, claim not cancelled
            const dispute = await project.getDispute(claimId);
            expect(dispute.active).to.be.false;
            expect(await project.isCancelled(claimId)).to.be.false;
        });
    });

    describe("Refunds", function () {
        let project: SmartEscrow;
        let projectAddress: string;

        beforeEach(async function () {
            const setup = await setupActiveProject();
            project = setup.project;
            projectAddress = setup.projectAddress;
        });

        it("Should process refund with zero Pvium fee", async function () {
            const refundAmount = ethers.parseUnits("100", 6);
            const claimId = ethers.id("refund-001");
            const currentTime = await time.latest();
            const nonce = await project.nonces(projectOwner.address);

            const appSignature = await signClaim(
                "test-app",
                "project-001",
                claimId,
                projectOwner.address,
                refundAmount,
                currentTime,
                0,
                nonce,
                appOwner
            );

            const payment = {
                app: "test-app",
                projectId: "project-001",
                claimId: claimId,
                receiver: projectOwner.address, // Refund to project owner
                amount: refundAmount,
                claimableAfter: currentTime,
                claimDeadline: 0,
                appSignature: appSignature
            };

            const chainId = (await ethers.provider.getNetwork()).chainId;
            const pviumMessageHash = ethers.keccak256(
                ethers.solidityPacked(
                    ["bytes", "string", "string", "bytes32", "uint256"],
                    [
                        ethers.toUtf8Bytes(""),
                        payment.app,
                        payment.projectId,
                        payment.claimId,
                        chainId
                    ]
                )
            );
            const pviumSignature = await pvium.signMessage(ethers.getBytes(pviumMessageHash));

            const projectOwnerBalanceBefore = await mockUSDC.balanceOf(projectOwner.address);
            const pviumBalanceBefore = await mockUSDC.balanceOf(pvium.address);

            await factory.finalizeClaim([payment], pviumSignature);

            const projectOwnerBalanceAfter = await mockUSDC.balanceOf(projectOwner.address);
            const pviumBalanceAfter = await mockUSDC.balanceOf(pvium.address);

            // Project owner gets refund minus app fee (NO Pvium fee)
            const appFee = (refundAmount * BigInt(APP_FEE_BPS)) / 10000n;
            const expectedRefund = refundAmount - appFee;

            expect(projectOwnerBalanceAfter - projectOwnerBalanceBefore).to.equal(expectedRefund);
            // Pvium should get ZERO fee
            expect(pviumBalanceAfter - pviumBalanceBefore).to.equal(0);
        });

        it("Should reject refund to non-refundAddress", async function () {
            const refundAmount = ethers.parseUnits("100", 6);
            const claimId = ethers.id("refund-002");
            const currentTime = await time.latest();
            const nonce = await project.nonces(relayer.address);

            // Try to refund to wrong address
            const appSignature = await signClaim(
                "test-app",
                "project-001",
                claimId,
                relayer.address, // Wrong refund address
                refundAmount,
                currentTime,
                0,
                nonce,
                appOwner
            );

            const payment = {
                app: "test-app",
                projectId: "project-001",
                claimId: claimId,
                receiver: relayer.address,
                amount: refundAmount,
                claimableAfter: currentTime,
                claimDeadline: 0,
                appSignature: appSignature
            };

            const chainId = (await ethers.provider.getNetwork()).chainId;
            const pviumMessageHash = ethers.keccak256(
                ethers.solidityPacked(
                    ["bytes", "string", "string", "bytes32", "uint256"],
                    [
                        ethers.toUtf8Bytes(""),
                        payment.app,
                        payment.projectId,
                        payment.claimId,
                        chainId
                    ]
                )
            );
            const pviumSignature = await pvium.signMessage(ethers.getBytes(pviumMessageHash));

            await expect(
                factory.finalizeClaim([payment], pviumSignature)
            ).to.be.revertedWith("Receiver not approved");
        });
    });

    describe("Multi-Token Batch Processing", function () {
        let projectUSDC: SmartEscrow;
        let projectUSDT: SmartEscrow;
        let projectUSDCAddress: string;
        let projectUSDTAddress: string;

        beforeEach(async function () {
            // Create two projects with different tokens
            projectUSDCAddress = await createTestProject(
                "test-app",
                "usdc-project",
                await mockUSDC.getAddress()
            );
            projectUSDC = await ethers.getContractAt("SmartEscrow", projectUSDCAddress);

            projectUSDTAddress = await createTestProject(
                "test-app",
                "usdt-project",
                await mockUSDT.getAddress()
            );
            projectUSDT = await ethers.getContractAt("SmartEscrow", projectUSDTAddress);

            // Setup both projects
            await projectUSDC.connect(appOwner).addVendors([vendor1.address], EMPTY_CALL_SIG);
            await projectUSDT.connect(appOwner).addVendors([vendor2.address], EMPTY_CALL_SIG);

            const minBalance = ethers.parseUnits("500", 6);

            await mockUSDC.connect(projectOwner).approve(projectUSDCAddress, minBalance);
            await projectUSDC.connect(projectOwner).fundProject(minBalance);
            await projectUSDC.connect(appOwner).activateProject(EMPTY_CALL_SIG);

            await mockUSDT.connect(projectOwner).approve(projectUSDTAddress, minBalance);
            await projectUSDT.connect(projectOwner).fundProject(minBalance);
            await projectUSDT.connect(appOwner).activateProject(EMPTY_CALL_SIG);
        });

        it("Should batch process claims across different tokens", async function () {
            const usdcAmount = ethers.parseUnits("100", 6);
            const usdtAmount = ethers.parseUnits("200", 6);
            const currentTime = await time.latest();

            // Create USDC claim
            const usdcClaimId = ethers.id("usdc-batch-claim");
            const usdcNonce = await projectUSDC.nonces(vendor1.address);
            const usdcSignature = await signClaim(
                "test-app",
                "usdc-project",
                usdcClaimId,
                vendor1.address,
                usdcAmount,
                currentTime,
                0,
                usdcNonce,
                appOwner
            );

            // Create USDT claim
            const usdtClaimId = ethers.id("usdt-batch-claim");
            const usdtNonce = await projectUSDT.nonces(vendor2.address);
            const usdtSignature = await signClaim(
                "test-app",
                "usdt-project",
                usdtClaimId,
                vendor2.address,
                usdtAmount,
                currentTime,
                0,
                usdtNonce,
                appOwner
            );

            const payments = [
                {
                    app: "test-app",
                    projectId: "usdc-project",
                    claimId: usdcClaimId,
                    receiver: vendor1.address,
                    amount: usdcAmount,
                    claimableAfter: currentTime,
                    claimDeadline: 0,
                    appSignature: usdcSignature
                },
                {
                    app: "test-app",
                    projectId: "usdt-project",
                    claimId: usdtClaimId,
                    receiver: vendor2.address,
                    amount: usdtAmount,
                    claimableAfter: currentTime,
                    claimDeadline: 0,
                    appSignature: usdtSignature
                }
            ];

            // Pvium signs the batch
            const chainId = (await ethers.provider.getNetwork()).chainId;
            let dataPacked = "0x";
            for (const payment of payments) {
                dataPacked = ethers.concat([
                    dataPacked,
                    ethers.toUtf8Bytes(payment.app),
                    ethers.toUtf8Bytes(payment.projectId),
                    payment.claimId
                ]);
            }
            const pviumMessageHash = ethers.keccak256(
                ethers.concat([dataPacked, ethers.toBeHex(chainId, 32)])
            );
            const pviumSignature = await pvium.signMessage(ethers.getBytes(pviumMessageHash));

            const vendor1USDCBefore = await mockUSDC.balanceOf(vendor1.address);
            const vendor2USDTBefore = await mockUSDT.balanceOf(vendor2.address);
            const pviumUSDCBefore = await mockUSDC.balanceOf(pvium.address);
            const pviumUSDTBefore = await mockUSDT.balanceOf(pvium.address);

            await factory.finalizeClaim(payments, pviumSignature);

            const vendor1USDCAfter = await mockUSDC.balanceOf(vendor1.address);
            const vendor2USDTAfter = await mockUSDT.balanceOf(vendor2.address);
            const pviumUSDCAfter = await mockUSDC.balanceOf(pvium.address);
            const pviumUSDTAfter = await mockUSDT.balanceOf(pvium.address);

            // Verify vendor1 received USDC (minus fees)
            const usdcAppFee = (usdcAmount * BigInt(APP_FEE_BPS)) / 10000n;
            const usdcPviumFee = (usdcAmount * BigInt(PVIUM_FEE_BPS)) / 10000n;
            const expectedUSDC = usdcAmount - usdcAppFee - usdcPviumFee;
            expect(vendor1USDCAfter - vendor1USDCBefore).to.equal(expectedUSDC);

            // Verify vendor2 received USDT (minus fees)
            const usdtAppFee = (usdtAmount * BigInt(APP_FEE_BPS)) / 10000n;
            const usdtPviumFee = (usdtAmount * BigInt(PVIUM_FEE_BPS)) / 10000n;
            const expectedUSDT = usdtAmount - usdtAppFee - usdtPviumFee;
            expect(vendor2USDTAfter - vendor2USDTBefore).to.equal(expectedUSDT);

            // Verify Pvium received correct fees in both tokens
            expect(pviumUSDCAfter - pviumUSDCBefore).to.equal(usdcPviumFee);
            expect(pviumUSDTAfter - pviumUSDTBefore).to.equal(usdtPviumFee);
        });
    });
});
