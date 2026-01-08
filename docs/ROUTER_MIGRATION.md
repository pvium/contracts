# Router Contracts Migration to AccessControl

Both `UniversalDexRouter` and `AerodromeRouter` have been migrated from a custom admin system to OpenZeppelin's `AccessControl` for better role management and security.

## Changes Made

### Before (Old System)

```solidity
// Custom admin implementation
contract UniversalDexRouter is Ownable, ReentrancyGuard {
    address public admin;

    modifier onlyAdmin() {
        require(msg.sender == admin, "Only admin can call this function");
        _;
    }

    function setAdmin(address newAdmin) external onlyOwner { }
    function setFeeReceiver(address newFeeReceiver) external onlyAdmin { }
    function emergencyWithdraw(address token, uint256 amount) external onlyOwner { }
}
```

### After (AccessControl System)

```solidity
// OpenZeppelin AccessControl
contract UniversalDexRouter is AccessControl, ReentrancyGuard {
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");

    function setFeeReceiver(address newFeeReceiver) external onlyRole(ADMIN_ROLE) { }
    function emergencyWithdraw(address token, address to, uint256 amount) external onlyRole(DEFAULT_ADMIN_ROLE) { }
}
```

## Summary of Changes

### 1. **Removed Custom Admin System**
- ❌ Removed `address public admin` state variable
- ❌ Removed `modifier onlyAdmin()`
- ❌ Removed `setAdmin()` function
- ❌ Removed `AdminUpdated` event

### 2. **Added AccessControl**
- ✅ Inherit from `AccessControl` instead of `Ownable`
- ✅ Added `ADMIN_ROLE` constant
- ✅ Use `DEFAULT_ADMIN_ROLE` for emergency functions
- ✅ Use `onlyRole(ADMIN_ROLE)` modifier

### 3. **Updated Constructor**

**Before:**
```solidity
constructor(
    address _router,
    address _weth,
    address _feeReceiver,
    address _admin,        // Admin address
    address initialOwner   // Owner address
) Ownable(initialOwner)
```

**After:**
```solidity
constructor(
    address _router,
    address _weth,
    address _feeReceiver,
    address _defaultAdmin,  // Gets DEFAULT_ADMIN_ROLE
    address _admin          // Gets ADMIN_ROLE
) {
    _grantRole(DEFAULT_ADMIN_ROLE, _defaultAdmin);
    _grantRole(ADMIN_ROLE, _admin);
}
```

### 4. **Updated Functions**

#### `setFeeReceiver()`
**Before:**
```solidity
function setFeeReceiver(address newFeeReceiver) external onlyAdmin
```

**After:**
```solidity
function setFeeReceiver(address newFeeReceiver) external onlyRole(ADMIN_ROLE)
```

#### `emergencyWithdraw()`
**Before:**
```solidity
function emergencyWithdraw(address token, uint256 amount) external onlyOwner {
    if (token == address(0)) {
        payable(owner()).transfer(amount);
    } else {
        IERC20(token).safeTransfer(owner(), amount);
    }
}
```

**After:**
```solidity
function emergencyWithdraw(
    address token,
    address to,
    uint256 amount
) external onlyRole(DEFAULT_ADMIN_ROLE) {
    require(to != address(0), "Invalid recipient address");
    if (token == address(0)) {
        payable(to).transfer(amount);
    } else {
        IERC20(token).safeTransfer(to, amount);
    }
}
```

**Note:** Emergency withdraw now accepts a `to` parameter for flexibility.

## Role Hierarchy

```
DEFAULT_ADMIN_ROLE (Super Admin)
  ├─ Can grant/revoke ADMIN_ROLE
  ├─ Can grant/revoke DEFAULT_ADMIN_ROLE
  └─ Can emergency withdraw funds

ADMIN_ROLE (Operations)
  └─ Can update fee receiver address
```

## Deployment Examples

### UniversalDexRouter

**Before:**
```javascript
const router = await UniversalDexRouter.deploy(
    uniswapRouter,
    wethAddress,
    feeReceiver,
    adminAddress,      // Admin
    ownerAddress       // Owner
);
```

**After:**
```javascript
const router = await UniversalDexRouter.deploy(
    uniswapRouter,
    wethAddress,
    feeReceiver,
    defaultAdminAddress,  // Gets DEFAULT_ADMIN_ROLE
    adminAddress          // Gets ADMIN_ROLE
);

// Both can be the same address initially
const router = await UniversalDexRouter.deploy(
    uniswapRouter,
    wethAddress,
    feeReceiver,
    deployerAddress,  // Gets both roles
    deployerAddress
);
```

### AerodromeRouter

**Before:**
```javascript
const router = await AerodromeRouter.deploy(
    aerodromeRouter,
    wethAddress,
    feeReceiver,
    adminAddress,
    ownerAddress
);
```

**After:**
```javascript
const router = await AerodromeRouter.deploy(
    aerodromeRouter,
    wethAddress,
    feeReceiver,
    defaultAdminAddress,
    adminAddress
);
```

## Migration Guide for Existing Deployments

If you have existing router contracts deployed with the old system, you cannot directly upgrade them (they're not upgradeable). However, you can:

1. **Deploy new router contracts** with AccessControl
2. **Migrate fee receiver** settings
3. **Update your frontend/backend** to use the new contract addresses
4. **Emergency withdraw** any stuck funds from old contracts

## Managing Roles

### Grant ADMIN_ROLE

```javascript
const ADMIN_ROLE = await router.ADMIN_ROLE();
await router.connect(defaultAdmin).grantRole(ADMIN_ROLE, newAdminAddress);
```

### Revoke ADMIN_ROLE

```javascript
const ADMIN_ROLE = await router.ADMIN_ROLE();
await router.connect(defaultAdmin).revokeRole(ADMIN_ROLE, oldAdminAddress);
```

### Transfer DEFAULT_ADMIN_ROLE

```javascript
// Grant to new admin first
await router.connect(currentDefaultAdmin).grantRole(DEFAULT_ADMIN_ROLE, newDefaultAdmin);

// Then renounce old admin
await router.connect(currentDefaultAdmin).renounceRole(DEFAULT_ADMIN_ROLE, currentDefaultAdminAddress);
```

### Check Roles

```javascript
const hasAdminRole = await router.hasRole(ADMIN_ROLE, addressToCheck);
const hasDefaultAdminRole = await router.hasRole(DEFAULT_ADMIN_ROLE, addressToCheck);
```

## Security Benefits

### Before (Custom Admin)
- ❌ Two-tier system (Owner → Admin) was confusing
- ❌ Owner had to manually update admin address
- ❌ No built-in role management
- ❌ Emergency withdraw only to owner

### After (AccessControl)
- ✅ Industry-standard role management
- ✅ Multiple admins possible
- ✅ Flexible role assignment/revocation
- ✅ Emergency withdraw to any address
- ✅ Events for all role changes (via AccessControl)
- ✅ Battle-tested OpenZeppelin implementation

## Progressive Decentralization

### Phase 1: Centralized
```javascript
// Deploy with single address having both roles
await router.deploy(
    routerAddress,
    weth,
    feeReceiver,
    deployer,  // DEFAULT_ADMIN_ROLE
    deployer   // ADMIN_ROLE (same address)
);
```

### Phase 2: Multi-Sig
```javascript
// Transfer to multi-sigs
await router.grantRole(DEFAULT_ADMIN_ROLE, governanceMultisig);
await router.grantRole(ADMIN_ROLE, operationsMultisig);

// Revoke from deployer
await router.renounceRole(DEFAULT_ADMIN_ROLE, deployer);
await router.renounceRole(ADMIN_ROLE, deployer);
```

### Phase 3: DAO Governance
```javascript
// Grant DEFAULT_ADMIN_ROLE to timelock/DAO
await router.grantRole(DEFAULT_ADMIN_ROLE, daoTimelockAddress);

// Keep ADMIN_ROLE with ops team for day-to-day
// Or grant to DAO as well for full decentralization
```

## Testing

Both contracts maintain the same swap functionality. The only changes are administrative. Test coverage should include:

1. ✅ ADMIN_ROLE can update fee receiver
2. ✅ Non-admin cannot update fee receiver
3. ✅ DEFAULT_ADMIN_ROLE can emergency withdraw
4. ✅ Non-default-admin cannot emergency withdraw
5. ✅ DEFAULT_ADMIN_ROLE can grant/revoke ADMIN_ROLE
6. ✅ ADMIN_ROLE cannot grant roles (no DEFAULT_ADMIN_ROLE)
7. ✅ All swap functions work identically

## Backward Compatibility

**Breaking Changes:**
- Constructor signature changed (requires migration)
- `setAdmin()` function removed (use `grantRole()`/`revokeRole()`)
- `emergencyWithdraw()` now requires `to` parameter
- No more `Ownable`, so no `owner()` or `transferOwnership()`

**Non-Breaking:**
- All swap functions unchanged
- Fee receiver management works the same way
- Same events for swaps and fee receiver updates

## Conclusion

The migration to AccessControl provides:
- ✅ Better role management
- ✅ More flexibility
- ✅ Industry-standard patterns
- ✅ Easier progressive decentralization
- ✅ Better security through battle-tested OpenZeppelin code

All contracts now follow the same access control pattern as `TokenRelay`, creating consistency across the codebase.
