# Long-term Memory

Persistent storage of important information, auto-loaded in every session.

## User Preferences

- 主题色: #38B6FF (蓝色)
- 包名: rip.memo.wallet

## Project Context

- MemoWallet: React Native wallet application (X1 & Solana)
- Session memory system implemented using OpenCode Skill approach
- 使用 Seed Vault 进行 Android 钱包连接
- Debug APK 默认打包 JS bundle

## Technical Stack

- react-native-vector-icons + fontawesome 图标库
- 底部导航: Portfolio (briefcase) + Swap (exchange)

## RPC 端点

- X1 主网 RPC: https://rpc.mainnet.x1.xyz
- Solana 主网 (用于 SOL 余额): https://api.mainnet-beta.solana.com

## xDEX 合约信息

- xDEX Program ID: sEsYH97wqmfnkzHedjNcw3zyJdPvUmsa9AixhS4b4fN
- USDC.MINT: B69chRzqzDCmdB5WYB8NRu5Yv5ZA95ABiZcdzCgGm9Tq
- WRAPPED_XNT_MINT: So11111111111111111111111111111111111111112
- NATIVE_XNT_MINT: So11111111111111111111111111111111111111111

## 代币余额查询

- 使用 xDEX API: `fetchXDEXWalletTokens(wallet, 'X1 Mainnet' | 'Solana Mainnet')`
- 过滤 LP 代币: `is_lp_token === true`
- 原生代币 mint: `111111111111111111111111111111111111111111`

## 文件结构

```
src/
├── rpc.ts        # 共享 RPC 工具和常量
├── portfolio.ts  # Portfolio 资产查询逻辑
├── swap.ts       # Swap 相关逻辑
```

## 代币发现逻辑

- 使用 xDEX API 一次性获取钱包所有代币信息
- 分别调用 X1 Mainnet 和 Solana Mainnet 网络
- 过滤 `is_lp_token === true` 的 LP 代币
- 图标从 API 返回的 imageUrl 获取

## Recent Changes (2026-02-16)

- 添加授权状态检测，未授权显示 "Connect Seed Vault"，已授权显示 "Enter Seed Vault"
- 简化底部导航为 Portfolio + Swap 两个菜单
- 所有图标统一使用 FontAwesome
- 实现 Swap 页面功能 (XNT/USDC.X)
- Portfolio 中间 Swap 按钮可进入 Swap 页面
- Portfolio 右上角 Settings 按钮进入 Settings 页面
- Swap 和 Settings 页面添加返回按钮

### 2026-02-16 后续更新

- 添加代币元数据查询功能 (getTokenMetadata)
  - 支持 Token 2022 的 metadata 扩展
  - USDC.X 图标从链上获取
  - XNT 使用本地图标 (https://app.xdex.xyz/assets/images/tokens/x1.webp)
- 使用 xDEX 官方 API 获取池信息 (https://api.xdex.xyz/api/xendex/pool/tokens/{token1}/{token2})
- Swap 页面 UI 优化：
  - From 区域添加 25%/50%/75%/100% 快捷按钮
  - From 数值亮色、To 数值灰色（区分输入/输出）
  - 添加 Slippage 下拉选项 (0.5%, 1%, 2%, 5%, Custom)
  - 优化纵向间距，节省屏幕空间
- 修复键盘遮挡问题：使用 ScrollView 包裹 Swap 内容

## Pending Tasks

- 实现 Swap 交易签名功能 (需要 Seed Vault 签名集成)

---

## Recent Changes (2026-02-17)

### xDEX API 集成：简化代币查询

- 使用 xDEX API 替代原有 6 次 RPC 调用
- API: `https://api.xdex.xyz/api/xendex/wallet/tokens?wallet_address={addr}&network=X1%20Mainnet`
- 只需 2 次 HTTP 调用即可获取 X1 + Solana 两条链的所有代币
- 过滤 LP 代币: `is_lp_token === true`
- 原生代币 mint: `111111111111111111111111111111111111111111`
- 移除 Jupiter USD 价格查询，简化为只显示代币数量

### 代码变更

- `src/rpc.ts`: 新增 `fetchXDEXWalletTokens()`, `XDEXToken`, `XDENetwork` 类型
- `src/portfolio.ts`: 完全重构，使用 xDEX API
- `PortfolioToken` 接口简化: 移除 `usdPrice`, `usdValue`

### 重要规则

- App.tsx 仅负责 UI 和状态管理，业务逻辑放在 src/ 模块
- 优先使用 xDEX API 进行代币发现
