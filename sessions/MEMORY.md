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

- 原生 XNT: 使用 getBalance RPC
- SPL Token (USDC.X, WXNT): 使用 getTokenAccountsByOwner

## 文件结构

```
src/
├── rpc.ts        # 共享 RPC 工具和常量
├── portfolio.ts  # Portfolio 资产查询逻辑
├── swap.ts       # Swap 相关逻辑
```

## 代币发现逻辑

- 使用 getTokenAccountsByOwner 查询钱包所有 SPL 代币
- 需要分别查询 TOKEN_PROGRAM 和 TOKEN_2022_PROGRAM 两个 programId
- 需要分别在 X1 和 Solana 两条链上查询
- 图标获取: 链上 metadata -> 本地图片 -> 首字母占位符

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

### 代码重构：按功能拆分文件

- `src/rpc.ts` (新建): RPC 端点、常量、编码工具、getTokenMetadata
- `src/portfolio.ts` (新建): fetchAllTokens() 并行查询 X1+Solana 6 个 RPC，自动发现钱包所有 SPL 代币
- `src/swap.ts` (重构自 xdex.ts): 保留 swap 相关逻辑

### Portfolio 资产显示扩展

- 支持显示钱包在 X1 和 Solana 两条链上持有的所有 SPL 代币
- 代币图标: 链上 metadata URI -> 本地图片 -> 首字母占位符
- 排序: 原生代币 (XNT, SOL) 优先，SPL 代币按余额降序

### 重要规则

- App.tsx 仅负责 UI 和状态管理，业务逻辑放在 src/ 模块
- 所有 RPC 函数支持 rpcUrl 参数实现多链
