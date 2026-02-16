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

## Recent Changes (2026-02-16)

- 添加授权状态检测，未授权显示 "Connect Seed Vault"，已授权显示 "Enter Seed Vault"
- 简化底部导航为 Portfolio + Swap 两个菜单
- 所有图标统一使用 FontAwesome

## Pending Tasks

- [ ] 实现 Swap 页面功能
