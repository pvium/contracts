# Deployment Guide

This guide explains how to deploy the contracts to different networks using Hardhat.

## Prerequisites

1. **Install dependencies:**
   ```bash
   yarn install
   ```

2. **Set up environment variables:**
   ```bash
   cp .env.example .env
   ```

3. **Edit `.env` file:**
   - Add your private key (without `0x` prefix)
   - Add API keys for contract verification
   - (Optional) Add custom RPC URLs

## Supported Networks

### Mainnets
- **Ethereum** (`ethereum`) - Chain ID: 1
- **Base** (`base`) - Chain ID: 8453
- **BSC** (`bsc`) - Chain ID: 56

### Testnets
- **Sepolia** (`sepolia`) - Chain ID: 11155111
- **Base Sepolia** (`baseSepolia`) - Chain ID: 84532
- **BSC Testnet** (`bscTestnet`) - Chain ID: 97

### Local
- **Hardhat Network** (`hardhat`) - Chain ID: 31337

## Deployment Commands

### Compile Contracts

```bash
npx hardhat compile
```

### Run Tests

```bash
npx hardhat test
```

### Deploy to Local Network

```bash
# Start local node
npx hardhat node

# Deploy (in another terminal)
npx hardhat run scripts/deployTokenRelay.ts --network localhost
```

### Deploy to Testnet

```bash
# Base Sepolia
npx hardhat run scripts/deployTokenRelay.ts --network basetest

# Ethereum Sepolia
npx hardhat run scripts/deployTokenRelay.ts --network sepolia

# BSC Testnet
npx hardhat run scripts/deployTokenRelay.ts --network bsctest
```

### Deploy to Mainnet

```bash
# Base Mainnet
npx hardhat run scripts/deployTokenRelay.ts --network base

# Ethereum Mainnet
npx hardhat run scripts/deployTokenRelay.ts --network ethereum

# BSC Mainnet
npx hardhat run scripts/deployTokenRelay.ts --network bsc
```

## Example Deployment Script

Create `scripts/deployTokenRelay.ts`:

```typescript
import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();

  console.log("Deploying contracts with account:", deployer.address);
  console.log("Account balance:", (await ethers.provider.getBalance(deployer.address)).toString());

  // Deploy TokenRelay
  const TokenRelay = await ethers.getContractFactory("TokenRelay");
  const relay = await TokenRelay.deploy(
    100,                               // feePercentage: 1%
    1000,                              // maxFeePercentage: 10%
    ethers.parseUnits("1", 18),       // minimumAmount: 1 token
    "TokenRelay",                      // EIP-712 domain name
    "1"                                // EIP-712 domain version
  );

  await relay.waitForDeployment();

  console.log("TokenRelay deployed to:", await relay.getAddress());
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
```

## Verify Contracts

After deployment, verify on block explorers:

```bash
# Ethereum/Sepolia (Etherscan)
npx hardhat verify --network ethereum DEPLOYED_ADDRESS 100 1000 "1000000000000000000" "TokenRelay" "1"

# Base/Base Sepolia (Basescan)
npx hardhat verify --network base DEPLOYED_ADDRESS 100 1000 "1000000000000000000" "TokenRelay" "1"

# BSC (BSCScan)
npx hardhat verify --network bsc DEPLOYED_ADDRESS 100 1000 "1000000000000000000" "TokenRelay" "1"
```

## Network-Specific Notes

### Ethereum
- **Gas:** Very high on mainnet, use Sepolia for testing
- **RPC:** Use Infura, Alchemy, or public RPCs
- **Verification:** Etherscan API key required

### Base
- **Gas:** Lower than Ethereum L1
- **RPC:** Official Base RPC endpoints
- **Verification:** Basescan API key required
- **Note:** Base is an Ethereum L2, transactions are fast and cheap

### BSC
- **Gas:** Paid in BNB, generally lower than Ethereum
- **RPC:** Binance provides free RPC endpoints
- **Verification:** BSCScan API key required
- **Note:** Different wallet setup may be needed for BNB

## Gas Optimization

Enable gas reporting in `.env`:

```bash
REPORT_GAS=true
COINMARKETCAP_API_KEY=your_api_key_here
```

Run tests with gas reporting:

```bash
REPORT_GAS=true npx hardhat test
```

## Security Checklist

Before deploying to mainnet:

- [ ] All tests passing
- [ ] Contracts audited (if handling significant value)
- [ ] Private key stored securely (hardware wallet recommended)
- [ ] Environment variables not committed to git
- [ ] Gas price appropriate for network
- [ ] Deployment script tested on testnet
- [ ] Verification API keys configured
- [ ] Multi-sig wallet setup for admin roles
- [ ] Emergency procedures documented

## Troubleshooting

### "Insufficient funds for gas"
- Check account balance on target network
- Get testnet tokens from faucets:
  - Sepolia: https://sepoliafaucet.com/
  - Base Sepolia: https://www.coinbase.com/faucets/base-ethereum-sepolia-faucet
  - BSC Testnet: https://testnet.bnbchain.org/faucet-smart

### "Invalid API key"
- Verify API keys in `.env` file
- Check network-specific API key (Etherscan vs Basescan vs BSCScan)

### "Nonce too low"
- Reset account in MetaMask (Settings > Advanced > Reset Account)
- Or manually specify nonce in transaction

### Contract verification fails
- Ensure constructor arguments match exactly
- Check Solidity version matches hardhat.config.js
- Verify on correct network

## Multi-Network Deployment

Deploy to multiple networks:

```typescript
// scripts/deployAll.ts
import hre from "hardhat";

const networks = ['sepolia', 'basetest', 'bsctest'];

async function main() {
  for (const network of networks) {
    console.log(`\nDeploying to ${network}...`);
    await hre.run('run', {
      script: 'scripts/deployTokenRelay.ts',
      network: network
    });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
```

## Useful Commands

```bash
# Check network
npx hardhat run scripts/checkNetwork.js --network base

# Get account info
npx hardhat run scripts/accountInfo.js --network sepolia

# Interact with deployed contract
npx hardhat console --network base

# Run specific test
npx hardhat test test/TokenRelay.test.js

# Clean artifacts
npx hardhat clean

# Flatten contracts (for verification)
npx hardhat flatten contracts/TokenRelay.sol > TokenRelay_flat.sol
```

## Getting Testnet Tokens

### Sepolia ETH
- https://sepoliafaucet.com/
- https://faucet.quicknode.com/ethereum/sepolia

### Base Sepolia ETH
- https://www.coinbase.com/faucets/base-ethereum-sepolia-faucet
- Bridge from Sepolia: https://bridge.base.org/

### BSC Testnet BNB
- https://testnet.bnbchain.org/faucet-smart

## Production Deployment Checklist

1. **Test thoroughly on testnet**
2. **Audit smart contracts**
3. **Use hardware wallet for deployment**
4. **Deploy with gnosis safe as admin**
5. **Set up monitoring and alerts**
6. **Prepare incident response plan**
7. **Document all deployed addresses**
8. **Verify contracts on block explorers**
9. **Set up DAO governance (if applicable)**
10. **Create user documentation**

## Example Mainnet Deployment Flow

```bash
# 1. Test on testnets
npx hardhat test
npx hardhat run scripts/deployTokenRelay.js --network sepolia
npx hardhat run scripts/deployTokenRelay.js --network baseSepolia

# 2. Verify testnet deployments
npx hardhat verify --network sepolia TESTNET_ADDRESS ...

# 3. Get audit (recommended)
# Send contracts to auditor

# 4. Deploy to mainnet
npx hardhat run scripts/deployTokenRelay.js --network base

# 5. Verify mainnet
npx hardhat verify --network base MAINNET_ADDRESS ...

# 6. Transfer admin roles to multi-sig
# Use scripts/transferAdmin.js

# 7. Test in production with small amounts
# Monitor for issues

# 8. Gradually increase usage
```
