# Escrow Contract System

## Overview

The escrow contract system enables apps to create and manage project-based payment contracts. Projects (also referred to as campaigns) facilitate secure fund management between project owners and freelancers (vendors/geeks), with built-in dispute resolution and fee structures.

## Key Concepts

### Projects/Campaigns
- **Project**: A container for managing funds and vendor payments
- **Project Owner**: The entity funding the project
- **Vendors/Geeks**: Approved freelancers who can claim payouts
- **App**: The service provider facilitating the project
- **Pvium**: The protocol layer managing dispute resolution and validation

### Fund Locking
- Funds are locked for 6 months after project activation
- Once a project is activated, funds cannot be withdrawn by the funder
- New vendors cannot be added after activation
- App can end a project and distribute funds at any time

### Lifecycle Stages
1. **Creation**: Project is created with initial configuration
2. **Vendor Approval**: Approved vendors are added (before activation)
3. **Funding**: ERC20 tokens are transferred to the project contract
4. **Activation**: Project is activated, locking funds and vendor list
5. **Payouts**: Vendors claim approved payments
6. **Completion**: App ends project and distributes remaining funds

## Contract Architecture

The system consists of two main contracts:

### 1. Factory Contract
Manages project creation and registry.

### 2. Project Contract
Individual project instances that handle funding, payouts, and disputes.

---

## Data Structures

### CreateProjectPayload
```typescript
{
  app: string;                   // App identifier
  projectId: string;             // Project identifier
  metadata: bytes;               // Project metadata (description, milestones, etc.)
  token: address;                // ERC20 token address for payments
  appFeeBps: uint;               // App fee in basis points (1 bps = 0.01%)
  disputeWindowSeconds: uint;    // Time window for raising disputes
  lockExpiry: uint;              // Timestamp when funds unlock (6 months)
  minimumBalancePerVendor: uint; // Minimum token balance required per vendor before activation
  maxNumVendors: uint;           // Maximum number of vendors allowed
}
```

### VendorPayoutPayload
```typescript
{
  app: string;                   // App identifier
  projectId: string;             // Project identifier
  claimId: bytes32;              // Unique identifier for this payout claim
  vendor: address;               // Vendor wallet address
  amount: uint;                  // Payout amount in token units
  appSignature: bytes;           // App's signature authorizing payment
}
```

**Note:** The `app` and `projectId` fields allow the Factory to lookup the project address from `projectsByUniqueId` mapping.

---

## Factory Contract ABI

### Functions

#### createProject
```solidity
function createProject(
  CreateProjectPayload payload,
  bytes signature
) returns (address)
```
Creates a new project contract and returns its address using CREATE2 for deterministic addresses.

**Parameters:**
- `payload`: Project configuration (see CreateProjectPayload)
- `signature`: Authorization signature from app

**Returns:** Address of the newly created project contract

---

#### getProjects
```solidity
function getProjects(string appId) view returns (address[])
```
Retrieves all project addresses for a given app.

**Parameters:**
- `appId`: App identifier

**Returns:** Array of project contract addresses

---

#### getProjectByUniqueId
```solidity
function getProjectByUniqueId(string app, string projectId) view returns (address)
```
Get project address by unique ID (app + projectId).

**Parameters:**
- `app`: App identifier
- `projectId`: Project identifier

**Returns:** Project address (address(0) if not deployed)

---

#### computeaccountAddress
```solidity
function computeaccountAddress(
  CreateProjectPayload payload,
  address appAddress
) view returns (address)
```
Compute the deterministic project address before deployment (for pre-funding).

**Parameters:**
- `payload`: Project configuration data
- `appAddress`: App address that will create the project

**Returns:** Predicted project address

---

#### getPviumFeeBps
```solidity
function getPviumFeeBps() view returns (uint)
```
Returns the Pvium protocol fee in basis points.

**Returns:** Fee amount (e.g., 100 = 1%)

---

#### updatePviumFee
```solidity
function updatePviumFee(uint256 newFeeBps)
```
Update Pvium protocol fee (only callable by Pvium).

**Parameters:**
- `newFeeBps`: New fee in basis points

---

#### updatePviumAddress
```solidity
function updatePviumAddress(address newAddress)
```
Update Pvium address (only callable by current Pvium address).

**Parameters:**
- `newAddress`: New Pvium address

---

#### updateAppFeeAddress
```solidity
function updateAppFeeAddress(string appId, address newAddress)
```
Update app fee address (only callable by current app address).

**Parameters:**
- `appId`: App identifier
- `newAddress`: New app fee address

---

#### pviumFeeAddress
```solidity
function pviumFeeAddress() view returns (address)
```
Get Pvium fee address.

**Returns:** Pvium address

---

#### appFeeAddress
```solidity
function appFeeAddress(string appId) view returns (address)
```
Get app fee address for a specific app.

**Parameters:**
- `appId`: App identifier

**Returns:** App fee address

---

## Project Contract ABI

### Functions

#### fundProject
```solidity
function fundProject(uint amount)
```
Transfers ERC20 tokens to the project contract. Only the registered token can be used.

**Parameters:**
- `amount`: Amount of tokens to deposit

**Note:** Caller must approve the project contract to spend tokens before calling this function.

---

#### addVendors
```solidity
function addVendors(address[] calldata vendors)
```
Adds approved vendors who can receive payouts. **Can only be called before project activation.**

**Parameters:**
- `vendors`: Array of vendor wallet addresses

**Access:** Only app

---

#### activateProject
```solidity
function activateProject()
```
Activates the project, locking funds for the specified lock period and preventing new vendors from being added.

**Requirements:**
- Project balance must meet or exceed `minimumBalancePerVendor × vendorCount`
- At least one vendor must be added

**Effects:**
- Funds cannot be withdrawn by project owner
- Vendor list is frozen
- Payout claims can begin

**Reverts if:**
- Balance is below required minimum (minimumBalancePerVendor × number of vendors)
- No vendors have been added

**Example:**
- `minimumBalancePerVendor`: 100 USDC
- Vendors added: 5
- Required balance: 100 × 5 = 500 USDC minimum

**Access:** Only app

---

#### finalizeClaim (Factory)
```solidity
function finalizeClaim(
  VendorPayoutPayload[] calldata vendorPayments,
  bytes pviumSignature
)
```
Batch finalize approved vendor payouts with Pvium signature verification at the Factory level.

**Parameters:**
- `vendorPayments`: Array of payout claims (see VendorPayoutPayload)
- `pviumSignature`: Pvium protocol signature validating the claims

**Access:** Anyone can call (signature verification required)

**Project Lookup:**
- Factory extracts `app` and `projectId` from first payment
- Looks up project address: `projectsByUniqueId[keccak256(app || projectId)]`
- Verifies all payments in batch are for the same project

**Signature Verification:**
- Pvium signs: `keccak256(app || projectId || claimId1 || claimId2 || ... || chainId)`
- Only claimIds are included in signature for gas efficiency
- App signatures (with app + projectId + claimId + vendor + amount + nonce) are verified individually in SmartEscrow

**Flow:**
1. Factory extracts app and projectId from first payment
2. Factory looks up project address from mapping
3. Factory verifies all payments are for same project
4. Factory verifies Pvium signature
5. Factory calls SmartEscrow.finalizeClaim()
6. SmartEscrow validates each payment with app signature
7. SmartEscrow transfers to vendors and fee addresses

**Requirements:**
- Must be called after dispute window expires for each claim
- Vendor must be on approved list
- Sufficient funds must be available

**Fee Distribution:**
For each payout, fees are calculated and transferred as follows:
- App fee is deducted based on `appFeeBps` and transferred to app address
- Pvium fee is deducted based on `pviumFeeBps` and transferred to Pvium address
- Remaining amount is transferred to vendor

**Gas Optimization:**
- Signature hashes only appId, accountAddress, and claimIds (not full payload)
- Fees are accumulated across all claims in the batch
- Single transfer to app fee address (instead of N transfers)
- Single transfer to Pvium fee address (instead of N transfers)

**Example:** For a 1000 token claim with 5% app fee and 1% Pvium fee:
- App receives: 50 tokens (transferred directly)
- Pvium receives: 10 tokens (transferred directly)
- Vendor receives: 940 tokens (transferred immediately)

---

#### finalizeClaim (SmartEscrow - Internal)
```solidity
function finalizeClaim(
  VendorPayoutPayload[] calldata vendorPayments
)
```
Internal function called by Factory to process batch payments.

**Access:** Only Factory

**Note:** This function should not be called directly. Use Factory.finalizeClaim() instead.

---

#### dispute
```solidity
function dispute(bytes32 claimId)
```
Raises a dispute for a specific payout claim within the dispute window.

**Parameters:**
- `claimId`: Unique identifier of the disputed claim

**Effects:**
- Freezes the claim until dispute is resolved

---

#### resolveDispute
```solidity
function resolveDispute(
  bytes32 claimId,
  bool allowClaim,
  bytes appSignature,
  bytes pviumSignature
)
```
Resolves a disputed claim with signatures from both app and Pvium.

**Parameters:**
- `claimId`: Disputed claim identifier
- `allowClaim`: Whether to approve (true) or reject (false) the claim
- `appSignature`: App's resolution signature
- `pviumSignature`: Pvium's resolution signature

---

#### endProject
```solidity
function endProject(string reason)
```
App-initiated project termination.

**Parameters:**
- `reason`: Explanation for ending the project

**Effects:**
- Project is marked as ended
- No further claims can be made

**Access:** Only app

---

#### emergencyWithdrawApp
```solidity
function emergencyWithdrawApp(uint256 amount)
```
Emergency withdraw for app (only callable by factory after project ends). Used as backup if direct fee transfers fail during finalizeClaim.

**Parameters:**
- `amount`: Amount to withdraw

**Access:** Only factory

**Requirements:**
- Project must be ended

---

#### emergencyWithdrawPvium
```solidity
function emergencyWithdrawPvium(uint256 amount)
```
Emergency withdraw for Pvium (only callable by factory after project ends). Used as backup if direct fee transfers fail during finalizeClaim.

**Parameters:**
- `amount`: Amount to withdraw

**Access:** Only factory

**Requirements:**
- Project must be ended

---

#### getBalance
```solidity
function getBalance() view returns (uint256)
```
Returns the current token balance held by the project contract.

**Returns:** Token balance

---

#### getApproval
```solidity
function getApproval(bytes32 claimId) view returns (
  tuple(
    address vendor,
    uint256 amount,
    uint256 approvedAt,
    bool claimed
  )
)
```
Retrieves approval details for a specific claim.

**Parameters:**
- `claimId`: Claim identifier

**Returns:**
- `vendor`: Vendor address
- `amount`: Approved amount
- `approvedAt`: Timestamp of approval
- `claimed`: Whether payout has been claimed

---

#### isClaimable
```solidity
function isClaimable(bytes32 claimId) view returns (bool)
```
Checks if a claim can be processed (dispute window passed, not disputed, not yet claimed).

**Parameters:**
- `claimId`: Claim identifier

**Returns:** True if claim is ready for payout

---

#### getDisputeDeadline
```solidity
function getDisputeDeadline(bytes32 claimId) view returns (uint256)
```
Returns the timestamp when the dispute window closes for a claim.

**Parameters:**
- `claimId`: Claim identifier

**Returns:** Unix timestamp of dispute deadline

---

#### getVendors
```solidity
function getVendors() view returns (address[])
```
Get all approved vendors.

**Returns:** Array of vendor addresses

---

#### getVendorCount
```solidity
function getVendorCount() view returns (uint256)
```
Get vendor count.

**Returns:** Number of approved vendors

---

#### getInfo
```solidity
function getInfo() view returns (
  string appId,
  string projectId,
  bytes metadata,
  address token,
  uint256 appFeeBps,
  uint256 pviumFeeBps,
  uint256 disputeWindowSeconds,
  uint256 lockExpiry,
  uint256 minimumBalancePerVendor,
  uint256 maxNumVendors,
  address appFeeAddress,
  address pviumFeeAddress,
  bool isActive,
  bool isEnded,
  uint256 balance,
  address[] vendors
)
```
Get comprehensive project information.

**Returns:** All project state variables

---

## Typical Workflow

### 1. Project Creation
```
App → Factory.createProject()
  ↓
Factory creates Project contract (CREATE2)
  ↓
Returns deterministic project address
```

### 2. Setup Phase (Before Activation)
```
App → Project.addVendors([vendor1, vendor2, ...])
Owner → Token.approve(accountAddress, amount)
Owner → Project.fundProject(amount)
```

### 3. Activation
```
App → Project.activateProject()
  ↓
Check: balance >= (minimumBalancePerVendor × vendorCount)
Check: at least one vendor added
Check: vendorCount <= maxNumVendors
  ↓
Funds locked for 6 months
Vendor list frozen
```

### 4. Payout Claims
```
Vendor → Factory.finalizeClaim(vendorPayments, pviumSignature)
  ↓
Factory extracts app and projectId from first payment
  ↓
Factory looks up project: projectsByUniqueId[hash(app || projectId)]
  ↓
Factory verifies all payments are for same project
  ↓
Factory verifies Pvium signature (app + projectId + claimIds + chainId)
  ↓
Factory → Project.finalizeClaim(vendorPayments)
  ↓
For each payment:
  - Verify payment is for this project (app + projectId match)
  - Validate app signature (app + projectId + claimId + vendor + amount + nonce)
  - Check vendor approved
  - Check dispute window passed
  - Calculate fees:
    • App fee: amount × appFeeBps / 10000
    • Pvium fee: amount × pviumFeeBps / 10000
    • Vendor payment: amount - app fee - Pvium fee
  - Transfer to vendor
  - Accumulate fees
  ↓
Batch transfer accumulated app fees to app address
Batch transfer accumulated Pvium fees to Pvium address
```

### 5. Dispute Resolution (If Needed)
```
Party → Project.dispute(claimId)
  ↓
App + Pvium review
  ↓
Project.resolveDispute(claimId, decision, signatures)
```

### 6. Project Completion
```
App → Project.endProject(reason)
  ↓
Mark project as ended
No further claims allowed
```

### 7. Emergency Fee Withdrawal (If Needed)
```
Factory → Project.emergencyWithdrawApp(amount)
  ↓
Transfer amount to app address

Factory → Project.emergencyWithdrawPvium(amount)
  ↓
Transfer amount to Pvium address
```

---

## Security Considerations

### Signatures
- All critical operations require multi-party signatures
- App signatures authorize vendor payments
- Pvium signatures validate dispute resolutions and batch finalizations
- Nonces prevent replay attacks

### Fund Safety
- Funds locked for 6 months after activation
- Per-vendor minimum balance requirement prevents activation of underfunded projects
- Minimum scales with vendor count (prevents vendor dilution)
- Maximum vendor limit prevents excessive dilution
- Only registered token can be used
- Dispute window protects against unauthorized claims
- Multi-signature requirement for dispute resolution
- Fees deducted only on successful payouts (not on deposits)

### Access Control
- Only approved vendors can claim payouts
- Vendor list cannot be modified after activation
- App controls project lifecycle (activation, termination)
- Emergency withdrawals only callable by factory after project ends
- Vendor removal not allowed (security measure)

### CREATE2 Security
- Deterministic addresses allow pre-funding
- Bytecode includes all constructor parameters
- Different parameters = different address
- Prevents parameter tampering attacks

---

## Fee Structure

Fees are denominated in basis points (bps):
- **1 bps = 0.01%**
- **100 bps = 1%**
- **10000 bps = 100%**

### Fee Calculation

Fees are deducted **during `finalizeClaim`** (not during funding):

```
For each vendor payout of amount A:
- App fee = A × appFeeBps / 10000
- Pvium fee = A × pviumFeeBps / 10000
- Vendor receives = A - App fee - Pvium fee
```

### Example Payout Breakdown

**Scenario:** Vendor claims 1000 USDC
- App fee: 500 bps (5%)
- Pvium fee: 100 bps (1%)

**Calculation:**
- App receives: 1000 × 500 / 10000 = **50 USDC** (transferred directly)
- Pvium receives: 1000 × 100 / 10000 = **10 USDC** (transferred directly)
- Vendor receives: 1000 - 50 - 10 = **940 USDC** (transferred immediately)

### Fee Transfer

- Fees are transferred directly to fee addresses during finalizeClaim
- Batch accumulation across multiple claims reduces gas costs
- Emergency withdrawal functions available as backup via factory

---

## Gas Optimization

### Batch Fee Transfers
Instead of transferring fees for each claim individually:
- **Old approach**: N claims = N app transfers + N Pvium transfers = 2N transfers
- **New approach**: N claims = 1 app transfer + 1 Pvium transfer = 2 transfers

**Example:** Batch of 10 claims
- Old: 20 token transfers
- New: 2 token transfers
- **Gas savings: 90%**

---

## Architecture Changes Summary

### From Previous Version

**Changed:**
1. ✅ Renamed "platform" to "app" throughout
2. ✅ Direct fee transfers instead of accumulation
3. ✅ Batch fee transfer optimization in finalizeClaim
4. ✅ Emergency withdrawal functions (factory-controlled)
5. ✅ Added maxNumVendors limit
6. ✅ Removed vendor removal capability (security)
7. ✅ App fee addresses stored in factory with hash mapping
8. ✅ _validatePayout returns amounts without transferring
9. ✅ Moved finalizeClaim with Pvium signature to Factory
10. ✅ Factory uses app + projectId from payload to lookup project address
11. ✅ Removed `notEnded` modifier from finalizeClaim (claims can finalize anytime after activation)
12. ✅ Signature hashes only app + projectId + claimIds (gas optimization)
13. ✅ App signature includes app + projectId + claimId + vendor + amount + nonce

**Benefits:**
- Lower gas costs (batch transfers, optimized signatures, removed app field)
- Simpler fee management (no per-project accumulation tracking)
- Better security (vendor list immutable after approval)
- Scalable (factory manages fee addresses for all apps)
- Cleaner architecture (Factory handles cross-project logic, Pvium signature verification)
- Flexible (claims can be finalized even after project ends)
