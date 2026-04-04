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
  let receiver1: HardhatEthersSigner;
  let receiver2: HardhatEthersSigner;
  let relayer: HardhatEthersSigner;

  const PVIUM_FEE_BPS = 50; // 0.5%
  const APP_FEE_BPS = 200; // 2%
  const DISPUTE_WINDOW = 3 * 24 * 60 * 60; // 3 days
  const INITIAL_SUPPLY = ethers.parseUnits('1000000', 6); // 1M USDC/USDT
  const SIGNATURE_DOMAIN = ethers.id('PVIUM_SIGNATURE_MESSAGE');
  const VALIDITY_PERIOD = 3000; // 3000 seconds for testing

  // Empty CallSignature for direct calls (no signature needed)
  const EMPTY_CALL_SIG = {
    nonce: 0,
    signature: '0x',
  };

  beforeEach(async function () {
    [pvium, appOwner, projectOwner, receiver1, receiver2, relayer] =
      await ethers.getSigners();

    // Deploy mock tokens (USDC/USDT use 6 decimals)
    const MockToken = await ethers.getContractFactory('MockERC20');
    mockUSDC = await MockToken.deploy('USD Coin', 'USDC', INITIAL_SUPPLY);
    await mockUSDC.waitForDeployment();

    mockUSDT = await MockToken.deploy('Tether USD', 'USDT', INITIAL_SUPPLY);
    await mockUSDT.waitForDeployment();

    // Deploy deployer contract
    const Deployer = await ethers.getContractFactory('SmartEscrowDeployer');
    const deployer = await Deployer.deploy();
    await deployer.waitForDeployment();

    // Deploy factory with admin address, fee address, validity period, and accepted tokens
    const Factory = await ethers.getContractFactory('SmartEscrowFactory');
    factory = await Factory.deploy(
      PVIUM_FEE_BPS,
      0, // withdrawalProcessorFeeBps - 0% for testing
      pvium.address,
      pvium.address,
      await deployer.getAddress(),
      VALIDITY_PERIOD,
      [await mockUSDC.getAddress(), await mockUSDT.getAddress()], // accepted tokens
    );
    await factory.waitForDeployment();

    // Give project owner some tokens
    await mockUSDC.mint(projectOwner.address, ethers.parseUnits('100000', 6));
    await mockUSDT.mint(projectOwner.address, ethers.parseUnits('100000', 6));
  });

  describe('Factory Deployment', function () {
    it('Should set correct Pvium fee and relay address', async function () {
      expect(await factory.pviumFeeBps()).to.equal(PVIUM_FEE_BPS);
      expect(await factory.relayFeeAddress(pvium.address)).to.equal(pvium.address);
    });

    it('Should initialize with accepted tokens', async function () {
      expect(await factory.acceptedTokens(await mockUSDC.getAddress())).to.be.true;
      expect(await factory.acceptedTokens(await mockUSDT.getAddress())).to.be.true;
    });

    it('Should allow admin to add accepted token', async function () {
      const newToken = receiver1.address; // Using any address as mock token
      expect(await factory.acceptedTokens(newToken)).to.be.false;

      await expect(factory.connect(pvium).setAcceptedToken(newToken, true))
        .to.emit(factory, 'TokenAcceptanceUpdated')
        .withArgs(newToken, true);

      expect(await factory.acceptedTokens(newToken)).to.be.true;
    });

    it('Should allow admin to remove accepted token', async function () {
      const tokenAddress = await mockUSDC.getAddress();
      expect(await factory.acceptedTokens(tokenAddress)).to.be.true;

      await expect(factory.connect(pvium).setAcceptedToken(tokenAddress, false))
        .to.emit(factory, 'TokenAcceptanceUpdated')
        .withArgs(tokenAddress, false);

      expect(await factory.acceptedTokens(tokenAddress)).to.be.false;

      // Re-add it for other tests
      await factory.connect(pvium).setAcceptedToken(tokenAddress, true);
    });

    it('Should allow admin to batch update accepted tokens', async function () {
      const token1 = receiver1.address;
      const token2 = receiver2.address;

      await expect(
        factory.connect(pvium).setAcceptedTokensBatch([token1, token2], [true, true])
      )
        .to.emit(factory, 'TokenAcceptanceUpdated')
        .withArgs(token1, true)
        .to.emit(factory, 'TokenAcceptanceUpdated')
        .withArgs(token2, true);

      expect(await factory.acceptedTokens(token1)).to.be.true;
      expect(await factory.acceptedTokens(token2)).to.be.true;
    });

    it('Should reject non-admin token management', async function () {
      const newToken = receiver1.address;
      await expect(
        factory.connect(appOwner).setAcceptedToken(newToken, true)
      ).to.be.reverted;
    });

    it('Should reject account creation with non-accepted token', async function () {
      const nonAcceptedToken = relayer.address; // Using any address as mock token
      const appId = 'test-app';
      const projectId = 'project-invalid-token';
      const timestamp = await time.latest();

      const payload = {
        app: appId,
        projectId: projectId,
        metadata: 'ipfs://test',
        tokenAddress: nonAcceptedToken, // Non-accepted token
        refundAddress: projectOwner.address,
        appFeeBps: APP_FEE_BPS,
        disputeWindowSeconds: DISPUTE_WINDOW,
        lockDurationSeconds: (await time.latest()) + 90 * 24 * 60 * 60,
        basePayout: ethers.parseUnits('100', 6),
        maxPayout: ethers.parseUnits('150', 6),
        maxNumReceivers: 10,
        timestamp: timestamp,
      };

      const chainId = (await ethers.provider.getNetwork()).chainId;
      const appFeeAddress = appOwner.address;

      const appMessageHash = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
          [
            'bytes32', 'string', 'address', 'string', 'string', 'address', 'address',
            'uint256', 'uint256', 'uint256', 'uint256', 'uint256', 'uint256', 'uint256',
          ],
          [
            SIGNATURE_DOMAIN, payload.app, appFeeAddress, payload.projectId,
            payload.metadata, payload.tokenAddress, payload.refundAddress,
            payload.appFeeBps, payload.disputeWindowSeconds, payload.lockDurationSeconds,
            payload.basePayout, payload.maxPayout, payload.timestamp, chainId,
          ],
        ),
      );
      const appSignature = await appOwner.signMessage(ethers.getBytes(appMessageHash));

      const pviumMessageHash = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
          ['bytes32', 'bytes', 'address', 'uint256'],
          [SIGNATURE_DOMAIN, appSignature, await factory.getAddress(), chainId],
        ),
      );
      const pviumSignature = await pvium.signMessage(ethers.getBytes(pviumMessageHash));

      await expect(
        factory.createAccount(payload, appFeeAddress, appSignature, pviumSignature)
      ).to.be.revertedWith('Token not accepted');
    });

    it('Should allow admin to update Pvium fee', async function () {
      const newFee = 150;
      await expect(factory.connect(pvium).setPviumFee(newFee))
        .to.emit(factory, 'PviumFeeUpdated')
        .withArgs(PVIUM_FEE_BPS, newFee);

      expect(await factory.pviumFeeBps()).to.equal(newFee);
    });

    it('Should allow admin to update relay fee address', async function () {
      const newPviumFeeAddress = relayer.address;
      await expect(
        factory.connect(pvium).setRelayFeeAddress(pvium.address, newPviumFeeAddress),
      )
        .to.emit(factory, 'RelayFeeAddressUpdated')
        .withArgs(pvium.address, newPviumFeeAddress);

      expect(await factory.relayFeeAddress(pvium.address)).to.equal(newPviumFeeAddress);
    });

    it('Should reject non-admin fee update', async function () {
      await expect(factory.connect(appOwner).setPviumFee(150)).to.be
        .reverted;
    });

    it('Should allow granting and revoking relay roles', async function () {
      // Grant PVIUM_RELAY_ROLE to appOwner (for attestations)
      await factory.connect(pvium).grantPviumRelayer(appOwner.address, true);

      // Verify appOwner CANNOT update fees (requires DEFAULT_ADMIN_ROLE, not PVIUM_RELAY_ROLE)
      await expect(factory.connect(appOwner).setPviumFee(125)).to.be
        .reverted;

      // Verify pvium (who has DEFAULT_ADMIN_ROLE) CAN update fees
      const newFee = 125;
      await expect(factory.connect(pvium).setPviumFee(newFee))
        .to.emit(factory, 'PviumFeeUpdated')
        .withArgs(PVIUM_FEE_BPS, newFee);

      // Revoke PVIUM_RELAY_ROLE from appOwner
      await factory.connect(pvium).grantPviumRelayer(appOwner.address, false);
    });
  });

  describe('Operator System', function () {
    let operator: HardhatEthersSigner;
    let secondRelayer: HardhatEthersSigner;

    beforeEach(async function () {
      [, , , , , , operator, secondRelayer] = await ethers.getSigners();

      // Grant relay role to relayer and secondRelayer
      await factory.connect(pvium).grantPviumRelayer(relayer.address, true);
      await factory.connect(pvium).grantPviumRelayer(secondRelayer.address, true);
      await factory.connect(pvium).setRelayFeeAddress(relayer.address, relayer.address);
      await factory.connect(pvium).setRelayFeeAddress(secondRelayer.address, secondRelayer.address);
    });

    it('Should allow relayer to set operator', async function () {
      await expect(factory.connect(relayer).setOperator(operator.address, true))
        .to.emit(factory, 'OperatorUpdated')
        .withArgs(operator.address, relayer.address, true);

      expect(await factory.operatorToRelayer(operator.address)).to.equal(relayer.address);
    });

    it('Should allow relayer to unset operator', async function () {
      await factory.connect(relayer).setOperator(operator.address, true);
      expect(await factory.operatorToRelayer(operator.address)).to.equal(relayer.address);

      await expect(factory.connect(relayer).setOperator(operator.address, false))
        .to.emit(factory, 'OperatorUpdated')
        .withArgs(operator.address, ethers.ZeroAddress, false);

      expect(await factory.operatorToRelayer(operator.address)).to.equal(ethers.ZeroAddress);
    });

    it('Should reject non-relayer setting operator', async function () {
      await expect(
        factory.connect(appOwner).setOperator(operator.address, true)
      ).to.be.reverted;
    });

    it('Should reject setting operator already assigned to another relayer', async function () {
      // First relayer sets operator
      await factory.connect(relayer).setOperator(operator.address, true);

      // Second relayer tries to set the same operator
      await expect(
        factory.connect(secondRelayer).setOperator(operator.address, true)
      ).to.be.revertedWith('Operator already assigned to another relayer');
    });

    it('Should reject unset by non-assigning relayer', async function () {
      await factory.connect(relayer).setOperator(operator.address, true);

      await expect(
        factory.connect(secondRelayer).setOperator(operator.address, false)
      ).to.be.revertedWith('Only the assigning relayer can unassign this operator');
    });

    it('Should allow operator to sign attestation for account creation', async function () {
      // Set operator for relayer
      await factory.connect(relayer).setOperator(operator.address, true);

      const appId = 'test-app';
      const projectId = 'operator-account-001';
      const timestamp = await time.latest();

      const payload = {
        app: appId,
        projectId: projectId,
        metadata: 'ipfs://test',
        tokenAddress: await mockUSDC.getAddress(),
        refundAddress: projectOwner.address,
        appFeeBps: APP_FEE_BPS,
        disputeWindowSeconds: DISPUTE_WINDOW,
        lockDurationSeconds: (await time.latest()) + 90 * 24 * 60 * 60,
        basePayout: ethers.parseUnits('100', 6),
        maxPayout: ethers.parseUnits('150', 6),
        maxNumReceivers: 10,
        timestamp: timestamp,
      };

      const chainId = (await ethers.provider.getNetwork()).chainId;
      const appFeeAddress = appOwner.address;

      // App signs the payload
      const appMessageHash = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
          [
            'bytes32', 'string', 'address', 'string', 'string', 'address', 'address',
            'uint256', 'uint256', 'uint256', 'uint256', 'uint256', 'uint256', 'uint256',
          ],
          [
            SIGNATURE_DOMAIN, payload.app, appFeeAddress, payload.projectId,
            payload.metadata, payload.tokenAddress, payload.refundAddress,
            payload.appFeeBps, payload.disputeWindowSeconds, payload.lockDurationSeconds,
            payload.basePayout, payload.maxPayout, payload.timestamp, chainId,
          ],
        ),
      );
      const appSignature = await appOwner.signMessage(ethers.getBytes(appMessageHash));

      // Operator (not relayer) attests
      const operatorMessageHash = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
          ['bytes32', 'bytes', 'address', 'uint256'],
          [SIGNATURE_DOMAIN, appSignature, await factory.getAddress(), chainId],
        ),
      );
      const operatorSignature = await operator.signMessage(ethers.getBytes(operatorMessageHash));

      await expect(
        factory.createAccount(payload, appFeeAddress, appSignature, operatorSignature)
      ).to.emit(factory, 'EscrowContractCreated');

      const accountAddress = await factory.getAccountByUniqueId(appId, projectId);
      expect(accountAddress).to.not.equal(ethers.ZeroAddress);

      // Verify that the account's relayer is the actual relayer, not the operator
      expect(await factory.accountRelayer(accountAddress)).to.equal(relayer.address);
    });

    it('Should allow operator signature for addReceivers', async function () {
      // Set operator for relayer
      await factory.connect(relayer).setOperator(operator.address, true);

      // Verify operator is assigned
      expect(await factory.operatorToRelayer(operator.address)).to.equal(relayer.address);

      // Verify relayer has PVIUM_RELAY_ROLE
      const RELAY_ROLE = ethers.keccak256(ethers.toUtf8Bytes('PVIUM_RELAY_ROLE'));
      expect(await factory.hasRole(RELAY_ROLE, relayer.address)).to.be.true;

      // Create an account first
      const accountAddress = await createTestAccount(
        'test-app',
        'operator-add-receivers',
        await mockUSDC.getAddress(),
      );
      const account = await ethers.getContractAt('SmartEscrow', accountAddress);

      const receivers = [receiver1.address, receiver2.address];
      const nonce = 1;

      // Get account details
      const appId = await account.appId();
      const projectId = await account.projectId();
      const chainId = (await ethers.provider.getNetwork()).chainId;
      const appIdBytes = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(['string'], [appId]),
      );

      // Create payload for addReceivers
      const payload = ethers.AbiCoder.defaultAbiCoder().encode(
        ['string', 'string', 'address[]'],
        [projectId, 'addReceivers', receivers],
      );

      // App admin signs the call (not operator)
      const messageHash = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
          ['bytes32', 'bytes', 'uint256', 'uint256'],
          [appIdBytes, payload, nonce, chainId],
        ),
      );
      const signature = await appOwner.signMessage(ethers.getBytes(messageHash));

      const callSig = {
        nonce: nonce,
        signature: signature,
      };

      // Operator submits the transaction
      await expect(account.connect(operator).addReceivers(receivers, callSig))
        .to.emit(account, 'ReceiversAdded')
        .withArgs(receivers);

      expect(await account.approvedReceivers(receiver1.address)).to.be.true;
      expect(await factory.consumedNonce(appIdBytes, appOwner.address, nonce)).to.be.true;
    });

    it('Should allow operator to sign for finalizeClaim', async function () {
      // Set operator for relayer
      await factory.connect(relayer).setOperator(operator.address, true);

      // Setup active account
      const { project, accountAddress } = await setupActiveAccount();

      const amount = ethers.parseUnits('100', 6);
      const claimId = ethers.id('operator-claim');
      const currentTime = await time.latest();

      const appSignature = await signClaim(
        'test-app',
        'project-001',
        claimId,
        receiver1.address,
        amount,
        currentTime,
        0,
        appOwner,
      );

      const payment = {
        app: 'test-app',
        projectId: 'project-001',
        claimId: claimId,
        receiver: receiver1.address,
        amount: amount,
        claimableAfter: currentTime,
        claimDeadline: 0,
        appSignature: appSignature,
      };

      const chainId = (await ethers.provider.getNetwork()).chainId;
      let dataPacked = '0x';
      dataPacked = ethers.AbiCoder.defaultAbiCoder().encode(
        ['bytes', 'string', 'string', 'bytes32'],
        [dataPacked, payment.app, payment.projectId, payment.claimId],
      );
      const operatorMessageHash = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
          ['bytes', 'uint256'],
          [dataPacked, chainId],
        ),
      );
      // Operator signs (not relayer)
      const operatorSignature = await operator.signMessage(ethers.getBytes(operatorMessageHash));

      const receiverBalanceBefore = await mockUSDC.balanceOf(receiver1.address);

      await expect(factory.finalizeClaim([payment], operatorSignature)).to.emit(
        project,
        'ClaimFinalized',
      );

      const receiverBalanceAfter = await mockUSDC.balanceOf(receiver1.address);
      const appFee = (amount * BigInt(APP_FEE_BPS)) / 10000n;
      const pviumFee = (amount * BigInt(PVIUM_FEE_BPS)) / 10000n;
      const expectedReceiverAmount = amount - appFee - pviumFee;

      expect(receiverBalanceAfter - receiverBalanceBefore).to.equal(expectedReceiverAmount);

      // Verify relayer received fees (not operator)
      // Note: In this case, the operator's relayer is the same as the account relayer,
      // so the relayer gets the full fee
    });
  });

  describe('Account Creation', function () {
    it('Should create account with valid signature', async function () {
      const appId = 'test-app';
      const projectId = 'project-001';
      const metadata = 'ipfs://Qm...';
      const lockDurationSeconds = (await time.latest()) + 90 * 24 * 60 * 60; // 90 days
      const minBalance = ethers.parseUnits('100', 6); // $100 per vendor
      const maxVendors = 10;
      const timestamp = await time.latest();

      const payload = {
        app: appId,
        projectId: projectId,
        metadata: metadata,
        tokenAddress: await mockUSDC.getAddress(),
        refundAddress: projectOwner.address,
        appFeeBps: APP_FEE_BPS,
        disputeWindowSeconds: DISPUTE_WINDOW,
        lockDurationSeconds: lockDurationSeconds,
        basePayout: minBalance,
        maxPayout: ethers.parseUnits('150', 6),
        maxNumReceivers: maxVendors,
        timestamp: timestamp,
      };

      const chainId = (await ethers.provider.getNetwork()).chainId;
      const appFeeAddress = appOwner.address;

      // App signs the payload
      const appMessageHash = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
          [
            'bytes32',
            'string',
            'address',
            'string',
            'string',
            'address',
            'address',
            'uint256',
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
            appFeeAddress,
            payload.projectId,
            payload.metadata,
            payload.tokenAddress,
            payload.refundAddress,
            payload.appFeeBps,
            payload.disputeWindowSeconds,
            payload.lockDurationSeconds,
            payload.basePayout,
            payload.maxPayout,
            payload.timestamp,
            chainId,
          ],
        ),
      );
      const appSignature = await appOwner.signMessage(
        ethers.getBytes(appMessageHash),
      );

      // Pvium attests the app owner
      const pviumMessageHash = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
          ['bytes32', 'bytes', 'address', 'uint256'],
          [SIGNATURE_DOMAIN, appSignature, await factory.getAddress(), chainId],
        ),
      );
      const pviumSignature = await pvium.signMessage(
        ethers.getBytes(pviumMessageHash),
      );

      await expect(
        factory.createAccount(
          payload,
          appFeeAddress,
          appSignature,
          pviumSignature,
        ),
      ).to.emit(factory, 'EscrowContractCreated');

      const accountAddress = await factory.getAccountByUniqueId(
        appId,
        projectId,
      );
      expect(accountAddress).to.not.equal(ethers.ZeroAddress);

      // Verify the signer is registered as an app admin
      const appIdBytes = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(['string'], [appId]),
      );
      const isAdmin = await factory.appAdmins(appIdBytes, appOwner.address);
      expect(isAdmin).to.be.true;
    });

    it('Should reject duplicate account creation', async function () {
      const appId = 'test-app';
      const projectId = 'project-001';
      const metadata = 'ipfs://Qm...';
      const lockDurationSeconds = 90 * 24 * 60 * 60; // duration the project will be locked before
      const timestamp = await time.latest();

      const payload = {
        app: appId,
        projectId: projectId,
        metadata: metadata,
        tokenAddress: await mockUSDC.getAddress(),
        refundAddress: projectOwner.address,
        appFeeBps: APP_FEE_BPS,
        disputeWindowSeconds: DISPUTE_WINDOW,
        lockDurationSeconds: lockDurationSeconds,
        basePayout: ethers.parseUnits('100', 6),
        maxPayout: ethers.parseUnits('150', 6),
        maxNumReceivers: 10,
        timestamp: timestamp,
      };

      const chainId = (await ethers.provider.getNetwork()).chainId;
      const appFeeAddress = appOwner.address;

      // App signs the payload
      const appMessageHash = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
          [
            'bytes32',
            'string',
            'address',
            'string',
            'string',
            'address',
            'address',
            'uint256',
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
            appFeeAddress,
            payload.projectId,
            payload.metadata,
            payload.tokenAddress,
            payload.refundAddress,
            payload.appFeeBps,
            payload.disputeWindowSeconds,
            payload.lockDurationSeconds,
            payload.basePayout,
            payload.maxPayout,
            payload.timestamp,
            chainId,
          ],
        ),
      );
      const appSignature = await appOwner.signMessage(
        ethers.getBytes(appMessageHash),
      );

      // Pvium attests the app owner
      const pviumMessageHash = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
          ['bytes32', 'bytes', 'address', 'uint256'],
          [SIGNATURE_DOMAIN, appSignature, await factory.getAddress(), chainId],
        ),
      );
      const pviumSignature = await pvium.signMessage(
        ethers.getBytes(pviumMessageHash),
      );

      // First creation succeeds
      await factory.createAccount(
        payload,
        appFeeAddress,
        appSignature,
        pviumSignature,
      );

      // Second creation fails
      await expect(
        factory.createAccount(
          payload,
          appFeeAddress,
          appSignature,
          pviumSignature,
        ),
      ).to.be.revertedWith('Account exists');
    });
  });

  async function createTestAccount(
    appId: string,
    projectId: string,
    tokenAddress: string,
    minBalance: bigint = ethers.parseUnits('100', 6),
    maxReceiverWithdrawal: bigint = ethers.parseUnits('150', 6),
    maxReceivers: number = 10,
  ): Promise<string> {
    const metadata = 'ipfs://test';
    const lockDurationSeconds = (await time.latest()) + 90 * 24 * 60 * 60;
    const timestamp = await time.latest();

    const payload = {
      app: appId,
      projectId: projectId,
      metadata: metadata,
      tokenAddress,
      refundAddress: projectOwner.address,
      appFeeBps: APP_FEE_BPS,
      disputeWindowSeconds: DISPUTE_WINDOW,
      lockDurationSeconds: lockDurationSeconds,
      basePayout: minBalance,
      maxPayout: maxReceiverWithdrawal,
      maxNumReceivers: maxReceivers,
      timestamp: timestamp,
    };

    const chainId = (await ethers.provider.getNetwork()).chainId;

    const appFeeAddress = appOwner.address;

    // App signs the payload
    const appMessageHash = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        [
          'bytes32',
          'string',
          'address',
          'string',
          'string',
          'address',
          'address',
          'uint256',
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
          appFeeAddress,
          payload.projectId,
          payload.metadata,
          payload.tokenAddress,
          payload.refundAddress,
          payload.appFeeBps,
          payload.disputeWindowSeconds,
          payload.lockDurationSeconds,
          payload.basePayout,
          payload.maxPayout,
          payload.timestamp,
          chainId,
        ],
      ),
    );
    const appSignature = await appOwner.signMessage(
      ethers.getBytes(appMessageHash),
    );

    // Pvium attests the app owner
    const pviumMessageHash = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ['bytes32', 'bytes', 'address', 'uint256'],
        [SIGNATURE_DOMAIN, appSignature, await factory.getAddress(), chainId],
      ),
    );
    const pviumSignature = await pvium.signMessage(
      ethers.getBytes(pviumMessageHash),
    );

    // Create the account (appAdmin is automatically set in createAccount for first account)
    await factory.createAccount(
      payload,
      appFeeAddress,
      appSignature,
      pviumSignature,
    );

    const accountAddress = await factory.getAccountByUniqueId(appId, projectId);

    return accountAddress;
  }

  describe('Account Funding and Activation', function () {
    let accountAddress: string;
    let account: SmartEscrow;

    beforeEach(async function () {
      accountAddress = await createTestAccount(
        'test-app',
        'project-001',
        await mockUSDC.getAddress(),
      );
      account = await ethers.getContractAt('SmartEscrow', accountAddress);
    });

    it('Should allow funding the account', async function () {
      const fundAmount = ethers.parseUnits('1000', 6);

      await mockUSDC.connect(projectOwner).approve(accountAddress, fundAmount);

      await expect(account.connect(projectOwner).fundAccount(fundAmount))
        .to.emit(account, 'AccountFunded')
        .withArgs(projectOwner.address, fundAmount);

      expect(await mockUSDC.balanceOf(accountAddress)).to.equal(fundAmount);
    });

    it('Should reject zero amount funding', async function () {
      await expect(
        account.connect(projectOwner).fundAccount(0),
      ).to.be.revertedWith('Amount must be greater than 0');
    });

    it('Should allow adding vendors before activation', async function () {
      const receivers = [receiver1.address, receiver2.address];

      await expect(
        account.connect(appOwner).addReceivers(receivers, EMPTY_CALL_SIG),
      )
        .to.emit(account, 'ReceiversAdded')
        .withArgs(receivers);

      expect(await account.approvedReceivers(receiver1.address)).to.be.true;
      expect(await account.approvedReceivers(receiver2.address)).to.be.true;
      expect(await account.getReceiverCount()).to.equal(2);
    });

    it('Should allow adding vendors with valid relayed signature', async function () {
      const receivers = [receiver1.address, receiver2.address];
      const nonce = 1; // Must be > 0 for relayed calls

      // Get account details
      const appId = await account.appId();
      const projectId = await account.projectId();
      const chainId = (await ethers.provider.getNetwork()).chainId;
      const appIdBytes = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(['string'], [appId]),
      );

      // Create payload for addReceivers
      const payload = ethers.AbiCoder.defaultAbiCoder().encode(
        ['string', 'string', 'address[]'],
        [projectId, 'addReceivers', receivers],
      );

      // App admin signs the call (matching factory.validateAppAdmin signature)
      const messageHash = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
          ['bytes32', 'bytes', 'uint256', 'uint256'],
          [appIdBytes, payload, nonce, chainId],
        ),
      );
      const signature = await appOwner.signMessage(
        ethers.getBytes(messageHash),
      );

      const callSig = {
        nonce: nonce,
        signature: signature,
      };

      // Relayer submits the transaction
      await expect(account.connect(relayer).addReceivers(receivers, callSig))
        .to.emit(account, 'ReceiversAdded')
        .withArgs(receivers);

      expect(await account.approvedReceivers(receiver1.address)).to.be.true;
      expect(await account.approvedReceivers(receiver2.address)).to.be.true;
      expect(await account.getReceiverCount()).to.equal(2);

      // Verify nonce was consumed (nonce is tracked per signer address)
      expect(await factory.consumedNonce(appIdBytes, appOwner.address, nonce))
        .to.be.true;
    });

    it('Should reject adding vendors with invalid signature', async function () {
      const receivers = [receiver1.address, receiver2.address];
      const nonce = 1;

      const appId = await account.appId();
      const projectId = await account.projectId();
      const chainId = (await ethers.provider.getNetwork()).chainId;
      const appIdBytes = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(['string'], [appId]),
      );

      const payload = ethers.AbiCoder.defaultAbiCoder().encode(
        ['string', 'string', 'address[]'],
        [projectId, 'addReceivers', receivers],
      );

      // Wrong signer (not an app admin)
      const messageHash = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
          ['bytes32', 'bytes', 'uint256', 'uint256'],
          [appIdBytes, payload, nonce, chainId],
        ),
      );
      const signature = await receiver1.signMessage(ethers.getBytes(messageHash));

      const callSig = {
        nonce: nonce,
        signature: signature,
      };

      await expect(
        account.connect(relayer).addReceivers(receivers, callSig),
      ).to.be.revertedWith('Invalid app admin signature');
    });

    it('Should reject reused nonce', async function () {
      const receivers = [receiver1.address];
      const nonce = 1;

      const appId = await account.appId();
      const projectId = await account.projectId();
      const chainId = (await ethers.provider.getNetwork()).chainId;
      const appIdBytes = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(['string'], [appId]),
      );

      const payload = ethers.AbiCoder.defaultAbiCoder().encode(
        ['string', 'string', 'address[]'],
        [projectId, 'addReceivers', receivers],
      );

      const messageHash = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
          ['bytes32', 'bytes', 'uint256', 'uint256'],
          [appIdBytes, payload, nonce, chainId],
        ),
      );
      const signature = await appOwner.signMessage(
        ethers.getBytes(messageHash),
      );

      const callSig = {
        nonce: nonce,
        signature: signature,
      };

      // First call succeeds
      await account.connect(relayer).addReceivers(receivers, callSig);

      // Second call with same nonce and same payload fails (nonce consumed)
      await expect(
        account.connect(relayer).addReceivers(receivers, callSig),
      ).to.be.revertedWith('Nonce already consumed');
    });

    it('Should reject mismatched payload', async function () {
      const receivers = [receiver1.address];
      const wrongReceivers = [receiver2.address];
      const nonce = 1;

      const appId = await account.appId();
      const projectId = await account.projectId();
      const chainId = (await ethers.provider.getNetwork()).chainId;
      const appIdBytes = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(['string'], [appId]),
      );

      // Sign for one set of receivers
      const payload = ethers.AbiCoder.defaultAbiCoder().encode(
        ['string', 'string', 'address[]'],
        [projectId, 'addReceivers', receivers],
      );

      const messageHash = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
          ['bytes32', 'bytes', 'uint256', 'uint256'],
          [appIdBytes, payload, nonce, chainId],
        ),
      );
      const signature = await appOwner.signMessage(
        ethers.getBytes(messageHash),
      );

      const callSig = {
        nonce: nonce,
        signature: signature,
      };

      // Try to call with different receivers (payload mismatch)
      await expect(
        account.connect(relayer).addReceivers(wrongReceivers, callSig),
      ).to.be.revertedWith('Invalid app admin signature');
    });

    it('Should activate project with sufficient balance', async function () {
      const receivers = [receiver1.address, receiver2.address];

      // Add vendors
      await account.connect(appOwner).addReceivers(receivers, EMPTY_CALL_SIG);

      // Calculate required balance based on maxPayout (not basePayout)
      const maxPayout = ethers.parseUnits('150', 6);
      const numReceivers = BigInt(receivers.length);
      const totalMaxPayout = maxPayout * numReceivers;
      const totalFees = (totalMaxPayout * BigInt(APP_FEE_BPS + PVIUM_FEE_BPS)) / 10000n;
      const requiredBalance = totalMaxPayout + totalFees;

      // Fund project
      await mockUSDC
        .connect(projectOwner)
        .approve(accountAddress, requiredBalance);
      await account.connect(projectOwner).fundAccount(requiredBalance);

      // Activate
      await expect(
        account.connect(appOwner).activateAccount(EMPTY_CALL_SIG),
      ).to.emit(account, 'AccountActivated');

      expect(await account.isActive()).to.be.true;
    });

    it('Should reject activation with insufficient balance', async function () {
      const minBalance = ethers.parseUnits('100', 6);
      const receivers = [receiver1.address, receiver2.address];
      const insufficientBalance = minBalance; // Only enough for 1 vendor

      await account.connect(appOwner).addReceivers(receivers, EMPTY_CALL_SIG);
      await mockUSDC
        .connect(projectOwner)
        .approve(accountAddress, insufficientBalance);
      await account.connect(projectOwner).fundAccount(insufficientBalance);

      await expect(
        account.connect(appOwner).activateAccount(EMPTY_CALL_SIG),
      ).to.be.revertedWith('Insufficient balance for activation');
    });

    it('Should reject adding vendors after activation', async function () {
      const receivers = [receiver1.address];

      await account.connect(appOwner).addReceivers(receivers, EMPTY_CALL_SIG);

      // Calculate required balance for 1 receiver
      const maxPayout = ethers.parseUnits('150', 6);
      const totalMaxPayout = maxPayout * 1n;
      const totalFees = (totalMaxPayout * BigInt(APP_FEE_BPS + PVIUM_FEE_BPS)) / 10000n;
      const requiredBalance = totalMaxPayout + totalFees;

      await mockUSDC.connect(projectOwner).approve(accountAddress, requiredBalance);
      await account.connect(projectOwner).fundAccount(requiredBalance);
      await account.connect(appOwner).activateAccount(EMPTY_CALL_SIG);

      await expect(
        account.connect(appOwner).addReceivers([receiver2.address], EMPTY_CALL_SIG),
      ).to.be.revertedWith('Account already active');
    });

    it('Should allow activating account with valid relayed signature', async function () {
      const receivers = [receiver1.address, receiver2.address];
      await account.connect(appOwner).addReceivers(receivers, EMPTY_CALL_SIG);

      // Calculate and fund required balance
      const maxPayout = ethers.parseUnits('150', 6);
      const numReceivers = BigInt(receivers.length);
      const totalMaxPayout = maxPayout * numReceivers;
      const totalFees = (totalMaxPayout * BigInt(APP_FEE_BPS + PVIUM_FEE_BPS)) / 10000n;
      const requiredBalance = totalMaxPayout + totalFees;

      await mockUSDC.connect(projectOwner).approve(accountAddress, requiredBalance);
      await account.connect(projectOwner).fundAccount(requiredBalance);

      // Create CallSignature for activateAccount
      const appId = await account.appId();
      const projectId = await account.projectId();
      const chainId = (await ethers.provider.getNetwork()).chainId;
      const appIdBytes = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(['string'], [appId]),
      );
      const nonce = 1;

      // Payload for activateAccount - only projectId and function name
      const payload = ethers.AbiCoder.defaultAbiCoder().encode(
        ['string', 'string'],
        [projectId, 'activateAccount'],
      );

      const messageHash = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
          ['bytes32', 'bytes', 'uint256', 'uint256'],
          [appIdBytes, payload, nonce, chainId],
        ),
      );
      const signature = await appOwner.signMessage(ethers.getBytes(messageHash));

      const callSig = { nonce: nonce, signature: signature };

      // Relayer submits the activation transaction
      await expect(account.connect(relayer).activateAccount(callSig))
        .to.emit(account, 'AccountActivated');

      expect(await account.isActive()).to.be.true;
      expect(await factory.consumedNonce(appIdBytes, appOwner.address, nonce)).to.be.true;
    });
  });

  async function setupActiveAccount(): Promise<{
    project: SmartEscrow;
    accountAddress: string;
  }> {
    const accountAddress = await createTestAccount(
      'test-app',
      'project-001',
      await mockUSDC.getAddress(),
    );
    const project = await ethers.getContractAt('SmartEscrow', accountAddress);

    // Add receivers and activate
    await project
      .connect(appOwner)
      .addReceivers([receiver1.address, receiver2.address], EMPTY_CALL_SIG);

    // Calculate required balance based on maxPayout (not basePayout)
    const maxPayout = ethers.parseUnits('150', 6);
    const numReceivers = 2n;
    const totalMaxPayout = maxPayout * numReceivers;
    const totalFees = (totalMaxPayout * BigInt(APP_FEE_BPS + PVIUM_FEE_BPS)) / 10000n;
    const requiredBalance = totalMaxPayout + totalFees;

    await mockUSDC
      .connect(projectOwner)
      .approve(accountAddress, requiredBalance);
    await project.connect(projectOwner).fundAccount(requiredBalance);
    await project.connect(appOwner).activateAccount(EMPTY_CALL_SIG);

    return { project, accountAddress: accountAddress };
  }

  async function signClaim(
    appId: string,
    projectId: string,
    claimId: string,
    receiver: string,
    amount: bigint,
    claimableAfter: number,
    claimDeadline: number,
    signer: HardhatEthersSigner,
  ): Promise<string> {
    const messageHash = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        [
          'string',
          'string',
          'bytes32',
          'address',
          'uint256',
          'uint256',
          'uint256',
        ],
        [
          appId,
          projectId,
          claimId,
          receiver,
          amount,
          claimableAfter,
          claimDeadline,
        ],
      ),
    );
    return await signer.signMessage(ethers.getBytes(messageHash));
  }

  describe('Scheduled Claims', function () {
    let project: SmartEscrow;
    let accountAddress: string;

    beforeEach(async function () {
      const setup = await setupActiveAccount();
      project = setup.project;
      accountAddress = setup.accountAddress;
    });

    it('Should reject claim before claimableAfter time', async function () {
      const amount = ethers.parseUnits('100', 6);
      const claimId = ethers.id('claim-001');
      const currentTime = await time.latest();
      const claimableAfter = currentTime + 7 * 24 * 60 * 60; // 7 days from now

      const appSignature = await signClaim(
        'test-app',
        'project-001',
        claimId,
        receiver1.address,
        amount,
        claimableAfter,
        0,
        appOwner,
      );

      const payment = {
        app: 'test-app',
        projectId: 'project-001',
        claimId: claimId,
        receiver: receiver1.address,
        amount: amount,
        claimableAfter: claimableAfter,
        claimDeadline: 0,
        appSignature: appSignature,
      };

      // Sign Pvium attestation
      const chainId = (await ethers.provider.getNetwork()).chainId;
      let dataPacked = '0x';
      dataPacked = ethers.AbiCoder.defaultAbiCoder().encode(
        ['bytes', 'string', 'string', 'bytes32'],
        [dataPacked, payment.app, payment.projectId, payment.claimId],
      );
      const pviumMessageHash = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
          ['bytes', 'uint256'],
          [dataPacked, chainId],
        ),
      );
      const pviumSignature = await pvium.signMessage(
        ethers.getBytes(pviumMessageHash),
      );

      await expect(
        factory.finalizeClaim([payment], pviumSignature),
      ).to.be.revertedWith('Claim not yet claimable');
    });

    it('Should allow claim after claimableAfter time', async function () {
      const amount = ethers.parseUnits('100', 6);
      const claimId = ethers.id('claim-002');
      const currentTime = await time.latest();
      const claimableAfter = currentTime;

      const appSignature = await signClaim(
        'test-app',
        'project-001',
        claimId,
        receiver1.address,
        amount,
        claimableAfter,
        0,
        appOwner,
      );

      const payment = {
        app: 'test-app',
        projectId: 'project-001',
        claimId: claimId,
        receiver: receiver1.address,
        amount: amount,
        claimableAfter: claimableAfter,
        claimDeadline: 0,
        appSignature: appSignature,
      };

      const chainId = (await ethers.provider.getNetwork()).chainId;
      let dataPacked = '0x';
      dataPacked = ethers.AbiCoder.defaultAbiCoder().encode(
        ['bytes', 'string', 'string', 'bytes32'],
        [dataPacked, payment.app, payment.projectId, payment.claimId],
      );
      const pviumMessageHash = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
          ['bytes', 'uint256'],
          [dataPacked, chainId],
        ),
      );
      const pviumSignature = await pvium.signMessage(
        ethers.getBytes(pviumMessageHash),
      );

      const vendorBalanceBefore = await mockUSDC.balanceOf(receiver1.address);

      await expect(factory.finalizeClaim([payment], pviumSignature)).to.emit(
        project,
        'ClaimFinalized',
      );

      const vendorBalanceAfter = await mockUSDC.balanceOf(receiver1.address);
      const appFee = (amount * BigInt(APP_FEE_BPS)) / 10000n;
      const pviumFee = (amount * BigInt(PVIUM_FEE_BPS)) / 10000n;
      const expectedVendorAmount = amount - appFee - pviumFee;

      expect(vendorBalanceAfter - vendorBalanceBefore).to.equal(
        expectedVendorAmount,
      );
    });

    it('Should reject claim after claimDeadline', async function () {
      const amount = ethers.parseUnits('100', 6);
      const claimId = ethers.id('claim-003');
      const currentTime = await time.latest();
      const claimableAfter = currentTime;
      const claimDeadline = currentTime + 1; // 1 second from now

      const appSignature = await signClaim(
        'test-app',
        'project-001',
        claimId,
        receiver1.address,
        amount,
        claimableAfter,
        claimDeadline,
        appOwner,
      );

      const payment = {
        app: 'test-app',
        projectId: 'project-001',
        claimId: claimId,
        receiver: receiver1.address,
        amount: amount,
        claimableAfter: claimableAfter,
        claimDeadline: claimDeadline,
        appSignature: appSignature,
      };

      // Fast forward past deadline
      await time.increase(2);

      const chainId = (await ethers.provider.getNetwork()).chainId;
      let dataPacked = '0x';
      dataPacked = ethers.AbiCoder.defaultAbiCoder().encode(
        ['bytes', 'string', 'string', 'bytes32'],
        [dataPacked, payment.app, payment.projectId, payment.claimId],
      );
      const pviumMessageHash = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
          ['bytes', 'uint256'],
          [dataPacked, chainId],
        ),
      );
      const pviumSignature = await pvium.signMessage(
        ethers.getBytes(pviumMessageHash),
      );

      await expect(
        factory.finalizeClaim([payment], pviumSignature),
      ).to.be.revertedWith('Claim deadline expired');
    });

    it('Should verify claim signature off-chain', async function () {
      const amount = ethers.parseUnits('100', 6);
      const claimId = ethers.id('claim-004');
      const currentTime = await time.latest();

      const appSignature = await signClaim(
        'test-app',
        'project-001',
        claimId,
        receiver1.address,
        amount,
        currentTime,
        0,
        appOwner,
      );

      const payment = {
        app: 'test-app',
        projectId: 'project-001',
        claimId: claimId,
        receiver: receiver1.address,
        amount: amount,
        claimableAfter: currentTime,
        claimDeadline: 0,
        appSignature: appSignature,
      };

      const isValid = await project.verifyPayoutSignature(payment);
      expect(isValid).to.be.true;
    });
  });

  describe('Disputes', function () {
    let project: SmartEscrow;
    let accountAddress: string;

    beforeEach(async function () {
      const setup = await setupActiveAccount();
      project = setup.project;
      accountAddress = setup.accountAddress;
    });

    it('Should allow app to raise dispute with signature', async function () {
      const claimId = ethers.id('dispute-claim-001');
      const chainId = (await ethers.provider.getNetwork()).chainId;

      const messageHash = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
          ['bytes32', 'uint256'],
          [claimId, chainId],
        ),
      );
      const signature = await appOwner.signMessage(
        ethers.getBytes(messageHash),
      );

      await expect(project.dispute(claimId, signature))
        .to.emit(project, 'DisputeRaised')
        .withArgs(claimId, appOwner.address);

      const dispute = await project.getDispute(claimId);
      expect(dispute.active).to.be.true;
      expect(dispute.raisedBy).to.equal(appOwner.address);
    });

    it('Should allow vendor to raise dispute with signature', async function () {
      const claimId = ethers.id('dispute-claim-002');
      const chainId = (await ethers.provider.getNetwork()).chainId;

      const messageHash = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
          ['bytes32', 'uint256'],
          [claimId, chainId],
        ),
      );
      const signature = await receiver1.signMessage(ethers.getBytes(messageHash));

      await expect(project.dispute(claimId, signature))
        .to.emit(project, 'DisputeRaised')
        .withArgs(claimId, receiver1.address);
    });

    it('Should reject dispute with invalid signature', async function () {
      const claimId = ethers.id('dispute-claim-003');
      const chainId = (await ethers.provider.getNetwork()).chainId;

      const messageHash = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
          ['bytes32', 'uint256'],
          [claimId, chainId],
        ),
      );
      // Sign with non-approved address
      const signature = await relayer.signMessage(ethers.getBytes(messageHash));

      await expect(project.dispute(claimId, signature)).to.be.revertedWith(
        'Invalid dispute signature',
      );
    });

    it('Should block claim finalization during active dispute', async function () {
      const amount = ethers.parseUnits('100', 6);
      const claimId = ethers.id('disputed-claim');
      const currentTime = await time.latest();

      // Raise dispute first
      const chainId = (await ethers.provider.getNetwork()).chainId;
      const disputeHash = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
          ['bytes32', 'uint256'],
          [claimId, chainId],
        ),
      );
      const disputeSignature = await appOwner.signMessage(
        ethers.getBytes(disputeHash),
      );
      await project.dispute(claimId, disputeSignature);

      // Try to finalize claim
      const appSignature = await signClaim(
        'test-app',
        'project-001',
        claimId,
        receiver1.address,
        amount,
        currentTime,
        0,
        appOwner,
      );

      const payment = {
        app: 'test-app',
        projectId: 'project-001',
        claimId: claimId,
        receiver: receiver1.address,
        amount: amount,
        claimableAfter: currentTime,
        claimDeadline: 0,
        appSignature: appSignature,
      };

      let dataPacked = '0x';
      dataPacked = ethers.AbiCoder.defaultAbiCoder().encode(
        ['bytes', 'string', 'string', 'bytes32'],
        [dataPacked, payment.app, payment.projectId, payment.claimId],
      );
      const pviumMessageHash = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
          ['bytes', 'uint256'],
          [dataPacked, chainId],
        ),
      );
      const pviumSignature = await pvium.signMessage(
        ethers.getBytes(pviumMessageHash),
      );

      await expect(
        factory.finalizeClaim([payment], pviumSignature),
      ).to.be.revertedWith('Claim is disputed');
    });

    it('Should keep dispute blocked after deadline expires', async function () {
      const amount = ethers.parseUnits('100', 6);
      const claimId = ethers.id('expired-dispute');
      const currentTime = await time.latest();

      // Raise dispute
      const chainId = (await ethers.provider.getNetwork()).chainId;
      const disputeHash = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
          ['bytes32', 'uint256'],
          [claimId, chainId],
        ),
      );
      const disputeSignature = await appOwner.signMessage(
        ethers.getBytes(disputeHash),
      );
      await project.dispute(claimId, disputeSignature);

      // Fast forward past dispute deadline
      await time.increase(DISPUTE_WINDOW + 1);

      // Try to finalize claim - should STILL be blocked (no auto-clearing)
      const appSignature = await signClaim(
        'test-app',
        'project-001',
        claimId,
        receiver1.address,
        amount,
        currentTime,
        0,
        appOwner,
      );

      const payment = {
        app: 'test-app',
        projectId: 'project-001',
        claimId: claimId,
        receiver: receiver1.address,
        amount: amount,
        claimableAfter: currentTime,
        claimDeadline: 0,
        appSignature: appSignature,
      };

      let dataPacked = '0x';
      dataPacked = ethers.AbiCoder.defaultAbiCoder().encode(
        ['bytes', 'string', 'string', 'bytes32'],
        [dataPacked, payment.app, payment.projectId, payment.claimId],
      );
      const pviumMessageHash = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
          ['bytes', 'uint256'],
          [dataPacked, chainId],
        ),
      );
      const pviumSignature = await pvium.signMessage(
        ethers.getBytes(pviumMessageHash),
      );

      // Claim should still be disputed even after deadline
      await expect(
        factory.finalizeClaim([payment], pviumSignature),
      ).to.be.revertedWith('Claim is disputed');

      // Dispute should still be active
      const dispute = await project.getDispute(claimId);
      expect(dispute.active).to.be.true;
    });

    it('Should resolve dispute and cancel claim', async function () {
      const claimId = ethers.id('resolve-cancel');
      const chainId = (await ethers.provider.getNetwork()).chainId;

      // Raise dispute
      const disputeHash = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
          ['bytes32', 'uint256'],
          [claimId, chainId],
        ),
      );
      const disputeSignature = await appOwner.signMessage(
        ethers.getBytes(disputeHash),
      );
      await project.dispute(claimId, disputeSignature);

      // Resolve dispute - reject claim
      const resolveHash = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
          ['bytes32', 'bool', 'uint256'],
          [claimId, false, chainId],
        ),
      );
      const appResolveSignature = await appOwner.signMessage(
        ethers.getBytes(resolveHash),
      );
      const pviumResolveSignature = await pvium.signMessage(
        ethers.getBytes(resolveHash),
      );

      await expect(
        project.resolveDispute(
          claimId,
          false,
          appResolveSignature,
          pviumResolveSignature,
        ),
      )
        .to.emit(project, 'DisputeResolved')
        .withArgs(claimId, false);

      // Claim should be permanently cancelled
      expect(await project.isCancelled(claimId)).to.be.true;
    });

    it('Should resolve dispute and allow claim', async function () {
      const claimId = ethers.id('resolve-allow');
      const chainId = (await ethers.provider.getNetwork()).chainId;

      // Raise dispute
      const disputeHash = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
          ['bytes32', 'uint256'],
          [claimId, chainId],
        ),
      );
      const disputeSignature = await appOwner.signMessage(
        ethers.getBytes(disputeHash),
      );
      await project.dispute(claimId, disputeSignature);

      // Resolve dispute - allow claim
      const resolveHash = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
          ['bytes32', 'bool', 'uint256'],
          [claimId, true, chainId],
        ),
      );
      const appResolveSignature = await appOwner.signMessage(
        ethers.getBytes(resolveHash),
      );
      const pviumResolveSignature = await pvium.signMessage(
        ethers.getBytes(resolveHash),
      );

      await expect(
        project.resolveDispute(
          claimId,
          true,
          appResolveSignature,
          pviumResolveSignature,
        ),
      )
        .to.emit(project, 'DisputeResolved')
        .withArgs(claimId, true);

      // Dispute should be cleared, claim not cancelled
      const dispute = await project.getDispute(claimId);
      expect(dispute.active).to.be.false;
      expect(await project.isCancelled(claimId)).to.be.false;
    });
  });

  describe('Refunds', function () {
    let project: SmartEscrow;
    let accountAddress: string;

    beforeEach(async function () {
      const setup = await setupActiveAccount();
      project = setup.project;
      accountAddress = setup.accountAddress;
    });

    it('Should process refund with zero Pvium fee', async function () {
      const refundAmount = ethers.parseUnits('100', 6);
      const claimId = ethers.id('refund-001');
      const currentTime = await time.latest();

      const appSignature = await signClaim(
        'test-app',
        'project-001',
        claimId,
        projectOwner.address,
        refundAmount,
        currentTime,
        0,
        appOwner,
      );

      const payment = {
        app: 'test-app',
        projectId: 'project-001',
        claimId: claimId,
        receiver: projectOwner.address, // Refund to project owner
        amount: refundAmount,
        claimableAfter: currentTime,
        claimDeadline: 0,
        appSignature: appSignature,
      };

      const chainId = (await ethers.provider.getNetwork()).chainId;
      let dataPacked = '0x';
      dataPacked = ethers.AbiCoder.defaultAbiCoder().encode(
        ['bytes', 'string', 'string', 'bytes32'],
        [dataPacked, payment.app, payment.projectId, payment.claimId],
      );
      const pviumMessageHash = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
          ['bytes', 'uint256'],
          [dataPacked, chainId],
        ),
      );
      const pviumSignature = await pvium.signMessage(
        ethers.getBytes(pviumMessageHash),
      );

      const projectOwnerBalanceBefore = await mockUSDC.balanceOf(
        projectOwner.address,
      );
      const pviumBalanceBefore = await mockUSDC.balanceOf(pvium.address);

      await factory.finalizeClaim([payment], pviumSignature);

      const projectOwnerBalanceAfter = await mockUSDC.balanceOf(
        projectOwner.address,
      );
      const pviumBalanceAfter = await mockUSDC.balanceOf(pvium.address);

      // Account owner gets refund minus app fee (NO Pvium fee)
      const appFee = (refundAmount * BigInt(APP_FEE_BPS)) / 10000n;
      const expectedRefund = refundAmount - appFee;

      expect(projectOwnerBalanceAfter - projectOwnerBalanceBefore).to.equal(
        expectedRefund,
      );
      // Pvium should get ZERO fee
      expect(pviumBalanceAfter - pviumBalanceBefore).to.equal(0);
    });

    it('Should reject refund to non-refundAddress', async function () {
      const refundAmount = ethers.parseUnits('100', 6);
      const claimId = ethers.id('refund-002');
      const currentTime = await time.latest();

      // Try to refund to wrong address
      const appSignature = await signClaim(
        'test-app',
        'project-001',
        claimId,
        relayer.address, // Wrong refund address
        refundAmount,
        currentTime,
        0,
        appOwner,
      );

      const payment = {
        app: 'test-app',
        projectId: 'project-001',
        claimId: claimId,
        receiver: relayer.address,
        amount: refundAmount,
        claimableAfter: currentTime,
        claimDeadline: 0,
        appSignature: appSignature,
      };

      const chainId = (await ethers.provider.getNetwork()).chainId;
      let dataPacked = '0x';
      dataPacked = ethers.AbiCoder.defaultAbiCoder().encode(
        ['bytes', 'string', 'string', 'bytes32'],
        [dataPacked, payment.app, payment.projectId, payment.claimId],
      );
      const pviumMessageHash = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
          ['bytes', 'uint256'],
          [dataPacked, chainId],
        ),
      );
      const pviumSignature = await pvium.signMessage(
        ethers.getBytes(pviumMessageHash),
      );

      await expect(
        factory.finalizeClaim([payment], pviumSignature),
      ).to.be.revertedWith('Receiver not approved');
    });
  });

  describe('Multi-Token Batch Processing', function () {
    let projectUSDC: SmartEscrow;
    let projectUSDT: SmartEscrow;
    let projectUSDCAddress: string;
    let projectUSDTAddress: string;

    beforeEach(async function () {
      // Create two projects with different tokens
      projectUSDCAddress = await createTestAccount(
        'test-app',
        'usdc-project',
        await mockUSDC.getAddress(),
      );
      projectUSDC = await ethers.getContractAt(
        'SmartEscrow',
        projectUSDCAddress,
      );

      projectUSDTAddress = await createTestAccount(
        'test-app',
        'usdt-project',
        await mockUSDT.getAddress(),
      );
      projectUSDT = await ethers.getContractAt(
        'SmartEscrow',
        projectUSDTAddress,
      );

      // Setup both projects
      await projectUSDC
        .connect(appOwner)
        .addReceivers([receiver1.address], EMPTY_CALL_SIG);
      await projectUSDT
        .connect(appOwner)
        .addReceivers([receiver2.address], EMPTY_CALL_SIG);

      const minBalance = ethers.parseUnits('500', 6);

      await mockUSDC
        .connect(projectOwner)
        .approve(projectUSDCAddress, minBalance);
      await projectUSDC.connect(projectOwner).fundAccount(minBalance);
      await projectUSDC.connect(appOwner).activateAccount(EMPTY_CALL_SIG);

      await mockUSDT
        .connect(projectOwner)
        .approve(projectUSDTAddress, minBalance);
      await projectUSDT.connect(projectOwner).fundAccount(minBalance);
      await projectUSDT.connect(appOwner).activateAccount(EMPTY_CALL_SIG);
    });

    it('Should batch process claims across different tokens', async function () {
      const usdcAmount = ethers.parseUnits('100', 6);
      const usdtAmount = ethers.parseUnits('100', 6); // Changed from 200 to 100 to stay under maxPayout of 150
      const currentTime = await time.latest();

      // Create USDC claim
      const usdcClaimId = ethers.id('usdc-batch-claim');
      const usdcSignature = await signClaim(
        'test-app',
        'usdc-project',
        usdcClaimId,
        receiver1.address,
        usdcAmount,
        currentTime,
        0,
        appOwner,
      );

      // Create USDT claim
      const usdtClaimId = ethers.id('usdt-batch-claim');
      const usdtSignature = await signClaim(
        'test-app',
        'usdt-project',
        usdtClaimId,
        receiver2.address,
        usdtAmount,
        currentTime,
        0,
        appOwner,
      );

      const payments = [
        {
          app: 'test-app',
          projectId: 'usdc-project',
          claimId: usdcClaimId,
          receiver: receiver1.address,
          amount: usdcAmount,
          claimableAfter: currentTime,
          claimDeadline: 0,
          appSignature: usdcSignature,
        },
        {
          app: 'test-app',
          projectId: 'usdt-project',
          claimId: usdtClaimId,
          receiver: receiver2.address,
          amount: usdtAmount,
          claimableAfter: currentTime,
          claimDeadline: 0,
          appSignature: usdtSignature,
        },
      ];

      // Pvium signs the batch
      const chainId = (await ethers.provider.getNetwork()).chainId;

      // Build abi.encode compatible structure
      let dataPacked = '0x';
      for (const payment of payments) {
        dataPacked = ethers.AbiCoder.defaultAbiCoder().encode(
          ['bytes', 'string', 'string', 'bytes32'],
          [dataPacked, payment.app, payment.projectId, payment.claimId],
        );
      }

      const pviumMessageHash = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
          ['bytes', 'uint256'],
          [dataPacked, chainId],
        ),
      );
      const pviumSignature = await pvium.signMessage(
        ethers.getBytes(pviumMessageHash),
      );

      const vendor1USDCBefore = await mockUSDC.balanceOf(receiver1.address);
      const vendor2USDTBefore = await mockUSDT.balanceOf(receiver2.address);
      const pviumUSDCBefore = await mockUSDC.balanceOf(pvium.address);
      const pviumUSDTBefore = await mockUSDT.balanceOf(pvium.address);

      await factory.finalizeClaim(payments, pviumSignature);

      const vendor1USDCAfter = await mockUSDC.balanceOf(receiver1.address);
      const vendor2USDTAfter = await mockUSDT.balanceOf(receiver2.address);
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

  describe('Emergency Withdrawal After Lock Expiry', function () {
    let project: SmartEscrow;
    let accountAddress: string;
    const minBalance = ethers.parseUnits('100', 6);
    const maxWithdrawal = ethers.parseUnits('150', 6);

    beforeEach(async function () {
      // Create account with specific min and max withdrawal amounts
      accountAddress = await createTestAccount(
        'test-app',
        'withdrawal-test',
        await mockUSDC.getAddress(),
        minBalance,
        maxWithdrawal,
        3, // 3 vendors
      );
      project = await ethers.getContractAt('SmartEscrow', accountAddress);

      // Add 3 vendors
      await project
        .connect(appOwner)
        .addReceivers([receiver1.address, receiver2.address, relayer.address], EMPTY_CALL_SIG);

      // Calculate required balance based on maxPayout (not basePayout)
      const numReceivers = 3n;
      const totalMaxPayout = maxWithdrawal * numReceivers; // $450
      const totalFees = (totalMaxPayout * BigInt(APP_FEE_BPS + PVIUM_FEE_BPS)) / 10000n;
      const fundAmount = totalMaxPayout + totalFees;

      await mockUSDC.connect(projectOwner).approve(accountAddress, fundAmount);
      await project.connect(projectOwner).fundAccount(fundAmount);

      // Activate
      await project.connect(appOwner).activateAccount(EMPTY_CALL_SIG);
    });

    it('Should reject withdrawal before lock expiry', async function () {
      await expect(project.connect(receiver1).withdraw()).to.be.revertedWith(
        'Lock duration not expired',
      );
    });

    it('Should pay all unpaid vendors and send surplus to refundAddress', async function () {
      // Fast forward past lock duration
      const lockDuration = await project.lockDurationSeconds();
      await time.increase(lockDuration);

      const vendor1BalanceBefore = await mockUSDC.balanceOf(receiver1.address);
      const vendor2BalanceBefore = await mockUSDC.balanceOf(receiver2.address);
      const relayerBalanceBefore = await mockUSDC.balanceOf(relayer.address);
      const refundBalanceBefore = await mockUSDC.balanceOf(projectOwner.address);

      // Anyone can call withdraw
      await expect(project.connect(receiver1).withdraw())
        .to.emit(project, 'BasePayWithdrawal');

      const vendor1BalanceAfter = await mockUSDC.balanceOf(receiver1.address);
      const vendor2BalanceAfter = await mockUSDC.balanceOf(receiver2.address);
      const relayerBalanceAfter = await mockUSDC.balanceOf(relayer.address);
      const refundBalanceAfter = await mockUSDC.balanceOf(projectOwner.address);

      // With activation funding of maxPayout * 3 + fees ≈ $461.25:
      // Withdraw pays basePayout ($100) to each unpaid receiver
      // All 3 receivers get $100 each (basePayout)
      expect(vendor1BalanceAfter - vendor1BalanceBefore).to.equal(minBalance);
      expect(vendor2BalanceAfter - vendor2BalanceBefore).to.equal(minBalance);
      expect(relayerBalanceAfter - relayerBalanceBefore).to.equal(minBalance);

      // RefundAddress should receive surplus: ~$461.25 - (3 × $100) = ~$161.25
      const totalPaidToReceivers = minBalance * 3n;
      const expectedRefund = (maxWithdrawal * 3n + (maxWithdrawal * 3n * BigInt(APP_FEE_BPS + PVIUM_FEE_BPS)) / 10000n) - totalPaidToReceivers;
      expect(refundBalanceAfter - refundBalanceBefore).to.equal(expectedRefund);
    });

    it('Should skip vendors already paid via finalizeClaim', async function () {
      // Pay vendor1 via finalizeClaim first (even a small amount)
      const paymentAmount = ethers.parseUnits('50', 6); // $50 (less than min)
      const claimId = ethers.id('partial-payment');
      const currentTime = await time.latest();

      const appSignature = await signClaim(
        'test-app',
        'withdrawal-test',
        claimId,
        receiver1.address,
        paymentAmount,
        currentTime,
        0,
        appOwner,
      );

      const payment = {
        app: 'test-app',
        projectId: 'withdrawal-test',
        claimId: claimId,
        receiver: receiver1.address,
        amount: paymentAmount,
        claimableAfter: currentTime,
        claimDeadline: 0,
        appSignature: appSignature,
      };

      const chainId = (await ethers.provider.getNetwork()).chainId;
      let dataPacked = '0x';
      dataPacked = ethers.AbiCoder.defaultAbiCoder().encode(
        ['bytes', 'string', 'string', 'bytes32'],
        [dataPacked, payment.app, payment.projectId, payment.claimId],
      );
      const pviumMessageHash = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
          ['bytes', 'uint256'],
          [dataPacked, chainId],
        ),
      );
      const pviumSignature = await pvium.signMessage(
        ethers.getBytes(pviumMessageHash),
      );

      await factory.finalizeClaim([payment], pviumSignature);

      // Verify receiver1 has been paid
      expect(await project.totalPaidToReceiver(receiver1.address)).to.be.greaterThan(0);

      // Fast forward past lock duration
      const lockDuration = await project.lockDurationSeconds();
      await time.increase(lockDuration);

      const vendor1BalanceBefore = await mockUSDC.balanceOf(receiver1.address);
      const vendor2BalanceBefore = await mockUSDC.balanceOf(receiver2.address);

      // Call withdraw
      await project.connect(receiver2).withdraw();

      const vendor1BalanceAfter = await mockUSDC.balanceOf(receiver1.address);
      const vendor2BalanceAfter = await mockUSDC.balanceOf(receiver2.address);

      // Vendor1 should NOT receive anything (already paid)
      expect(vendor1BalanceAfter - vendor1BalanceBefore).to.equal(0);

      // Vendor2 should receive basePayout ($100), not maxWithdrawal
      expect(vendor2BalanceAfter - vendor2BalanceBefore).to.equal(minBalance);
    });

    it('Should handle insufficient funds gracefully', async function () {
      // Create account with insufficient funds
      const testMaxPayout = ethers.parseUnits('100', 6);
      const testBasePayout = ethers.parseUnits('50', 6);
      const insufficientAccount = await createTestAccount(
        'test-app',
        'insufficient-funds',
        await mockUSDC.getAddress(),
        testBasePayout, // $50 min
        testMaxPayout, // $100 max
        3, // 3 vendors
      );
      const project2 = await ethers.getContractAt('SmartEscrow', insufficientAccount);

      await project2
        .connect(appOwner)
        .addReceivers([receiver1.address, receiver2.address, relayer.address], EMPTY_CALL_SIG);

      // Fund with exact amount for activation (maxPayout * 3 + fees)
      const totalMaxPayout = testMaxPayout * 3n;
      const totalFees = (totalMaxPayout * BigInt(APP_FEE_BPS + PVIUM_FEE_BPS)) / 10000n;
      const minFunding = totalMaxPayout + totalFees;
      await mockUSDC.connect(projectOwner).approve(insufficientAccount, minFunding);
      await project2.connect(projectOwner).fundAccount(minFunding);
      await project2.connect(appOwner).activateAccount(EMPTY_CALL_SIG);

      // Fast forward
      const lockDuration = await project2.lockDurationSeconds();
      await time.increase(lockDuration);

      const vendor1Before = await mockUSDC.balanceOf(receiver1.address);
      const vendor2Before = await mockUSDC.balanceOf(receiver2.address);
      const relayerBefore = await mockUSDC.balanceOf(relayer.address);

      // Call withdraw
      await project2.connect(receiver1).withdraw();

      const vendor1After = await mockUSDC.balanceOf(receiver1.address);
      const vendor2After = await mockUSDC.balanceOf(receiver2.address);
      const relayerAfter = await mockUSDC.balanceOf(relayer.address);

      // With activation funding of maxPayout * 3 + fees ≈ $307.50:
      // Withdraw pays basePayout ($50) to each unpaid receiver
      // All 3 receivers get $50 each
      expect(vendor1After - vendor1Before).to.equal(testBasePayout);
      expect(vendor2After - vendor2Before).to.equal(testBasePayout);
      expect(relayerAfter - relayerBefore).to.equal(testBasePayout);
    });

    it('Should be idempotent - multiple calls dont duplicate payments', async function () {
      // Fast forward
      const lockDuration = await project.lockDurationSeconds();
      await time.increase(lockDuration);

      const vendor1Before = await mockUSDC.balanceOf(receiver1.address);

      // First call
      await project.connect(receiver1).withdraw();

      const vendor1After = await mockUSDC.balanceOf(receiver1.address);
      const firstPayment = vendor1After - vendor1Before;

      // Second call - should do nothing (all vendors already withdrawn)
      await project.connect(receiver2).withdraw();

      const vendor1Final = await mockUSDC.balanceOf(receiver1.address);

      // Vendor1 balance shouldn't change on second call
      expect(vendor1Final).to.equal(vendor1After);
      expect(firstPayment).to.be.greaterThan(0);
    });

    it('Should send surplus to refundAddress when vendors get less than max', async function () {
      // Create account with more funds than needed
      const surplusAccount = await createTestAccount(
        'test-app',
        'surplus-test',
        await mockUSDC.getAddress(),
        ethers.parseUnits('100', 6), // $100 min
        ethers.parseUnits('150', 6), // $150 max
        2, // Only 2 vendors
      );
      const project3 = await ethers.getContractAt('SmartEscrow', surplusAccount);

      await project3
        .connect(appOwner)
        .addReceivers([receiver1.address, receiver2.address], EMPTY_CALL_SIG);

      // Fund with extra ($500 total, but only need 2 × $150 = $300)
      const extraFunding = ethers.parseUnits('500', 6);
      await mockUSDC.connect(projectOwner).approve(surplusAccount, extraFunding);
      await project3.connect(projectOwner).fundAccount(extraFunding);
      await project3.connect(appOwner).activateAccount(EMPTY_CALL_SIG);

      // Fast forward
      const lockDuration = await project3.lockDurationSeconds();
      await time.increase(lockDuration);

      const refundBefore = await mockUSDC.balanceOf(projectOwner.address);

      // Call withdraw
      await project3.connect(receiver1).withdraw();

      const refundAfter = await mockUSDC.balanceOf(projectOwner.address);

      // RefundAddress should receive surplus: $500 - (2 × $100) = $300
      expect(refundAfter - refundBefore).to.equal(ethers.parseUnits('300', 6));
    });
  });
});
