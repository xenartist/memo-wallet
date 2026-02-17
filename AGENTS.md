# MemoWallet Agent

React Native wallet application development.

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

## Code Organization Principles

### File Responsibilities

- `src/rpc.ts`: All blockchain-shared utilities (RPC calls, encoding/decoding, constants)
- `src/portfolio.ts`: Portfolio/asset-related logic (token discovery, balance queries)
- `src/swap.ts`: Swap/trading-related logic (pool queries, price calculation, trade instructions)
- `App.tsx`: Only contains UI rendering and state management, calls functions from modules

### Multi-Chain Support

All RPC utility functions should support an optional `rpcUrl` parameter to work with different chains:

- X1 RPC: `https://rpc.mainnet.x1.xyz`
- Solana RPC: `https://api.mainnet-beta.solana.com`

### Token Discovery

使用 xDEX API 一次性获取钱包所有代币信息：

```typescript
// src/rpc.ts
import {fetchXDEXWalletTokens} from './rpc';

const tokens = await fetchXDEXWalletTokens(walletAddress, 'X1 Mainnet');
const solTokens = await fetchXDEXWalletTokens(walletAddress, 'Solana Mainnet');

// 过滤 LP 代币
const splTokens = tokens.filter(t => !t.is_lp_token);
```

API 端点: `https://api.xdex.xyz/api/xendex/wallet/tokens?wallet_address={addr}&network=X1%20Mainnet`

返回字段: mint, amount, decimals, ui_amount, symbol, name, imageUrl, is_lp_token

## Development Workflow

**重要**: 本项目直接在 Android 真机上调试，不使用 Metro bundler 或 npm start/ios/android。

所有开发调试流程：

1. 修改代码
2. 运行 `npm run lint` 确保代码无错误
3. 编译 APK 并推送到手机
4. 在手机上查看效果

**自动化**: 每次代码修改调整后，都必须自动编译打包并推送到手机上进行测试。

## Development Commands

```bash
# Lint code
npm run lint

# Run all tests (Jest 单元测试，非真机测试)
npm test

# Run a single test file
npm test -- App.test.tsx

# Run a single test (by name)
npm test -- -t "renders correctly"

# Run tests in watch mode
npm test -- --watch
```

## Build APK

Debug APK 默认已包含 JS bundle，可独立运行（无需 Metro）:

```bash
cd android && ./gradlew assembleDebug
```

APK 位置: `android/app/build/outputs/apk/debug/app-debug.apk`

安装到设备:

```bash
# 设备: SM02G40619145272
adb -s SM02G40619145272 install android/app/build/outputs/apk/debug/app-debug.apk
```

配置说明: 在 `android/app/build.gradle` 中设置 `debuggableVariants = []` 使 debug build 也打包 JS。

## Code Style Guidelines

### General Rules

- Follow React Native conventions as defined by `@react-native/eslint-config`
- Use TypeScript for all new code (project uses TypeScript 4.8.4)
- Use functional components with hooks instead of class components

### Imports

Organize imports in the following order (separate with blank lines):

1. React core (`import React, { useState } from 'react'`)
2. React Native modules (`import { View, Text } from 'react-native'`)
3. Third-party libraries (`import { SeedVault } from '@solana-mobile/seed-vault-lib'`)
4. Local assets (`import logo from './assets/logo.png'`)

```typescript
import React, {useState, useEffect} from 'react';
import {
  SafeAreaView,
  StyleSheet,
  Text,
  TouchableOpacity,
  Alert,
} from 'react-native';
import {SeedVault} from '@solana-mobile/seed-vault-lib';

import MyComponent from './components/MyComponent';
import {colors} from './theme';
```

### Naming Conventions

- **Components**: PascalCase (e.g., `WalletScreen`, `TokenItem`)
- **Functions**: camelCase (e.g., `fetchBalances`, `connectSeedVault`)
- **Variables**: camelCase (e.g., `publicKey`, `isLoading`)
- **Constants**: UPPER_SNAKE_CASE for runtime constants, camelCase for config objects
- **Interfaces/Types**: PascalCase with descriptive names (e.g., `TokenInfo`, `WalletState`)
- **Files**: kebab-case for utilities, PascalCase for components (e.g., `utils.ts`, `WalletScreen.tsx`)

### TypeScript

- Always define return types for functions, especially async functions
- Use interfaces for object shapes, avoid `any` type
- Use `null` instead of `undefined` for nullable values
- Prefer explicit type annotations over type inference for function parameters

```typescript
// Good
interface TokenInfo {
  symbol: string;
  name: string;
  balance: string;
  icon?: number;
}

const fetchBalances = async (pk: string): Promise<void> => {
  // ...
};

// Avoid
const fetchBalances = async pk => {
  // ...
};
```

### Error Handling

- Always wrap async operations in try/catch blocks
- Use `instanceof Error` checks before accessing error message
- Display user-friendly error messages via Alert or toast
- Log errors to console for debugging

```typescript
// Good pattern
try {
  const result = await someAsyncOperation();
  // handle result
} catch (error) {
  const errorMessage = error instanceof Error ? error.message : String(error);
  console.error('Operation failed:', error);
  Alert.alert('Error', `Failed to complete operation: ${errorMessage}`);
}
```

### Component Patterns

- Use functional components with hooks
- Keep components focused (single responsibility)
- Extract reusable logic into custom hooks
- Define styles using StyleSheet.create at component bottom

```typescript
interface Props {
  title: string;
  onPress: () => void;
}

function MyComponent({ title, onPress }: Props): JSX.Element {
  const [isLoading, setIsLoading] = useState(false);

  const handlePress = () => {
    setIsLoading(true);
    onPress();
  };

  return (
    <TouchableOpacity onPress={handlePress}>
      <Text>{title}</Text>
    </TouchableOverflow>
  );
}

const styles = StyleSheet.create({
  // styles here
});

export default MyComponent;
```

### Styling

- Use StyleSheet.create for all styles (enables optimization)
- Define colors and constants outside components for reuse
- Use flexbox for layout (flex, flexDirection, justifyContent, alignItems)
- Use Platform.select for platform-specific styles when needed

```typescript
import {Platform, StyleSheet} from 'react-native';

const styles = StyleSheet.create({
  text: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
});
```

### Platform-Specific Code

- Use `Platform.OS` for OS checks (`'ios'` or `'android'`)
- Use `Platform.select()` for platform-specific values
- Use `PermissionsAndroid` for Android permissions

### Testing

- Place tests in `__tests__/` directory with `.test.tsx` or `.test.ts` extension
- Use `@jest/globals` for test imports
- Use `react-test-renderer` for snapshot testing

```typescript
import 'react-native';
import React from 'react';
import renderer from 'react-test-renderer';
import {it} from '@jest/globals';

import MyComponent from '../MyComponent';

it('renders correctly', () => {
  renderer.create(<MyComponent />);
});
```

## Skills

### Session Memory

Manages conversation history summarization and loading. See `sessions/SKILL.md` for details.

Usage:

- `/save` - Save current session summary
- `/load [date]` - Load historical session
- Auto-prompt to save when session ends

### Session Startup Flow

1. Check for unsaved draft (`sessions/draft.md`)
2. If exists, ask user to restore
3. Load `sessions/MEMORY.md` and recent session summaries
4. Inject historical context into prompt

## xDEX Integration

### RPC Endpoints

- X1 Mainnet: `https://rpc.mainnet.x1.xyz`
- Solana Mainnet (for SOL balance): `https://api.mainnet-beta.solana.com`

### Important Addresses

- xDEX Program ID: `sEsYH97wqmfnkzHedjNcw3zyJdPvUmsa9AixhS4b4fN`
- USDC.MINT: `B69chRzqzDCmdB5WYB8NRu5Yv5ZA95ABiZcdzCgGm9Tq`
- WRAPPED_XNT_MINT: `So11111111111111111111111111111111111111112`
- NATIVE_XNT_MINT: `So11111111111111111111111111111111111111111`
- TOKEN_PROGRAM: `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA`
- TOKEN_2022_PROGRAM: `TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb`
- ASSOCIATED_TOKEN_PROGRAM: `ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL`

### Token Balance Query

使用 xDEX API 查询代币余额：

- X1: `fetchXDEXWalletTokens(wallet, 'X1 Mainnet')`
- Solana: `fetchXDEXWalletTokens(wallet, 'Solana Mainnet')`

原生代币识别: mint 为 `111111111111111111111111111111111111111111`
