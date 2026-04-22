# Escrow Fee Structure

## Overview
The SmartEscrow system uses a **vendor-friendly fee model** where vendors receive **100% of their promised payout**. All fees are paid separately from the contract balance by the platform.

## Fee Model: Platform Pays Fees

### How It Works
1. **Payout Amount = What Vendor Receives**
   - If you create a $100 payout, the vendor receives exactly $100
   - No surprise deductions
   - "What you see is what you get"

2. **Fees are Additional Costs**
   - App fees and Pvium fees are paid from the escrow contract balance
   - Platform funds the contract with: `Total Payouts + Total Fees`

### Example

**Scenario:** Create a $100 payout with 2% app fee and 0.5% Pvium fee

```
Payout to vendor:     $100.00  (vendor receives this)
App fee (2%):         $  2.00  (paid from contract balance)
Pvium fee (0.5%):     $  0.50  (paid from contract balance)
──────────────────────────────
Total funding needed: $102.50
```

**Contract Flow:**
```solidity
// 1. Platform funds contract
contract.fundAccount($102.50)

// 2. Vendor receives full payout
vendor receives:  $100.00 ✅

// 3. Fees transferred to fee addresses
app receives:     $2.00
pvium receives:   $0.50
```

## Funding Calculator

### Formula
```typescript
totalFunding = sum(payouts) + appFees + pviumFees

where:
  appFees = sum(payouts) × (appFeeBps / 10000)
  pviumFees = sum(payouts) × (pviumFeeBps / 10000)
```

### Example Calculation
```typescript
// Configuration
const payouts = [100, 150, 75]; // $325 total
const appFeeBps = 200;           // 2%
const pviumFeeBps = 50;          // 0.5%

// Calculate fees
const totalPayouts = 325;
const appFees = (325 * 200) / 10000;    // $6.50
const pviumFees = (325 * 50) / 10000;   // $1.625

// Total funding required
const totalFunding = 325 + 6.50 + 1.625; // $333.125
```

## Activation Requirements

The contract **CANNOT be activated** unless it has sufficient balance:

```solidity
requiredBalance = (maxPayout × numReceivers) + fees

// Example with 10 receivers, $150 max payout each, 2.5% total fees
requiredBalance = (150 × 10) + (1500 × 0.025)
                = 1500 + 37.50
                = $1,537.50
```

**Error if underfunded:**
```
Error: Insufficient balance for activation
```

## Benefits of This Model

### For Vendors
✅ **Transparency** - Get exactly what was promised
✅ **Trust** - No hidden fee deductions
✅ **Simplicity** - Easy to understand
✅ **Better Experience** - Increases platform retention

### For Platforms
✅ **Competitive Advantage** - "No vendor fees" marketing
✅ **Legal Safety** - Advertised amount matches received amount
✅ **Reduced Support** - Fewer "where's my money?" tickets
✅ **Pricing Flexibility** - Can absorb or pass costs to clients

### For the Ecosystem
✅ **Higher Vendor Satisfaction** - Better marketplace dynamics
✅ **Regulatory Compliance** - Meets consumer protection laws
✅ **Market Differentiation** - Stands out from competitors

## API Integration

### Creating Escrow Account

When creating an account, calculate total funding needed:

```typescript
// POST /escrow/accounts
{
  "projectId": "project-123",
  "basePayout": "100000000",      // $100 (6 decimals)
  "maxPayout": "150000000",       // $150
  "maxNumReceivers": 10,
  "appFeeBps": 200,               // 2%
  // ... other params
}

// Calculate funding needed
const totalMaxPayout = 150 * 10;  // $1,500
const fees = 1500 * 0.025;        // $37.50
const fundingNeeded = 1537.50;    // Transfer this amount to contract
```

### Creating Payouts

Payout amount = exact amount vendor will receive:

```typescript
// POST /escrow/payouts
{
  "payouts": [
    {
      "projectId": "project-123",
      "receiver": "0x...",
      "amount": "100000000",  // $100 - vendor receives EXACTLY this
      // ... other fields
    }
  ]
}

// Vendor will receive: $100.00 ✅
// App fee paid separately: $2.00
// Pvium fee paid separately: $0.50
```

## Migration Notes

### For Existing Platforms

If you previously deducted fees from payouts, you need to:

1. **Update Payout Amounts**
   ```typescript
   // OLD (deducted fees): vendor gets $97.50
   amount: 100

   // NEW (full amount): vendor gets $100
   amount: 100
   ```

2. **Increase Funding**
   ```typescript
   // OLD: fund exactly $100
   fundAccount(100)

   // NEW: fund $100 + fees
   fundAccount(102.50)
   ```

3. **Update Documentation**
   - Tell vendors they'll receive full amounts
   - Update pricing calculators
   - Adjust billing to clients if needed

## Contract Reference

### Key Changes in SmartEscrow.sol

**Before:**
```solidity
receiverAmount = payment.amount - appFee - pviumFee;  // ❌
```

**After:**
```solidity
receiverAmount = payment.amount;  // ✅ Full amount to vendor
appFee = (payment.amount * appFeeBps) / 10000;       // Paid from contract
pviumFee = (payment.amount * pviumFeeBps) / 10000;   // Paid from contract
```

## Support

For questions about fee structure:
- Read: `contracts/SmartEscrow.sol` (lines 358-437)
- Check: `contracts/SmartEscrow.sol::activateAccount()` (lines 272-300)
- Test: Run `npx hardhat test test/SmartEscrow.test.ts`

---

**Last Updated:** 2026-04-03
**Contract Version:** SmartEscrow v1.0
