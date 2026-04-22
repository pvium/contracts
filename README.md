# Pvium Blockchain Repo

Pvium is a blockchain payments infrastructure project focused on programmable zero custody settlement and payout flows. This repository contains the core smart contracts, deployment scripts, and integration helpers that power Pvium payment protocols.
For more info visit [https://pvium.com](pvium.com)

## Protocols

- [SwapProtocol.md](./SwapProtocol.md) describes Pvium's swap-based payment routing protocol built around `UniversalDexRouter`.
- [BatchPaymentProtocol.md](./BatchPaymentProtocol.md) describes Pvium's scheduled batch payment protocol built around `MerkleBatchPayout`.

## Repo Scope

This repo includes:

- smart contracts for payment routing and scheduled payouts
- deployment and operation scripts
- tests and helper utilities for contract integration

For contract-level implementation details, see the protocol documents above and the contract source under `contracts/`.
