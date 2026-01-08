# DAO Integration Guide

## Overview

The `DAO_ROLE` in TokenRelay is designed to be granted to a **governance contract**, not individual addresses. This ensures that changes to critical parameters (like `maxFeePercentage`) require community consensus through voting.

## How It Works

```
┌─────────────┐         ┌──────────────────┐         ┌─────────────┐
│ Token       │ vote on │   DAO Governor   │ granted │  TokenRelay │
│ Holders     ├────────>│   Contract       ├────────>│  Contract   │
└─────────────┘         └──────────────────┘         └─────────────┘
                        (has DAO_ROLE)
```

### Flow:

1. **Community member creates proposal**: "Change max fee to 5%"
2. **Token holders vote**: Use governance tokens to vote yes/no
3. **Voting period ends**: Proposal passes if quorum reached + majority yes
4. **Anyone executes**: Calls `execute()` which triggers the change in TokenRelay
5. **Governance contract calls TokenRelay**: `setMaxFeePercentage(500)`

## Setup Example

### Step 1: Deploy Governance Token

```javascript
// Deploy an ERC20 governance token
const GovernanceToken = await ethers.getContractFactory("GovernanceToken");
const govToken = await GovernanceToken.deploy("DAO Token", "DAO", ethers.parseUnits("1000000", 18));
```

### Step 2: Deploy DAO Governor

```javascript
const SimpleDAOGovernor = await ethers.getContractFactory("SimpleDAOGovernor");
const governor = await SimpleDAOGovernor.deploy(
    await govToken.getAddress(),      // Governance token address
    50400,                             // Voting period: ~7 days (in blocks, assuming 12s blocks)
    ethers.parseUnits("100000", 18),  // Quorum: 100k tokens minimum
    ethers.parseUnits("1000", 18)     // Proposal threshold: 1k tokens to propose
);
```

### Step 3: Deploy TokenRelay

```javascript
const TokenRelay = await ethers.getContractFactory("TokenRelay");
const relay = await TokenRelay.deploy(
    100,   // feePercentage: 1%
    1000,  // maxFeePercentage: 10%
    ethers.parseUnits("1", 18)
);
```

### Step 4: Grant DAO_ROLE to Governor

```javascript
const DAO_ROLE = await relay.DAO_ROLE();
await relay.grantRole(DAO_ROLE, await governor.getAddress());

// Optional: Revoke from deployer for full decentralization
await relay.revokeRole(DAO_ROLE, deployerAddress);
```

## Creating and Executing Proposals

### Example: Lower Max Fee to 5%

#### 1. Encode the Function Call

```javascript
// Encode the function call that will be executed
const callData = relay.interface.encodeFunctionData("setMaxFeePercentage", [500]);
```

#### 2. Create Proposal

```javascript
// Must have enough governance tokens (≥ proposalThreshold)
const tx = await governor.connect(proposer).propose(
    await relay.getAddress(),          // Target contract
    callData,                          // Function to call
    "Lower maximum fee to 5%"          // Description
);

const receipt = await tx.wait();
const proposalId = 1; // Extract from ProposalCreated event
```

#### 3. Token Holders Vote

```javascript
// Vote YES
await governor.connect(voter1).castVote(proposalId, true);

// Vote NO
await governor.connect(voter2).castVote(proposalId, false);

// Voting power = token balance at time of vote
```

#### 4. Wait for Voting Period

```javascript
// Wait for voting period to end (~7 days)
// In testing, you can mine blocks:
await ethers.provider.send("hardhat_mine", ["0xc350"]); // Mine 50000 blocks
```

#### 5. Execute If Passed

```javascript
// Check if proposal succeeded
const state = await governor.state(proposalId);
console.log(state); // "Succeeded"

// Anyone can execute once voting ends
await governor.execute(proposalId);

// TokenRelay.maxFeePercentage is now 500 (5%)
```

## Production Recommendations

### Use OpenZeppelin Governor

The `SimpleDAOGovernor` is for illustration only. In production, use OpenZeppelin's battle-tested Governor:

```solidity
import "@openzeppelin/contracts/governance/Governor.sol";
import "@openzeppelin/contracts/governance/extensions/GovernorSettings.sol";
import "@openzeppelin/contracts/governance/extensions/GovernorCountingSimple.sol";
import "@openzeppelin/contracts/governance/extensions/GovernorVotes.sol";
import "@openzeppelin/contracts/governance/extensions/GovernorVotesQuorumFraction.sol";
import "@openzeppelin/contracts/governance/extensions/GovernorTimelockControl.sol";

contract TokenRelayGovernor is
    Governor,
    GovernorSettings,
    GovernorCountingSimple,
    GovernorVotes,
    GovernorVotesQuorumFraction,
    GovernorTimelockControl
{
    // Implementation...
}
```

**Key improvements:**
- **Snapshot-based voting**: Prevents vote buying during proposal
- **Timelock**: Delay between approval and execution (gives users time to exit if they disagree)
- **Delegation**: Token holders can delegate voting power
- **Quorum fraction**: Quorum as % of total supply
- **Proposal lifecycle**: Pending → Active → Succeeded/Defeated → Queued → Executed

### Add a Timelock

Insert a delay between vote success and execution:

```javascript
import "@openzeppelin/contracts/governance/TimelockController.sol";

// Deploy timelock with 2-day delay
const timelock = await TimelockController.deploy(
    172800,                    // 2 days in seconds
    [governorAddress],         // Proposers
    [governorAddress],         // Executors
    ethers.ZeroAddress         // Admin
);

// Grant DAO_ROLE to timelock, not governor
await relay.grantRole(DAO_ROLE, timelockAddress);
```

## Complete Integration Example

```javascript
// 1. Deploy governance token with voting power
const govToken = await GovernanceToken.deploy("DAO Token", "DAO");

// 2. Deploy timelock (48-hour delay)
const timelock = await TimelockController.deploy(
    172800,
    [],  // proposers (set later)
    [],  // executors (set later)
    ethers.ZeroAddress
);

// 3. Deploy governor
const governor = await MyGovernor.deploy(
    govToken.address,
    timelock.address
);

// 4. Configure timelock
const PROPOSER_ROLE = await timelock.PROPOSER_ROLE();
const EXECUTOR_ROLE = await timelock.EXECUTOR_ROLE();
await timelock.grantRole(PROPOSER_ROLE, governor.address);
await timelock.grantRole(EXECUTOR_ROLE, ethers.ZeroAddress); // Anyone can execute

// 5. Deploy TokenRelay
const relay = await TokenRelay.deploy(100, 1000, ethers.parseUnits("1", 18));

// 6. Grant DAO_ROLE to timelock
const DAO_ROLE = await relay.DAO_ROLE();
await relay.grantRole(DAO_ROLE, timelock.address);

// 7. Revoke from deployer
await relay.revokeRole(DAO_ROLE, deployer.address);
```

## Proposal Examples

### 1. Lower Max Fee

```javascript
const callData = relay.interface.encodeFunctionData("setMaxFeePercentage", [300]); // 3%

await governor.propose(
    [relay.address],
    [0],
    [callData],
    "Lower max fee to 3% to improve competitiveness"
);
```

### 2. Emergency: Raise Max Fee Temporarily

```javascript
const callData = relay.interface.encodeFunctionData("setMaxFeePercentage", [2000]); // 20%

await governor.propose(
    [relay.address],
    [0],
    [callData],
    "EMERGENCY: Raise max fee to cover increased relay costs during market volatility"
);
```

### 3. Grant New Admin

```javascript
const ADMIN_ROLE = await relay.ADMIN_ROLE();
const callData = relay.interface.encodeFunctionData("grantRole", [ADMIN_ROLE, newAdminAddress]);

await governor.propose(
    [relay.address],
    [0],
    [callData],
    "Add new operations team multi-sig as ADMIN"
);
```

## Governance Token Distribution

For DAO to work effectively, distribute governance tokens to community:

### Option 1: Airdrop to Users
```javascript
// Snapshot users, distribute tokens
await govToken.transfer(user1, ethers.parseUnits("1000", 18));
```

### Option 2: Liquidity Mining
```javascript
// Reward governance tokens for providing liquidity or using relay
```

### Option 3: Initial Sale
```javascript
// Public sale for community members
```

## Security Considerations

1. **Token Distribution**: Ensure no single entity has >50% voting power
2. **Timelock**: Use delays to allow exit before controversial changes
3. **Proposal Threshold**: Set high enough to prevent spam, low enough to allow participation
4. **Quorum**: Require meaningful participation (10-20% of supply)
5. **Emergency Controls**: Consider emergency pause/upgrade mechanisms
6. **Gradual Decentralization**: Don't go full DAO on day 1

## Alternative: Snapshot + Multi-Sig

For simpler governance without on-chain complexity:

1. **Proposals**: Created on Snapshot (off-chain, gasless voting)
2. **Voting**: Token holders vote using Snapshot
3. **Execution**: Multi-sig executes if vote passes
4. **DAO_ROLE**: Granted to multi-sig, not governance contract

**Benefits:**
- No gas costs for voting
- Simpler implementation
- Still decentralized decision-making

**Drawbacks:**
- Multi-sig must be trusted to execute
- Not fully trustless

## Testing Example

See `test/TokenRelay.test.js` for role-based access tests. For full DAO integration tests, see `test/governance/DAOIntegration.test.js` (to be created).

```javascript
describe("DAO Governance", function() {
    it("Should allow DAO to change max fee via proposal", async function() {
        // 1. Create proposal
        const callData = relay.interface.encodeFunctionData("setMaxFeePercentage", [500]);
        await governor.propose(relay.address, callData, "Lower max fee");

        // 2. Vote
        await governor.connect(voter1).castVote(1, true);

        // 3. Execute
        await ethers.provider.send("hardhat_mine", ["0xc350"]);
        await governor.execute(1);

        // 4. Verify
        expect(await relay.maxFeePercentage()).to.equal(500);
    });
});
```

## Summary

- **DAO_ROLE** → Granted to governance contract, not individuals
- **Proposals** → Community creates and votes on changes
- **Execution** → Governance contract calls TokenRelay functions
- **Production** → Use OpenZeppelin Governor + Timelock
- **Alternative** → Snapshot voting + Multi-sig execution
