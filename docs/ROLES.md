# TokenRelay Access Control System

The TokenRelay contract uses OpenZeppelin's `AccessControl` for role-based permissions, providing a flexible and secure way to manage administrative functions.

## Roles Overview

### 1. DEFAULT_ADMIN_ROLE
- **Purpose**: Master admin role that can grant and revoke all other roles
- **Permissions**:
  - Grant/revoke ADMIN_ROLE
  - Grant/revoke DAO_ROLE
  - Grant/revoke DEFAULT_ADMIN_ROLE to other accounts
- **Initial Assignment**: Granted to contract deployer
- **Use Case**: Protocol owner or multi-sig wallet for critical governance

### 2. ADMIN_ROLE
- **Purpose**: Day-to-day operational management
- **Permissions**:
  - Add supported tokens (`addSupportedToken`)
  - Remove supported tokens (`removeSupportedToken`)
  - Set fee percentage (`setFeePercentage`) - must be ≤ maxFeePercentage
  - Set minimum transfer amount (`setMinimumAmount`)
- **Initial Assignment**: Granted to contract deployer
- **Use Case**: Operations team, protocol administrators, or multi-sig

### 3. DAO_ROLE
- **Purpose**: Governance-level parameter control
- **Permissions**:
  - Set maximum fee percentage (`setMaxFeePercentage`)
- **Initial Assignment**: Granted to contract deployer
- **Use Case**: DAO governance contract, community multi-sig, or voting mechanism

## Key Constraints

### Fee Percentage Hierarchy
```
maxFeePercentage (DAO controlled)
    ↓
feePercentage (ADMIN controlled, must be ≤ maxFeePercentage)
```

- **maxFeePercentage**: Hard cap set by DAO, protects users from excessive fees
- **feePercentage**: Current active fee, can be adjusted by ADMIN within DAO-approved limits
- When DAO lowers `maxFeePercentage` below current `feePercentage`, the contract automatically reduces `feePercentage` to match

## Deployment Example

```javascript
const TokenRelay = await ethers.getContractFactory("TokenRelay");
const relay = await TokenRelay.deploy(
    100,   // feePercentage: 1% (100 basis points)
    1000,  // maxFeePercentage: 10% (1000 basis points)
    ethers.parseUnits("1", 18) // minimumAmount: 1 token
);

// Deployer automatically receives:
// - DEFAULT_ADMIN_ROLE
// - ADMIN_ROLE
// - DAO_ROLE
```

## Role Management Examples

### Granting Roles

```javascript
const ADMIN_ROLE = await relay.ADMIN_ROLE();
const DAO_ROLE = await relay.DAO_ROLE();

// Grant ADMIN_ROLE to operations team
await relay.grantRole(ADMIN_ROLE, operationsAddress);

// Grant DAO_ROLE to governance contract
await relay.grantRole(DAO_ROLE, daoGovernanceAddress);
```

### Revoking Roles

```javascript
// Revoke ADMIN_ROLE from an address
await relay.revokeRole(ADMIN_ROLE, formerAdminAddress);

// Admin can also renounce their own role
await relay.connect(admin).renounceRole(ADMIN_ROLE, adminAddress);
```

### Checking Roles

```javascript
const hasAdminRole = await relay.hasRole(ADMIN_ROLE, addressToCheck);
const hasDAORole = await relay.hasRole(DAO_ROLE, addressToCheck);
```

## Progressive Decentralization Strategy

### Phase 1: Centralized (Launch)
```
DEFAULT_ADMIN_ROLE: Deployer EOA
ADMIN_ROLE: Deployer EOA
DAO_ROLE: Deployer EOA
```

### Phase 2: Multi-Sig Transition
```
DEFAULT_ADMIN_ROLE: Multi-sig wallet
ADMIN_ROLE: Operations multi-sig
DAO_ROLE: Governance multi-sig
```

### Phase 3: Full Decentralization
```
DEFAULT_ADMIN_ROLE: Timelock contract
ADMIN_ROLE: Protocol operators
DAO_ROLE: DAO governance contract (token voting)
```

## Security Considerations

### Role Separation
- **ADMIN_ROLE** cannot change the max fee cap (prevents unilateral fee increases)
- **DAO_ROLE** controls the fee ceiling (community governance decides limits)
- **DEFAULT_ADMIN_ROLE** should be moved to a timelock or DAO as soon as practical

### Fee Protection Mechanism
```solidity
// ADMIN tries to set fee above max
setFeePercentage(1500); // Reverts with FeeExceedsMaxAllowed

// DAO lowers max fee
setMaxFeePercentage(500); // Auto-adjusts feePercentage if needed
```

### Best Practices
1. **Separate Concerns**: Use different addresses/multi-sigs for ADMIN and DAO roles
2. **Timelock**: Consider adding a timelock for DAO_ROLE operations
3. **Multi-Sig**: Use multi-signature wallets for all roles in production
4. **Monitoring**: Monitor role grant/revoke events
5. **Emergency Plan**: Document emergency procedures for role management

## Events

All role changes emit standard AccessControl events:
- `RoleGranted(bytes32 indexed role, address indexed account, address indexed sender)`
- `RoleRevoked(bytes32 indexed role, address indexed account, address indexed sender)`

Custom events for parameter changes:
- `FeePercentageUpdated(uint256 oldFee, uint256 newFee)`
- `MaxFeePercentageUpdated(uint256 oldMaxFee, uint256 newMaxFee)`
- `MinimumAmountUpdated(uint256 oldMinimum, uint256 newMinimum)`
- `TokenAdded(address indexed token)`
- `TokenRemoved(address indexed token)`

## Testing Role-Based Access

See `test/TokenRelay.test.js` for comprehensive examples:
- Role assignment and verification
- Access control enforcement
- Role revocation
- Multi-role workflows

## Common Operations

### Daily Operations (ADMIN_ROLE)
```javascript
// Add a new supported token
await relay.connect(admin).addSupportedToken(newTokenAddress);

// Adjust fee within allowed range
await relay.connect(admin).setFeePercentage(150); // 1.5%

// Update minimum transfer amount
await relay.connect(admin).setMinimumAmount(ethers.parseUnits("5", 18));
```

### Governance Changes (DAO_ROLE)
```javascript
// DAO vote passes to reduce max fee to 5%
await relay.connect(dao).setMaxFeePercentage(500);
```

### Administrative Actions (DEFAULT_ADMIN_ROLE)
```javascript
// Rotate ADMIN_ROLE to new operations team
await relay.connect(defaultAdmin).revokeRole(ADMIN_ROLE, oldOpsAddress);
await relay.connect(defaultAdmin).grantRole(ADMIN_ROLE, newOpsAddress);

// Transfer DEFAULT_ADMIN_ROLE to timelock
await relay.connect(defaultAdmin).grantRole(DEFAULT_ADMIN_ROLE, timelockAddress);
await relay.connect(defaultAdmin).renounceRole(DEFAULT_ADMIN_ROLE, defaultAdminAddress);
```
