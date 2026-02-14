# MemoWallet Agent

React Native wallet application development.

## Project Structure

- `App.tsx` - Main app entry
- `index.js` - React Native entry
- `ios/` - iOS native code
- `android/` - Android native code
- `sessions/` - Session memory storage

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

## Development Commands

- `npm start` - Start Metro bundler
- `npm run ios` - Run iOS
- `npm run android` - Run Android
- `npm run lint` - Lint code
- `npm test` - Run tests

## Build APK

Debug APK 默认已包含 JS bundle，可独立运行（无需 Metro）:

```bash
cd android && ./gradlew assembleDebug
```

APK 位置: `android/app/build/outputs/apk/debug/app-debug.apk`

安装到设备:

```bash
adb install android/app/build/outputs/apk/debug/app-debug.apk
```

配置说明: 在 `android/app/build.gradle` 中设置 `debuggableVariants = []` 使 debug build 也打包 JS。
