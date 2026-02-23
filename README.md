# MEMO Wallet

The very first mobile wallet for X1 and Solana blockchain. Exclusive on Solana Seeker. Secured by the native Seed Vault.


## Code Organization Principles

### File Responsibilities

- `src/rpc.ts`: All blockchain-shared utilities (RPC calls, encoding/decoding, constants)
- `src/portfolio.ts`: Portfolio/asset-related logic (token discovery, balance queries)
- `src/swap.ts`: Swap/trading-related logic (pool queries, price calculation, trade instructions)
- `src/send.ts`: Send/transfer logic (validation, transaction building, execution, history)
- `App.tsx`: Only contains UI rendering and state management, calls functions from modules

### Multi-Chain Support

All RPC utility functions should support an optional `rpcUrl` parameter:

- X1 RPC: `https://rpc.mainnet.x1.xyz`
- Solana RPC: `https://api.mainnet-beta.solana.com`

## Development Workflow

**Important**: This project uses direct device debugging without Metro bundler.

Development flow:

1. Modify code
2. Run `npm run lint`
3. Build and deploy APK
4. Test on device

**Automation**: After each code change, automatically build APK and deploy to device for testing.

## Development Commands

```bash
# Lint code
npm run lint

# Run tests
npm test

# Build APK
cd android && ./gradlew assembleDebug

# Install to device
adb -s SM02G40619145272 install -r android/app/build/outputs/apk/debug/app-debug.apk
```

APK location: `android/app/build/outputs/apk/debug/app-debug.apk`

## Code Style Guidelines

### General Rules

- Follow React Native conventions (`@react-native/eslint-config`)
- Use TypeScript for all code
- Use functional components with hooks
- Define return types for all functions
- Use `null` instead of `undefined` for nullable values

## LICENSE

## PRIVACY POLICY

## COPYRIGHT

© 2026 xen_artist | MEMO Wallet. All rights reserved.
