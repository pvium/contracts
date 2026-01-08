# EIP-712 Explained for TokenRelay

## What is EIP-712?

EIP-712 is a standard for signing **typed structured data** instead of raw bytes. It provides better UX (users can see what they're signing) and security (prevents replay attacks).

## The Two-Part Structure

EIP-712 signatures consist of **two separate parts**:

### 1. Domain (Context)
Defines **where** and **which contract** this signature is valid for:

```javascript
const domain = {
    name: 'TokenRelay',              // Contract name
    version: '1',                     // Contract version
    chainId: 1,                       // Which blockchain
    verifyingContract: '0x123...'     // Specific contract address
};
```

### 2. Message (Data)
The actual data being signed:

```javascript
const message = {
    token: '0xabc...',
    amount: 100000000000000000000n,
    receiver: '0xdef...',
    maxFee: 1000000000000000000n,
    signer: '0x456...',
    nonce: 0,
    deadline: 1735948800
};
```

## Why Are They Separate?

### ❌ Bad Approach (Old Way)
```javascript
// Just sign raw bytes - user has no idea what they're signing
const message = "0x1234567890abcdef...";
await wallet.signMessage(message); // What am I signing? 🤷
```

### ✅ Good Approach (EIP-712)
```javascript
// User sees structured data AND domain context
await wallet.signTypedData(domain, types, message);
// User sees: "Sign transfer on TokenRelay v1 on Ethereum"
```

## How TokenRelay Implements It

### 1. Contract Side (Solidity)

The contract inherits from OpenZeppelin's `EIP712`:

```solidity
contract TokenRelay is AccessControl, EIP712 {

    // Define the message structure
    bytes32 public constant TRANSFER_TYPEHASH = keccak256(
        "TransferRequest(address token,uint256 amount,address receiver,uint256 maxFee,address signer,uint256 nonce,uint256 deadline)"
    );

    // Set domain in constructor
    constructor(...) EIP712("TokenRelay", "1") {
        // Domain: name="TokenRelay", version="1"
        // chainId and verifyingContract are automatic
    }

    // Verify signature
    function relayTransfer(..., bytes calldata signature) external {
        // Step 1: Hash the message
        bytes32 structHash = keccak256(
            abi.encode(
                TRANSFER_TYPEHASH,
                token,
                amount,
                receiver,
                maxFee,
                signer,
                nonce,
                deadline
            )
        );

        // Step 2: Add domain separator (automatic via _hashTypedDataV4)
        bytes32 digest = _hashTypedDataV4(structHash);

        // Step 3: Recover signer
        address recoveredSigner = digest.recover(signature);

        // Step 4: Verify
        require(recoveredSigner == signer, "Invalid signature");
    }
}
```

### 2. Client Side (JavaScript)

```javascript
const { ethers } = require('ethers');

// Domain - matches contract
const domain = {
    name: 'TokenRelay',              // From EIP712("TokenRelay", "1")
    version: '1',                     // From EIP712("TokenRelay", "1")
    chainId: 1,                       // Must match deployment chain
    verifyingContract: '0x123...'     // Contract address
};

// Types - matches TRANSFER_TYPEHASH
const types = {
    TransferRequest: [
        { name: 'token', type: 'address' },
        { name: 'amount', type: 'uint256' },
        { name: 'receiver', type: 'address' },
        { name: 'maxFee', type: 'uint256' },
        { name: 'signer', type: 'address' },
        { name: 'nonce', type: 'uint256' },
        { name: 'deadline', type: 'uint256' },
    ],
};

// Message - the actual data
const transferRequest = {
    token: tokenAddress,
    amount: ethers.parseUnits('100', 18),
    receiver: receiverAddress,
    maxFee: ethers.parseUnits('1', 18),
    signer: userAddress,
    nonce: 0,
    deadline: Math.floor(Date.now() / 1000) + 3600
};

// Sign: ethers.js combines domain + types + message
const signature = await wallet.signTypedData(domain, types, transferRequest);
```

## The Complete Signature Process

```
┌─────────────────────────────────────────────────────────────┐
│ 1. USER INITIATES SIGNATURE                                 │
│    wallet.signTypedData(domain, types, message)             │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ 2. COMPUTE DOMAIN SEPARATOR                                 │
│    domainSep = keccak256(                                   │
│      "EIP712Domain(...)",                                   │
│      keccak256("TokenRelay"),                               │
│      keccak256("1"),                                        │
│      chainId,                                               │
│      verifyingContract                                      │
│    )                                                        │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ 3. COMPUTE MESSAGE HASH                                     │
│    messageHash = keccak256(                                 │
│      TRANSFER_TYPEHASH,                                     │
│      token, amount, receiver, maxFee,                       │
│      signer, nonce, deadline                                │
│    )                                                        │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ 4. COMBINE INTO DIGEST                                      │
│    digest = keccak256(                                      │
│      "\x19\x01",                                            │
│      domainSep,                                             │
│      messageHash                                            │
│    )                                                        │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ 5. SIGN DIGEST                                              │
│    signature = sign(digest, privateKey)                     │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ 6. CONTRACT VERIFIES                                        │
│    recoveredAddress = ecrecover(digest, signature)          │
│    require(recoveredAddress == expectedSigner)              │
└─────────────────────────────────────────────────────────────┘
```

## Security Benefits

### 1. **Prevents Cross-Contract Replay**

```javascript
// User signs for TokenRelay on address 0xAAA
const signature = await wallet.signTypedData(
    { ..., verifyingContract: '0xAAA' },
    types,
    message
);

// ❌ Signature CANNOT be reused on different contract at 0xBBB
// Domain separator will be different!
```

### 2. **Prevents Cross-Chain Replay**

```javascript
// User signs on Ethereum (chainId: 1)
const signature = await wallet.signTypedData(
    { ..., chainId: 1 },
    types,
    message
);

// ❌ Signature CANNOT be reused on Polygon (chainId: 137)
// Domain separator will be different!
```

### 3. **Version Protection**

```javascript
// User signs on TokenRelay v1
const signature = await wallet.signTypedData(
    { ..., version: '1' },
    types,
    message
);

// ❌ Signature CANNOT be reused on TokenRelay v2
// Domain separator will be different!
```

### 4. **Readable by Users**

When signing, wallet shows:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Sign Transfer Request
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📋 Contract: TokenRelay v1
🔗 Chain: Ethereum
📍 Address: 0x123...abc

📝 Message:
  • Transfer 100 USDC tokens
  • To: 0xdef...456
  • Max Fee: 1 USDC
  • Expires: in 1 hour

[Sign] [Cancel]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

## Common Mistakes

### ❌ Mistake 1: Including Domain in Message
```javascript
// WRONG - domain should NOT be in the message
const types = {
    TransferRequest: [
        { name: 'chainId', type: 'uint256' },  // ❌ NO!
        { name: 'contract', type: 'address' }, // ❌ NO!
        { name: 'token', type: 'address' },
        // ...
    ]
};
```

### ✅ Correct: Domain Separate
```javascript
// RIGHT - domain is separate parameter
const domain = { chainId: 1, verifyingContract: '0x...' };
const types = {
    TransferRequest: [
        { name: 'token', type: 'address' },  // ✅ YES
        // ... only message fields
    ]
};

await wallet.signTypedData(domain, types, message);
```

### ❌ Mistake 2: Wrong Type String

```solidity
// Contract has this
bytes32 public constant TRANSFER_TYPEHASH = keccak256(
    "TransferRequest(address token,uint256 amount,...)"
);
```

```javascript
// ❌ JavaScript types must EXACTLY match
const types = {
    TransferRequest: [
        { name: 'token', type: 'address' },
        { name: 'amount', type: 'uint' },  // ❌ Should be 'uint256'
    ]
};
```

### ✅ Correct: Exact Match
```javascript
// ✅ Types match exactly
const types = {
    TransferRequest: [
        { name: 'token', type: 'address' },
        { name: 'amount', type: 'uint256' },  // ✅ Matches contract
    ]
};
```

### ❌ Mistake 3: Wrong Domain Values

```javascript
// Contract deployed at 0xAAA on Ethereum
const TokenRelay = await TokenRelay.deploy(...);

// ❌ Wrong domain
const domain = {
    name: 'TokenRelay',
    version: '1',
    chainId: 137,                      // ❌ Wrong chain!
    verifyingContract: '0xBBB...'      // ❌ Wrong address!
};

// Signature will fail verification!
```

### ✅ Correct: Match Contract

```javascript
// ✅ Correct domain
const domain = {
    name: 'TokenRelay',                              // ✅ Matches EIP712("TokenRelay", "1")
    version: '1',                                     // ✅ Matches EIP712("TokenRelay", "1")
    chainId: (await ethers.provider.getNetwork()).chainId,  // ✅ Get actual chain
    verifyingContract: await TokenRelay.getAddress()        // ✅ Get actual address
};
```

## Testing EIP-712 Signatures

```javascript
describe("EIP-712 Signature", function() {
    it("Should verify valid signature", async function() {
        const domain = {
            name: 'TokenRelay',
            version: '1',
            chainId: (await ethers.provider.getNetwork()).chainId,
            verifyingContract: await relay.getAddress(),
        };

        const types = {
            TransferRequest: [
                { name: 'token', type: 'address' },
                { name: 'amount', type: 'uint256' },
                { name: 'receiver', type: 'address' },
                { name: 'maxFee', type: 'uint256' },
                { name: 'signer', type: 'address' },
                { name: 'nonce', type: 'uint256' },
                { name: 'deadline', type: 'uint256' },
            ],
        };

        const message = {
            token: tokenAddress,
            amount: ethers.parseUnits('100', 18),
            receiver: receiverAddress,
            maxFee: ethers.parseUnits('1', 18),
            signer: userAddress,
            nonce: 0,
            deadline: Math.floor(Date.now() / 1000) + 3600
        };

        const signature = await user.signTypedData(domain, types, message);

        // Should succeed
        await relay.relayTransfer(
            message.token,
            message.amount,
            message.receiver,
            message.maxFee,
            message.signer,
            message.nonce,
            message.deadline,
            signature
        );
    });

    it("Should reject signature with wrong domain", async function() {
        const wrongDomain = {
            name: 'WrongContract',  // ❌ Wrong name
            version: '1',
            chainId: (await ethers.provider.getNetwork()).chainId,
            verifyingContract: await relay.getAddress(),
        };

        const signature = await user.signTypedData(wrongDomain, types, message);

        // Should fail
        await expect(
            relay.relayTransfer(..., signature)
        ).to.be.revertedWithCustomError(relay, "InvalidSignature");
    });
});
```

## Summary

### Domain (Separate from Message)
- ✅ name
- ✅ version
- ✅ chainId
- ✅ verifyingContract

### Message (TransferRequest)
- ✅ token
- ✅ amount
- ✅ receiver
- ✅ maxFee
- ✅ signer
- ✅ nonce
- ✅ deadline

### Key Takeaways
1. Domain is **ALWAYS separate** from the message in EIP-712
2. Domain provides **context** (where/which contract)
3. Message provides **data** (what action)
4. Both are **combined cryptographically** in the signature
5. Users see **both parts** when signing in their wallet
6. This prevents **replay attacks** across contracts/chains

The TokenRelay implementation is **correct** and follows EIP-712 standard exactly! ✅
