# MemoWallet Agent

React Native wallet application development guide.

## Project Structure

- `App.tsx` - Main app entry (UI + state management only)
- `index.js` - React Native entry
- `ios/` - iOS native code
- `android/` - Android native code
- `__tests__/` - Test files
- `sessions/` - Session memory storage
- `assets/` - Images and static assets
- `src/` - Source code modules
  - `src/rpc.ts` - Shared RPC utilities, constants, encoding
  - `src/portfolio.ts` - Portfolio asset discovery logic
  - `src/swap.ts` - xDEX swap functionality
  - `src/send.ts` - Send/transfer functionality
  - `src/QRScanner.tsx` - QR code scanner component

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

### Token Discovery

Use xDEX API to fetch wallet token information:

```typescript
import {fetchXDEXWalletTokens} from './rpc';

const tokens = await fetchXDEXWalletTokens(walletAddress, 'X1 Mainnet');
const solTokens = await fetchXDEXWalletTokens(walletAddress, 'Solana Mainnet');
```

API endpoint: `https://api.xdex.xyz/api/xendex/wallet/tokens?wallet_address={addr}&network=X1%20Mainnet`

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

### Import Order

1. React core
2. React Native modules
3. Third-party libraries
4. Local modules/assets

### Naming Conventions

- **Components**: PascalCase (`WalletScreen`, `TokenItem`)
- **Functions**: camelCase (`fetchBalances`, `executeSend`)
- **Variables**: camelCase (`publicKey`, `isLoading`)
- **Constants**: UPPER_SNAKE_CASE
- **Types/Interfaces**: PascalCase (`TokenInfo`, `SendParams`)
- **Files**: kebab-case for utils, PascalCase for components

### Error Handling

Always wrap async operations in try/catch:

```typescript
try {
  const result = await someAsyncOperation();
} catch (error) {
  const errorMessage = error instanceof Error ? error.message : String(error);
  console.error('Operation failed:', error);
  Alert.alert('Error', `Failed: ${errorMessage}`);
}
```

### Styling

- Use `StyleSheet.create` for all styles
- Use flexbox for layouts
- Define colors/constants outside components
- Use `Platform.select()` for platform-specific styles

## Session Memory

See `sessions/SKILL.md` for details.

Commands:

- `/save` - Save current session
- `/load [date]` - Load historical session

## xDEX Integration

### RPC Endpoints

- X1 Mainnet: `https://rpc.mainnet.x1.xyz`
- Solana Mainnet: `https://api.mainnet-beta.solana.com`

### Important Addresses

- xDEX Program: `sEsYH97wqmfnkzHedjNcw3zyJdPvUmsa9AixhS4b4fN`
- USDC Mint: `B69chRzqzDCmdB5WYB8NRu5Yv5ZA95ABiZcdzCgGm9Tq`
- Native XNT: `So11111111111111111111111111111111111111111`
- Wrapped XNT: `So11111111111111111111111111111111111111112`
- Token Program: `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA`
- Token-2022 Program: `TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb`

## Feature Implementations

### Send Functionality

Complete implementation in `src/send.ts`:

**Core Features**:

- Native token transfers (XNT/SOL)
- SPL Token transfers (Token Program + Token-2022)
- Auto-create recipient ATA if needed
- Dynamic CU optimization via transaction simulation
- Address validation with visual feedback
- Send history with English time format
- Multiple recipient input modes (manual, paste, history, QR scan)

**Key Functions**:

- `isValidSolanaAddress()` - Validates Solana addresses
- `executeSend()` - Builds and sends transactions
- `formatTimeAgo()` - Formats timestamps ("5m ago", "2d ago")
- `loadSendHistory()`, `addSendHistory()` - Manage send history

**CU Optimization Strategy**:

1. Build transaction without CU instruction
2. Simulate transaction to get actual `unitsConsumed`
3. Calculate optimized CU = `unitsConsumed × 1.1` (10% buffer)
4. Add CU instruction to transaction start
5. Sign and send

**Token Program Detection**:

- Automatically detect SPL Token vs Token-2022
- Check both ATA addresses to determine correct program

### QR Scanner

Implementation in `src/QRScanner.tsx`:

**Library**: `react-native-camera-kit` (no NDK required)

**Features**:

- Full-screen camera preview
- Auto request camera permissions (Android)
- Supports multiple Solana address formats:
  - Pure address: `7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU`
  - Solana URI: `solana:ADDRESS`
  - Solana Pay: `solana:ADDRESS?amount=1.5` (extracts address only)
- Address validation after scan
- Scan debouncing to prevent duplicates

**Android Configuration**:

- Add `kotlinVersion = "1.9.0"` in `android/build.gradle`
- Camera permission already in `AndroidManifest.xml`

**Integration**:

```typescript
import QRScanner from './src/QRScanner';

<QRScanner
  visible={showQRScanner}
  onClose={() => setShowQRScanner(false)}
  onScanSuccess={address => {
    setSendRecipient(address);
    setShowQRScanner(false);
  }}
/>;
```

## Environment Constraints

**Build Environment**:

- ❌ No NDK support - avoid libraries requiring NDK
- ✅ Kotlin 1.9.0 available
- ✅ Gradle 8.1.0
- ✅ Android SDK 34

**Testing**:

- Direct device deployment (no Metro)
- Device: SM02G40619145272
- APK includes bundled JS

## Technical Details

For detailed implementation notes, architecture decisions, and session logs, see:

- `sessions/` - Development session logs with technical details
- Code comments in implementation files
- Test files in `__tests__/`
