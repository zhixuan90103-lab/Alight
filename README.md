# portrait-webgpu-base

**最稳健竖屏底座**：合并 **niantu** 的适配/TS/设备预览 + **three-webgpu-cap-shell** 的 Capacitor 打包、安全区、bootstrap、可验证 demo。

| 文档 | 用途 |
|------|------|
| [AGENTS.md](./AGENTS.md) | AI / 新窗口第一入口 |
| [docs/ENGINEERING.md](./docs/ENGINEERING.md) | 设计决策与踩坑 |
| [docs/ENTRYPOINTS.md](./docs/ENTRYPOINTS.md) | 入口与调用链 |
| [docs/MERGE.md](./docs/MERGE.md) | 双工程优点对照与合并说明 |
| [docs/AUDIO.md](./docs/AUDIO.md) | 音效方案（预解码 + 每帧一批 + 原生池） |
| [docs/HAPTICS.md](./docs/HAPTICS.md) | 震动如何一次接对（插件注册 + 玩法层） |
| [docs/GAME-RULES.md](./docs/GAME-RULES.md) | 规则。第 0 节是操作优先 |
| [docs/IMPLEMENTATION.md](./docs/IMPLEMENTATION.md) | 第一关怎么做：一根皮筋、一只 U、五颗球、数 |

## 30 秒上手

```bash
cd portrait-webgpu-base
npm install
npm run dev
# → http://127.0.0.1:5190/
```

应看到：桌面手机框、右边一根皮筋、左边一只金色 U、左上五颗球点、右上重玩和设置。桌面可切手机/Pad。桌面无原生马达，属正常。

## 合并了什么

| 来自 niantu | 来自 three-webgpu-cap-shell |
|-------------|----------------------------|
| TS strict | `base: './'` |
| 390×844 stage + contain | `contentInset: never` + scroll 关 |
| Phone / Pad 预览 | `--safe-*` HUD + debug |
| `clientToDesign` | `ios:bootstrap` 插件真源 |
| | 可验证 3D demo + 震动按钮 |
| AdvancedHaptics 宽 API | ENGINEERING / ENTRYPOINTS 文档结构 |
| Capacitor 8 + Three 0.178 + Vite 6 | |

## iOS 真机

```bash
npm run ios:bootstrap   # 首次
npm run cap:open
# Xcode: Team → 真机 → Run
```

日常只改网页：`npm run cap:sync`。改 Swift / 第一次：`ios:bootstrap`（会改 SceneDelegate，否则真机 `plugin: false`）。

当前包名是 `com.wangzhixuan.alight`。装到和别的工程同一台手机前，不要改回共用的模板包名。改了 Swift 插件之后，真机上拉开球应有持续震动。桌面没有马达。

## 复用到新游戏

1. 复制本目录  
2. 改 `capacitor.config.ts` 的 `appId` / `appName`  
3. 在 `src/main.ts` 或 `src/game/*` 写玩法  
4. **保留** adapt / create-renderer / haptics / plugins / `base: './'`  
