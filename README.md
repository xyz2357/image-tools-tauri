# Image Tools (Tauri)

一个基于 Tauri v2 + 原生 HTML/CSS/JS 的桌面图片处理工具，是 [image_tools](https://github.com/xyz2357/image_tools)（Python 版本）的重写。

## 效果示例

### 图片

| 原图 | 马赛克 | 文字图层 |
|---|---|---|
| <img src="docs/samples/img-original.jpg" width="220" /> | <img src="docs/samples/img-mosaic.jpg" width="220" /> | <img src="docs/samples/img-text.jpg" width="220" /> |

| 方向性模糊 | 相机叠加 |
|---|---|
| <img src="docs/samples/img-blur.jpg" width="220" /> | <img src="docs/samples/img-camera.jpg" width="220" /> |

图片效果都是真机器输出（`scripts/gen-samples.mjs` 通过 Playwright 驱动应用本身生成，然后 ffmpeg 压成小 JPG）。

### 视频

<table>
  <tr>
    <th>原视频</th>
    <th>马赛克</th>
    <th>模糊</th>
  </tr>
  <tr>
    <td><video src="docs/samples/vid-original.mp4" controls autoplay loop muted width="220"></video></td>
    <td><video src="docs/samples/vid-mosaic.mp4" controls autoplay loop muted width="220"></video></td>
    <td><video src="docs/samples/vid-blur.mp4" controls autoplay loop muted width="220"></video></td>
  </tr>
</table>

视频示例由 ffmpeg 近似生成（应用本身可对选定区域 + 任意子帧范围应用同样的效果）。

## 功能

### 图片工具
- **打开 / 保存**：支持 PNG、JPEG、WebP、BMP
- **马赛克**：可调马赛克块大小，框选区域应用
- **文字图层**：自定义字体 / 颜色 / 大小 / 角度，支持竖排、自适应选区大小，图层可编辑
- **模糊**：可调强度与角度的方向性模糊
- **相机效果**：在画面上叠加电量、时间戳等取景器风格信息
- **选区**：矩形 / 自由套索（Tab 切换）
- **撤销 / 重做**：Ctrl+Z / Ctrl+Shift+Z

### 格式转换
- 输入：图片序列、视频、GIF/WebP/APNG
- 输出：GIF、MP4、WebP、APNG
- 预设压缩档位（极致压缩 / 平衡 / 高质量 / 最小体积 / 原始 / 自定义）
- 可调帧率、帧范围、缩放、调色板大小、抖动模式、差异调色板
- 转换时叠加马赛克 / 相机效果（支持逐帧或全部帧）
- 导出前可估算输出大小

### 快捷键
- `Ctrl+O` 打开 / `Ctrl+S` 保存
- `Ctrl+Z` 撤销 / `Ctrl+Shift+Z` 重做
- `Ctrl+M` 应用马赛克 / `Ctrl+B` 应用模糊
- `Tab` 切换选区模式

## 下载

免安装、单文件 exe，解压后双击即可运行（Windows x64）：

- **正式版**：从 [Releases](https://github.com/xyz2357/image-tools-tauri/releases) 下载 `ImageTools-windows-x64.zip`（打 tag `v*` 时由 CI 发布）。
- **最新开发版**：在 [Actions](https://github.com/xyz2357/image-tools-tauri/actions) 里选一次 `build` 运行，下载底部 `ImageTools-windows-x64` artifact（需要登录 GitHub）。

> ⚠️ 首次运行时，Windows SmartScreen 可能会弹出"已保护你的电脑"提示——这是因为 exe 没有代码签名证书。点击"更多信息" → "仍要运行"即可。如果对此有顾虑，可以自行从源码构建（见下方"开发"小节）。

## 开发

需要 [Node.js](https://nodejs.org/) 和 [Rust](https://www.rust-lang.org/)。

```bash
npm install
npm run tauri dev      # 开发模式
npm run tauri build    # 打包发布
npm test               # 跑前端单元测试 (vitest)
```

### E2E 测试（可选）

走 **Playwright via CDP**：WebView2 通过 `--remote-debugging-port=9222` 启动调试端口，Playwright 用 `chromium.connectOverCDP` 直接接上，绕过 tauri-driver。比官方推荐的 WebdriverIO 路线稳得多。

```bash
npm run e2e          # 自动 cargo build --release + 启动 app + 跑 e2e/specs/*.e2e.js
```

测试文件在 `e2e/specs/`，当前只有一个 smoke test（窗口能起 + tab 切换 + ugoira 格式可选）。

注意：因为 webview 开了 CDP 端口，发布版本里如果不想保留这个调试通道，可以把 `additionalBrowserArgs` 从 `tauri.conf.json` 移到一个 conditional 配置里。

## 技术栈

- [Tauri 2](https://tauri.app/) — Rust 后端 + WebView 前端
- 前端：原生 HTML / CSS / JS（无框架）
- 测试：[Vitest](https://vitest.dev/) + jsdom

## License

MIT
