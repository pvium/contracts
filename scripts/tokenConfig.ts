// Commonly accepted stablecoins by network
// This file is separate from deployEscrowFactory.ts to avoid hardhat dependency issues
// when using with standalone ethers scripts

export const acceptedTokensByChain: Record<number, string[]> = {
  // ============= MAINNETS =============

  // Ethereum Mainnet
  1: [
    "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", // USDC
    "0xdAC17F958D2ee523a2206206994597C13D831ec7", // USDT
  ],

  // BSC Mainnet
  56: [
    "0x55d398326f99059fF775485246999027B3197955", // USDT
  ],

  // Base Mainnet
  8453: [
    "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", // USDC (native)
  ],

  // ============= TESTNETS =============

  // Sepolia Testnet (Ethereum)
  11155111: [
    "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238", // USDC (Sepolia faucet)
    "0x7169D38820dfd117C3FA1f22a697dBA58d90BA06", // USDT (Sepolia test)
  ],

  // Base Sepolia
  84532: [
    "0x036CbD53842c5426634e7929541eC2318f3dCF7e", // USDC (Base Sepolia)
  ],

  // BSC Testnet
  97: [
    "0x64544969ed7EBf5f083679233325356EbE738930", // USDC (BSC Testnet)
    "0x7ef95a0FEE0Dd31b22626fA2e10Ee6A223F8a684", // USDT (BSC Testnet)
  ],

  // ============= LOCAL =============

  // Hardhat/Localhost
  31337: ['0x5FbDB2315678afecb367f032d93F642f64180aa3'],
};
