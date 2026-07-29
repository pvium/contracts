import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";
import { MerkleTree } from "merkletreejs";
import keccak256 from "keccak256";

const HARDHAT_DEFAULT_MNEMONIC =
  "test test test test test test test test test test test junk";
const DEFAULT_LOCK_DURATION = 30 * 24 * 60 * 60;

interface EscrowPaymentEntry {
  receiverAddress: string;
  amount: string;
  claimableDate: number;
  memo: string;
}

function getRawSigningWallet(signerAddress: string): ethers.HDNodeWallet {
  for (let index = 0; index < 20; index += 1) {
    const wallet = ethers.HDNodeWallet.fromPhrase(
      HARDHAT_DEFAULT_MNEMONIC,
      undefined,
      `m/44'/60'/0'/0/${index}`
    );

    if (wallet.address.toLowerCase() === signerAddress.toLowerCase()) {
      return wallet;
    }
  }

  throw new Error(`No raw wallet found for ${signerAddress}`);
}

function signDigest(signerAddress: string, digest: string): string {
  return getRawSigningWallet(signerAddress).signingKey.sign(digest).serialized;
}

function escrowBatchHash(
  externalBatchId: string,
  fundingToken: string,
  lockDuration: number,
  timestamp: number,
  chainId: number
): string {
  return ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["bytes32", "address", "uint256", "uint256", "uint256"],
      [externalBatchId, fundingToken, lockDuration, timestamp, chainId]
    )
  );
}

function escrowBatchId(signer: string, batchHash: string): string {
  return ethers.keccak256(
    ethers.solidityPacked(["address", "bytes32"], [signer, batchHash])
  );
}

function leafHash(
  batchHash: string,
  payment: EscrowPaymentEntry
): Buffer {
  const encoded = ethers.solidityPacked(
    ["bytes32", "address", "uint256", "uint256", "string"],
    [
      batchHash,
      payment.receiverAddress,
      payment.amount,
      payment.claimableDate,
      payment.memo,
    ]
  );
  return Buffer.from(keccak256(encoded));
}

function buildTree(
  batchHash: string,
  payments: EscrowPaymentEntry[]
): MerkleTree {
  return new MerkleTree(
    payments.map((payment) => leafHash(batchHash, payment)),
    keccak256,
    { sortPairs: true }
  );
}

function signRoot(
  signerAddress: string,
  batchHash: string,
  merkleRoot: string
): string {
  const digest = ethers.keccak256(
    ethers.solidityPacked(
      ["bytes32", "bytes32"],
      [batchHash, merkleRoot]
    )
  );
  return signDigest(signerAddress, digest);
}

interface PayoutSignerAuth {
  signingKey: string;
  transactionMax: bigint | string | number;
  totalMax: bigint | string | number;
  expiration: bigint | string | number;
  timestamp: bigint | string | number;
  signature: string;
}

const EMPTY_AUTH: PayoutSignerAuth = {
  signingKey: ethers.ZeroAddress,
  transactionMax: 0,
  totalMax: 0,
  expiration: 0,
  timestamp: 0,
  signature: '0x',
};

function signAuth(
  batchSignerAddress: string,
  batchHash: string,
  delegate: string,
  transactionMax: bigint | string | number,
  totalMax: bigint | string | number,
  expiration: bigint | string | number,
  timestamp: bigint | string | number,
): PayoutSignerAuth {
  const digest = ethers.keccak256(
    ethers.solidityPacked(
      ['bytes32', 'address', 'uint256', 'uint256', 'uint256', 'uint256'],
      [
        batchHash,
        delegate,
        transactionMax,
        totalMax,
        expiration,
        timestamp,
      ],
    ),
  );
  return {
    signingKey: delegate,
    transactionMax,
    totalMax,
    expiration,
    timestamp,
    signature: signDigest(batchSignerAddress, digest),
  };
}

describe("EscrowBatchPayout", function () {
  let escrowBatchPayout: any;
  let mockToken: any;
  let signer: any;
  let receiver1: any;
  let receiver2: any;
  let other: any;

  beforeEach(async function () {
    [, signer, receiver1, receiver2, other] = await ethers.getSigners();

    const MockToken = await ethers.getContractFactory("MockERC20");
    mockToken = await MockToken.deploy(
      "Test Token",
      "TEST",
      ethers.parseUnits("10000", 18)
    );
    await mockToken.waitForDeployment();

    const EscrowBatchPayout = await ethers.getContractFactory("EscrowBatchPayout");
    escrowBatchPayout = await EscrowBatchPayout.deploy();
    await escrowBatchPayout.waitForDeployment();

    await mockToken.transfer(signer.address, ethers.parseUnits("1000", 18));
    await mockToken
      .connect(signer)
      .approve(await escrowBatchPayout.getAddress(), ethers.MaxUint256);
  });

  async function createEscrow(
    amount = ethers.parseUnits("300", 18),
    lockDuration = DEFAULT_LOCK_DURATION
  ) {
    const timestamp = Math.floor(Date.now() / 1000);
    const externalBatchId = ethers.id(`escrow-${timestamp}-${Math.random()}`);
    const chainId = Number((await ethers.provider.getNetwork()).chainId);
    const batchHash = escrowBatchHash(
      externalBatchId,
      await mockToken.getAddress(),
      lockDuration,
      timestamp,
      chainId
    );
    const batchId = escrowBatchId(signer.address, batchHash);

    await expect(
      escrowBatchPayout.connect(signer).createEscrow(
        externalBatchId,
        timestamp,
        signer.address,
        await mockToken.getAddress(),
        amount,
        lockDuration,
        ethers.ZeroAddress,
        "0x"
      )
    ).to.emit(escrowBatchPayout, "EscrowBatchCreated");

    return { externalBatchId, timestamp, batchHash, batchId, lockDuration };
  }

  it("creates and funds an escrow batch", async function () {
    const { batchId } = await createEscrow();

    const batch = await escrowBatchPayout.getEscrowBatch(batchId);
    expect(batch.exists).to.equal(true);
    expect(batch.signer).to.equal(signer.address);
    expect(batch.fundingToken).to.equal(await mockToken.getAddress());
    expect(batch.totalFunded).to.equal(ethers.parseUnits("300", 18));
    expect(batch.totalClaimed).to.equal(0);
    expect(batch.totalWithdrawn).to.equal(0);
    expect(batch.lockDuration).to.equal(DEFAULT_LOCK_DURATION);
  });

  it("claims from multiple off-chain merkle roots under one escrow", async function () {
    const { batchHash, batchId } = await createEscrow();
    const now = await time.latest();

    const payment1 = {
      receiverAddress: receiver1.address,
      amount: ethers.parseUnits("100", 18).toString(),
      claimableDate: now,
      memo: "Escrow payment 1",
    };
    const payment2 = {
      receiverAddress: receiver2.address,
      amount: ethers.parseUnits("75", 18).toString(),
      claimableDate: now,
      memo: "Escrow payment 2",
    };

    const tree1 = buildTree(batchHash, [payment1]);
    const tree2 = buildTree(batchHash, [payment2]);
    const root1 = `0x${tree1.getRoot().toString("hex")}`;
    const root2 = `0x${tree2.getRoot().toString("hex")}`;

    await escrowBatchPayout.claimPayment(
      {
        receiver: payment1.receiverAddress,
        amount: payment1.amount,
        claimDate: payment1.claimableDate,
        memo: payment1.memo,
      },
      batchId,
      batchHash,
      root1,
      signRoot(signer.address, batchHash, root1),
      tree1.getHexProof(leafHash(batchHash, payment1)),
      EMPTY_AUTH
    );

    await escrowBatchPayout.claimPayment(
      {
        receiver: payment2.receiverAddress,
        amount: payment2.amount,
        claimDate: payment2.claimableDate,
        memo: payment2.memo,
      },
      batchId,
      batchHash,
      root2,
      signRoot(signer.address, batchHash, root2),
      tree2.getHexProof(leafHash(batchHash, payment2)),
      EMPTY_AUTH
    );

    expect(await mockToken.balanceOf(receiver1.address)).to.equal(payment1.amount);
    expect(await mockToken.balanceOf(receiver2.address)).to.equal(payment2.amount);

    const batch = await escrowBatchPayout.getEscrowBatch(batchId);
    expect(batch.totalClaimed).to.equal(
      BigInt(payment1.amount) + BigInt(payment2.amount)
    );
    expect(batch.claimCount).to.equal(2);
  });

  it("rejects roots that were not signed by the escrow payout signer", async function () {
    const { batchHash, batchId } = await createEscrow();
    const now = await time.latest();
    const payment = {
      receiverAddress: receiver1.address,
      amount: ethers.parseUnits("100", 18).toString(),
      claimableDate: now,
      memo: "Bad root signature",
    };
    const tree = buildTree(batchHash, [payment]);
    const root = `0x${tree.getRoot().toString("hex")}`;

    await expect(
      escrowBatchPayout.claimPayment(
        {
          receiver: payment.receiverAddress,
          amount: payment.amount,
          claimDate: payment.claimableDate,
          memo: payment.memo,
        },
        batchId,
        batchHash,
        root,
        signRoot(other.address, batchHash, root),
        tree.getHexProof(leafHash(batchHash, payment)),
        EMPTY_AUTH,
      ),
    ).to.be.revertedWith(
      'Invalid root signature and no signer authorization provided',
    );
  });

  it("does not allow a root signed for one escrow to be replayed on another escrow", async function () {
    const firstEscrow = await createEscrow();
    const secondEscrow = await createEscrow();
    const now = await time.latest();
    const payment = {
      receiverAddress: receiver1.address,
      amount: ethers.parseUnits("50", 18).toString(),
      claimableDate: now,
      memo: "First escrow claim",
    };
    const tree = buildTree(firstEscrow.batchHash, [payment]);
    const root = `0x${tree.getRoot().toString("hex")}`;

    await escrowBatchPayout.claimPayment(
      {
        receiver: payment.receiverAddress,
        amount: payment.amount,
        claimDate: payment.claimableDate,
        memo: payment.memo,
      },
      firstEscrow.batchId,
      firstEscrow.batchHash,
      root,
      signRoot(signer.address, firstEscrow.batchHash, root),
      tree.getHexProof(leafHash(firstEscrow.batchHash, payment)),
      EMPTY_AUTH
    );

    await expect(
      escrowBatchPayout.claimPayment(
        {
          receiver: payment.receiverAddress,
          amount: payment.amount,
          claimDate: payment.claimableDate,
          memo: payment.memo,
        },
        secondEscrow.batchId,
        firstEscrow.batchHash,
        root,
        signRoot(signer.address, firstEscrow.batchHash, root),
        tree.getHexProof(leafHash(firstEscrow.batchHash, payment)),
        EMPTY_AUTH,
      ),
    ).to.be.revertedWith(
      'Invalid root signature and no signer authorization provided',
    );
  });

  it("rejects withdrawals before the lock duration expires", async function () {
    const { batchId } = await createEscrow();

    await expect(
      escrowBatchPayout
        .connect(signer)
        .withdrawEscrowFunds(batchId, ethers.parseUnits("50", 18))
    ).to.be.revertedWith("Escrow still locked");
  });

  it("withdraws remaining funds after the lock duration expires and tracks withdrawals", async function () {
    const lockDuration = 7 * 24 * 60 * 60;
    const { batchId } = await createEscrow(
      ethers.parseUnits("300", 18),
      lockDuration
    );

    await time.increase(lockDuration + 1);

    await expect(
      escrowBatchPayout
        .connect(signer)
        .withdrawEscrowFunds(batchId, ethers.parseUnits("125", 18))
    )
      .to.emit(escrowBatchPayout, "EscrowFundsWithdrawn")
      .withArgs(
        batchId,
        signer.address,
        signer.address,
        ethers.parseUnits("125", 18)
      );

    const batch = await escrowBatchPayout.getEscrowBatch(batchId);
    expect(batch.totalWithdrawn).to.equal(ethers.parseUnits("125", 18));
    expect(await escrowBatchPayout.getRemainingFunds(batchId)).to.equal(
      ethers.parseUnits("175", 18)
    );
  });

  it("allows the withdrawal wallet to set a longer lock duration but not shorten it", async function () {
    const { batchId } = await createEscrow();
    const extendedDuration = DEFAULT_LOCK_DURATION + 7 * 24 * 60 * 60;

    await expect(
      escrowBatchPayout
        .connect(signer)
        .setLockDuration(batchId, extendedDuration)
    )
      .to.emit(escrowBatchPayout, "EscrowLockDurationSet")
      .withArgs(batchId, DEFAULT_LOCK_DURATION, extendedDuration);

    await expect(
      escrowBatchPayout
        .connect(signer)
        .setLockDuration(batchId, DEFAULT_LOCK_DURATION)
    ).to.be.revertedWith("Lock duration can only increase");
  });

  it("allows claims after the lock duration expires when funds remain", async function () {
    const lockDuration = 60;
    const { batchHash, batchId } = await createEscrow(
      ethers.parseUnits("300", 18),
      lockDuration
    );
    const now = await time.latest();
    const payment = {
      receiverAddress: receiver1.address,
      amount: ethers.parseUnits("100", 18).toString(),
      claimableDate: now,
      memo: "Expired escrow payment",
    };
    const tree = buildTree(batchHash, [payment]);
    const root = `0x${tree.getRoot().toString("hex")}`;

    await time.increase(lockDuration + 1);

    await escrowBatchPayout.claimPayment(
      {
        receiver: payment.receiverAddress,
        amount: payment.amount,
        claimDate: payment.claimableDate,
        memo: payment.memo,
      },
      batchId,
      batchHash,
      root,
      signRoot(signer.address, batchHash, root),
      tree.getHexProof(leafHash(batchHash, payment)),
      EMPTY_AUTH
    );

    expect(await mockToken.balanceOf(receiver1.address)).to.equal(payment.amount);
  });

  it("rejects claims when withdrawn funds leave insufficient remaining escrow balance", async function () {
    const lockDuration = 60;
    const { batchHash, batchId } = await createEscrow(
      ethers.parseUnits("300", 18),
      lockDuration
    );
    const now = await time.latest();
    const payment = {
      receiverAddress: receiver1.address,
      amount: ethers.parseUnits("100", 18).toString(),
      claimableDate: now,
      memo: "Post-withdrawal escrow payment",
    };
    const tree = buildTree(batchHash, [payment]);
    const root = `0x${tree.getRoot().toString("hex")}`;

    await time.increase(lockDuration + 1);
    await escrowBatchPayout
      .connect(signer)
      .withdrawEscrowFunds(batchId, ethers.parseUnits("250", 18));

    await expect(
      escrowBatchPayout.claimPayment(
        {
          receiver: payment.receiverAddress,
          amount: payment.amount,
          claimDate: payment.claimableDate,
          memo: payment.memo,
        },
        batchId,
        batchHash,
        root,
        signRoot(signer.address, batchHash, root),
        tree.getHexProof(leafHash(batchHash, payment)),
        EMPTY_AUTH
      )
    ).to.be.revertedWith("Insufficient fund in pool");
  });

  describe("delegated payout signer", function () {
    const AUTH_TIMESTAMP = 1_700_000_000;

    async function claimAsDelegate(
      batchHash: string,
      batchId: string,
      payment: EscrowPaymentEntry,
      auth: PayoutSignerAuth
    ) {
      const tree = buildTree(batchHash, [payment]);
      const root = `0x${tree.getRoot().toString("hex")}`;
      return escrowBatchPayout.claimPayment(
        {
          receiver: payment.receiverAddress,
          amount: payment.amount,
          claimDate: payment.claimableDate,
          memo: payment.memo,
        },
        batchId,
        batchHash,
        root,
        // root is signed by the delegate, not the batch signer
        signRoot(auth.signingKey, batchHash, root),
        tree.getHexProof(leafHash(batchHash, payment)),
        auth
      );
    }

    it("lets an authorized delegate claim on behalf of the batch signer", async function () {
      const { batchHash, batchId } = await createEscrow();
      const now = await time.latest();
      const payment = {
        receiverAddress: receiver1.address,
        amount: ethers.parseUnits("100", 18).toString(),
        claimableDate: now,
        memo: "Delegated claim",
      };
      const auth = signAuth(
        signer.address,
        batchHash,
        other.address,
        ethers.parseUnits('100', 18),
        ethers.parseUnits('200', 18),
        now + 3600,
        AUTH_TIMESTAMP,
      );

      await expect(claimAsDelegate(batchHash, batchId, payment, auth))
        .to.emit(escrowBatchPayout, "EscrowPaymentClaimed")
        .withArgs(
          batchId,
          payment.receiverAddress,
          payment.amount,
          await mockToken.getAddress(),
          payment.memo,
          other.address
        );

      expect(await mockToken.balanceOf(receiver1.address)).to.equal(payment.amount);
      expect(await escrowBatchPayout.signerSpent(batchId, other.address)).to.equal(
        payment.amount
      );
    });

    it("rejects a payment above the per-transaction limit", async function () {
      const { batchHash, batchId } = await createEscrow();
      const now = await time.latest();
      const payment = {
        receiverAddress: receiver1.address,
        amount: ethers.parseUnits("150", 18).toString(),
        claimableDate: now,
        memo: "Over transaction limit",
      };
      const auth = signAuth(
        signer.address,
        batchHash,
        other.address,
        ethers.parseUnits('100', 18),
        ethers.parseUnits('500', 18),
        now + 3600,
        AUTH_TIMESTAMP,
      );

      await expect(
        claimAsDelegate(batchHash, batchId, payment, auth)
      ).to.be.revertedWith("Payment exceeds transaction limit");
    });

    it("enforces the cumulative total allowance across claims", async function () {
      const { batchHash, batchId } = await createEscrow();
      const now = await time.latest();
      const transactionMax = ethers.parseUnits("100", 18);
      const totalMax = ethers.parseUnits("150", 18);

      const payment1 = {
        receiverAddress: receiver1.address,
        amount: ethers.parseUnits("100", 18).toString(),
        claimableDate: now,
        memo: "First delegated claim",
      };
      const payment2 = {
        receiverAddress: receiver2.address,
        amount: ethers.parseUnits("100", 18).toString(),
        claimableDate: now,
        memo: "Second delegated claim",
      };
      const auth = signAuth(
        signer.address,
        batchHash,
        other.address,
        transactionMax,
        totalMax,
        now + 3600,
        AUTH_TIMESTAMP,
      );

      await claimAsDelegate(batchHash, batchId, payment1, auth);

      // 100 already spent, totalMax is 150, so a second 100 exceeds it.
      await expect(
        claimAsDelegate(batchHash, batchId, payment2, auth)
      ).to.be.revertedWith("Payment exceeds signer total allowance");
    });

    it("rejects claims from a revoked delegate", async function () {
      const { batchHash, batchId } = await createEscrow();
      const now = await time.latest();
      const payment = {
        receiverAddress: receiver1.address,
        amount: ethers.parseUnits("100", 18).toString(),
        claimableDate: now,
        memo: "Revoked delegate claim",
      };
      const auth = signAuth(
        signer.address,
        batchHash,
        other.address,
        ethers.parseUnits('100', 18),
        ethers.parseUnits('200', 18),
        now + 3600,
        AUTH_TIMESTAMP,
      );

      await expect(escrowBatchPayout.connect(signer).revokeSigner(batchId, other.address))
        .to.emit(escrowBatchPayout, "SignerRevoked")
        .withArgs(batchId, other.address, signer.address);

      await expect(
        claimAsDelegate(batchHash, batchId, payment, auth)
      ).to.be.revertedWith("Signer authorization revoked");
    });

    it("rejects an authorization not signed by the batch signer", async function () {
      const { batchHash, batchId } = await createEscrow();
      const now = await time.latest();
      const payment = {
        receiverAddress: receiver1.address,
        amount: ethers.parseUnits("100", 18).toString(),
        claimableDate: now,
        memo: "Forged authorization",
      };
      // Authorization signed by `other` (not the batch signer) trying to self-authorize.
      const auth = signAuth(
        other.address,
        batchHash,
        other.address,
        ethers.parseUnits('100', 18),
        ethers.parseUnits('200', 18),
        now + 3600,
        AUTH_TIMESTAMP,
      );

      await expect(
        claimAsDelegate(batchHash, batchId, payment, auth)
      ).to.be.revertedWith("Invalid signer authorization");
    });

    it("rejects a delegate address that the authorization did not name", async function () {
      const { batchHash, batchId } = await createEscrow();
      const now = await time.latest();
      const payment = {
        receiverAddress: receiver1.address,
        amount: ethers.parseUnits("100", 18).toString(),
        claimableDate: now,
        memo: "Swapped delegate",
      };
      // Batch signer authorizes `other`, but caller swaps in receiver2 as the signer.
      const auth = signAuth(
        signer.address,
        batchHash,
        other.address,
        ethers.parseUnits('100', 18),
        ethers.parseUnits('200', 18),
        now + 3600,
        AUTH_TIMESTAMP,
      );
      auth.signingKey = receiver2.address;

      await expect(
        claimAsDelegate(batchHash, batchId, payment, auth)
      ).to.be.revertedWith("Invalid signer authorization");
    });
  });

  describe("cancelClaims", function () {
    const AUTH_TIMESTAMP = 1_700_000_000;

    function leafHex(batchHash: string, payment: EscrowPaymentEntry): string {
      return `0x${leafHash(batchHash, payment).toString("hex")}`;
    }

    function makePayment(
      receiverAddress: string,
      now: number,
      memo = "Cancelable payment"
    ): EscrowPaymentEntry {
      return {
        receiverAddress,
        amount: ethers.parseUnits("100", 18).toString(),
        claimableDate: now,
        memo,
      };
    }

    // Claims a single-payment leaf as the batch signer (root signed by signer).
    function claimBySigner(
      batchHash: string,
      batchId: string,
      payment: EscrowPaymentEntry
    ) {
      const tree = buildTree(batchHash, [payment]);
      const root = `0x${tree.getRoot().toString("hex")}`;
      return escrowBatchPayout.claimPayment(
        {
          receiver: payment.receiverAddress,
          amount: payment.amount,
          claimDate: payment.claimableDate,
          memo: payment.memo,
        },
        batchId,
        batchHash,
        root,
        signRoot(signer.address, batchHash, root),
        tree.getHexProof(leafHash(batchHash, payment)),
        EMPTY_AUTH
      );
    }

    function delegateAuth(
      batchHash: string,
      delegate: string,
      overrides: Partial<{
        batchSigner: string;
        expiration: number;
      }> = {}
    ): PayoutSignerAuth {
      return signAuth(
        overrides.batchSigner || signer.address,
        batchHash,
        delegate,
        ethers.parseUnits("100", 18),
        ethers.parseUnits("200", 18),
        overrides.expiration ?? AUTH_TIMESTAMP + 10_000_000_000,
        AUTH_TIMESTAMP
      );
    }

    it("lets the funding signer cancel a leaf, blocking its claim", async function () {
      const { batchHash, batchId } = await createEscrow();
      const now = await time.latest();
      const payment = makePayment(receiver1.address, now);
      const leaf = leafHex(batchHash, payment);

      await expect(
        escrowBatchPayout.connect(signer).cancelClaims(batchId, [leaf], EMPTY_AUTH)
      )
        .to.emit(escrowBatchPayout, "ClaimCancelled")
        .withArgs(batchId, leaf, signer.address);

      expect(await escrowBatchPayout.isCancelled(batchId, leaf)).to.equal(true);

      await expect(claimBySigner(batchHash, batchId, payment)).to.be.revertedWith(
        "Payment cancelled"
      );
    });

    it("lets an authorized delegate cancel a leaf", async function () {
      const { batchHash, batchId } = await createEscrow();
      const now = await time.latest();
      const payment = makePayment(receiver1.address, now);
      const leaf = leafHex(batchHash, payment);
      const auth = delegateAuth(batchHash, other.address);

      await expect(
        escrowBatchPayout.connect(other).cancelClaims(batchId, [leaf], auth)
      )
        .to.emit(escrowBatchPayout, "ClaimCancelled")
        .withArgs(batchId, leaf, other.address);

      expect(await escrowBatchPayout.isCancelled(batchId, leaf)).to.equal(true);
    });

    it("cancels multiple leaves in one call", async function () {
      const { batchHash, batchId } = await createEscrow();
      const now = await time.latest();
      const p1 = makePayment(receiver1.address, now, "one");
      const p2 = makePayment(receiver2.address, now, "two");
      const leaf1 = leafHex(batchHash, p1);
      const leaf2 = leafHex(batchHash, p2);

      await escrowBatchPayout
        .connect(signer)
        .cancelClaims(batchId, [leaf1, leaf2], EMPTY_AUTH);

      expect(await escrowBatchPayout.isCancelled(batchId, leaf1)).to.equal(true);
      expect(await escrowBatchPayout.isCancelled(batchId, leaf2)).to.equal(true);
      await expect(claimBySigner(batchHash, batchId, p1)).to.be.revertedWith(
        "Payment cancelled"
      );
      await expect(claimBySigner(batchHash, batchId, p2)).to.be.revertedWith(
        "Payment cancelled"
      );
    });

    it("rejects an unauthorized caller with no authorization", async function () {
      const { batchHash, batchId } = await createEscrow();
      const now = await time.latest();
      const leaf = leafHex(batchHash, makePayment(receiver1.address, now));

      await expect(
        escrowBatchPayout
          .connect(receiver1)
          .cancelClaims(batchId, [leaf], EMPTY_AUTH)
      ).to.be.revertedWith("Not authorized to cancel");
    });

    it("rejects when the caller is not the authorized signingKey", async function () {
      const { batchHash, batchId } = await createEscrow();
      const now = await time.latest();
      const leaf = leafHex(batchHash, makePayment(receiver1.address, now));
      // Signer authorizes `other`, but receiver2 tries to use it.
      const auth = delegateAuth(batchHash, other.address);

      await expect(
        escrowBatchPayout.connect(receiver2).cancelClaims(batchId, [leaf], auth)
      ).to.be.revertedWith("Caller is not the authorized signer");
    });

    it("rejects an authorization not signed by the funding signer", async function () {
      const { batchHash, batchId } = await createEscrow();
      const now = await time.latest();
      const leaf = leafHex(batchHash, makePayment(receiver1.address, now));
      // `other` self-signs an authorization for itself.
      const auth = delegateAuth(batchHash, other.address, {
        batchSigner: other.address,
      });

      await expect(
        escrowBatchPayout.connect(other).cancelClaims(batchId, [leaf], auth)
      ).to.be.revertedWith("Invalid signer authorization");
    });

    it("rejects a revoked delegate", async function () {
      const { batchHash, batchId } = await createEscrow();
      const now = await time.latest();
      const leaf = leafHex(batchHash, makePayment(receiver1.address, now));
      const auth = delegateAuth(batchHash, other.address);

      await escrowBatchPayout.connect(signer).revokeSigner(batchId, other.address);

      await expect(
        escrowBatchPayout.connect(other).cancelClaims(batchId, [leaf], auth)
      ).to.be.revertedWith("Signer authorization revoked");
    });

    it("rejects an expired authorization", async function () {
      const { batchHash, batchId } = await createEscrow();
      const now = await time.latest();
      const leaf = leafHex(batchHash, makePayment(receiver1.address, now));
      const auth = delegateAuth(batchHash, other.address, { expiration: 1 });

      await expect(
        escrowBatchPayout.connect(other).cancelClaims(batchId, [leaf], auth)
      ).to.be.revertedWith("Signer authorization expired");
    });

    it("rejects an empty leaves array", async function () {
      const { batchId } = await createEscrow();

      await expect(
        escrowBatchPayout.connect(signer).cancelClaims(batchId, [], EMPTY_AUTH)
      ).to.be.revertedWith("No leaves provided");
    });

    it("skips already-claimed leaves without reverting", async function () {
      const { batchHash, batchId } = await createEscrow();
      const now = await time.latest();
      const payment = makePayment(receiver1.address, now);
      const leaf = leafHex(batchHash, payment);

      await claimBySigner(batchHash, batchId, payment);

      // Cancel is a no-op for the claimed leaf: no revert, no cancellation.
      await expect(
        escrowBatchPayout.connect(signer).cancelClaims(batchId, [leaf], EMPTY_AUTH)
      ).to.not.emit(escrowBatchPayout, "ClaimCancelled");
      expect(await escrowBatchPayout.isClaimed(batchId, leaf)).to.equal(true);
      expect(await escrowBatchPayout.isCancelled(batchId, leaf)).to.equal(false);
    });

    it("is idempotent for already-cancelled leaves", async function () {
      const { batchHash, batchId } = await createEscrow();
      const now = await time.latest();
      const leaf = leafHex(batchHash, makePayment(receiver1.address, now));

      await escrowBatchPayout.connect(signer).cancelClaims(batchId, [leaf], EMPTY_AUTH);
      // Second cancel is a no-op — no event, no revert.
      await expect(
        escrowBatchPayout.connect(signer).cancelClaims(batchId, [leaf], EMPTY_AUTH)
      ).to.not.emit(escrowBatchPayout, "ClaimCancelled");
      expect(await escrowBatchPayout.isCancelled(batchId, leaf)).to.equal(true);
    });

    it("does not move funds when cancelling", async function () {
      const { batchHash, batchId } = await createEscrow();
      const now = await time.latest();
      const leaf = leafHex(batchHash, makePayment(receiver1.address, now));

      const before = await escrowBatchPayout.getRemainingFunds(batchId);
      await escrowBatchPayout.connect(signer).cancelClaims(batchId, [leaf], EMPTY_AUTH);
      const after = await escrowBatchPayout.getRemainingFunds(batchId);

      expect(after).to.equal(before);
    });
  });
});

describe("UniversalDexRouter escrow batch proxies", function () {
  async function deployRouterEscrowFixture() {
    const [owner, admin, feeReceiver, user, payoutSigner] =
      await ethers.getSigners();

    const MockToken = await ethers.getContractFactory("MockERC20");
    const mockToken = await MockToken.deploy(
      "Test Token",
      "TEST",
      ethers.parseUnits("10000", 18)
    );
    await mockToken.waitForDeployment();

    const mockWETH = await MockToken.deploy(
      "Wrapped ETH",
      "WETH",
      ethers.parseUnits("10000", 18)
    );
    await mockWETH.waitForDeployment();

    const MockV2Router = await ethers.getContractFactory("MockUniswapV2Router");
    const mockV2Router = await MockV2Router.deploy();
    await mockV2Router.waitForDeployment();
    await mockToken.transfer(await mockV2Router.getAddress(), ethers.parseUnits("1000", 18));

    const MerkleBatchPayout = await ethers.getContractFactory("MerkleBatchPayout");
    const merkleBatchPayout = await MerkleBatchPayout.deploy();
    await merkleBatchPayout.waitForDeployment();

    const EscrowBatchPayout = await ethers.getContractFactory("EscrowBatchPayout");
    const escrowBatchPayout = await EscrowBatchPayout.deploy();
    await escrowBatchPayout.waitForDeployment();

    const UniversalDexRouter = await ethers.getContractFactory("UniversalDexRouter");
    const universalDexRouter = await UniversalDexRouter.deploy(
      await mockV2Router.getAddress(),
      await mockWETH.getAddress(),
      feeReceiver.address,
      owner.address,
      admin.address,
      await merkleBatchPayout.getAddress(),
      await escrowBatchPayout.getAddress()
    );
    await universalDexRouter.waitForDeployment();

    const fundingAmount = ethers.parseUnits("200", 18);
    const lockDuration = DEFAULT_LOCK_DURATION;
    await mockToken.transfer(user.address, ethers.parseUnits("500", 18));
    await mockToken
      .connect(user)
      .approve(await universalDexRouter.getAddress(), ethers.MaxUint256);

    const timestamp = Math.floor(Date.now() / 1000);
    const externalBatchId = ethers.id("router-escrow-batch");
    const chainId = Number((await ethers.provider.getNetwork()).chainId);
    const batchHash = escrowBatchHash(
      externalBatchId,
      await mockToken.getAddress(),
      lockDuration,
      timestamp,
      chainId
    );
    const batchId = escrowBatchId(payoutSigner.address, batchHash);
    const createSignature = signDigest(
      payoutSigner.address,
      ethers.keccak256(
        ethers.solidityPacked(
          ["bytes32", "address"],
          [batchHash, ethers.ZeroAddress]
        )
      )
    );

    return {
      owner,
      admin,
      feeReceiver,
      user,
      payoutSigner,
      mockToken,
      mockWETH,
      escrowBatchPayout,
      universalDexRouter,
      fundingAmount,
      lockDuration,
      timestamp,
      externalBatchId,
      batchHash,
      batchId,
      createSignature,
    };
  }

  async function createEscrowThroughRouter() {
    const fixture = await deployRouterEscrowFixture();
    const {
      user,
      mockToken,
      mockWETH,
      escrowBatchPayout,
      universalDexRouter,
      fundingAmount,
      lockDuration,
      externalBatchId,
      timestamp,
      payoutSigner,
      createSignature,
    } = fixture;

    await expect(
      universalDexRouter.connect(user).createEscrow(
        await escrowBatchPayout.getAddress(),
        {
          amountIn: fundingAmount,
          amountOut: fundingAmount,
          path: [await mockToken.getAddress(), await mockToken.getAddress()],
        },
        externalBatchId,
        timestamp,
        payoutSigner.address,
        await mockToken.getAddress(),
        fundingAmount,
        lockDuration,
        ethers.ZeroAddress,
        createSignature,
        (await time.latest()) + 3600
      )
    )
      .to.emit(universalDexRouter, "MerkleBatchFunded")
      .withArgs(
        await escrowBatchPayout.getAddress(),
        fixture.batchId,
        fundingAmount,
        await mockToken.getAddress(),
        fixture.batchHash,
        anyValue
      )
      .and.to.emit(universalDexRouter, "BatchPaid")
      .withArgs(
        externalBatchId,
        await mockToken.getAddress(),
        fundingAmount,
        user.address
      );

    return fixture;
  }

  it("creates and funds an escrow batch through the router", async function () {
    const {
      mockToken,
      escrowBatchPayout,
      universalDexRouter,
      fundingAmount,
      batchHash,
      batchId,
      payoutSigner,
    } = await createEscrowThroughRouter();

    const batch = await escrowBatchPayout.getEscrowBatch(batchId);
    expect(batch.exists).to.equal(true);
    expect(batch.batchHash).to.equal(batchHash);
    expect(batch.signer).to.equal(payoutSigner.address);
    expect(batch.totalFunded).to.equal(fundingAmount);
    expect(await mockToken.balanceOf(await escrowBatchPayout.getAddress())).to.equal(
      fundingAmount
    );

  });

  it("claims an escrow batch payment through the router and emits mirrored events", async function () {
    const {
      user,
      payoutSigner,
      mockToken,
      escrowBatchPayout,
      universalDexRouter,
      batchHash,
      batchId,
    } = await createEscrowThroughRouter();

    const claimDate = await time.latest();
    const payment = {
      receiverAddress: user.address,
      amount: ethers.parseUnits("80", 18).toString(),
      claimableDate: claimDate,
      memo: "Router escrow claim",
    };
    const tree = buildTree(batchHash, [payment]);
    const merkleRoot = `0x${tree.getRoot().toString("hex")}`;
    const proof = tree.getHexProof(leafHash(batchHash, payment));
    const rootSignature = signRoot(payoutSigner.address, batchHash, merkleRoot);

    const balanceBefore = await mockToken.balanceOf(user.address);
    await expect(
      universalDexRouter
        .connect(user)
        .claimEscrowPayment(
          await escrowBatchPayout.getAddress(),
          batchId,
          batchHash,
          merkleRoot,
          payment.receiverAddress,
          payment.amount,
          payment.claimableDate,
          payment.memo,
          rootSignature,
          proof,
          EMPTY_AUTH
        )
    )
      .to.emit(universalDexRouter, "MerkleBatchPaymentClaimed")
      .withArgs(
        await escrowBatchPayout.getAddress(),
        batchHash,
        payment.receiverAddress,
        payment.amount,
        await mockToken.getAddress(),
        payment.claimableDate,
        anyValue,
        payment.memo
      )
      .and.to.emit(universalDexRouter, "PaymentExecuted")
      .withArgs(
        user.address,
        payment.receiverAddress,
        await mockToken.getAddress(),
        payment.amount,
        payment.memo
      );

    const balanceAfter = await mockToken.balanceOf(user.address);
    expect(balanceAfter - balanceBefore).to.equal(payment.amount);

    const batch = await escrowBatchPayout.getEscrowBatch(batchId);
    expect(batch.totalClaimed).to.equal(payment.amount);
    expect(batch.claimCount).to.equal(1);
  });

  it("adds funds to an escrow batch through the router", async function () {
    const {
      user,
      mockToken,
      mockWETH,
      escrowBatchPayout,
      universalDexRouter,
      batchHash,
      batchId,
      fundingAmount,
    } = await createEscrowThroughRouter();

    const additionalAmount = ethers.parseUnits("25", 18);

    await expect(
      universalDexRouter
        .connect(user)
        .addFundsToEscrow(
          await escrowBatchPayout.getAddress(),
          batchId,
          {
            amountIn: additionalAmount,
            amountOut: additionalAmount,
            path: [await mockWETH.getAddress(), await mockToken.getAddress()],
          },
          additionalAmount,
          (await time.latest()) + 3600,
          { value: additionalAmount }
        )
    )
      .to.emit(universalDexRouter, "MerkleBatchFunded")
      .withArgs(
        await escrowBatchPayout.getAddress(),
        batchId,
        additionalAmount,
        await mockToken.getAddress(),
        batchHash,
        anyValue
      );

    const batch = await escrowBatchPayout.getEscrowBatch(batchId);
    expect(batch.totalFunded).to.equal(fundingAmount + additionalAmount);
  });
});
