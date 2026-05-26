# Image Tools (Tauri)

一个基于 Tauri v2 + 原生 HTML/CSS/JS 的桌面图片处理工具，是 [image_tools](https://github.com/xyz2357/image_tools)（Python 版本）的重写。

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

免安装、单文件 exe，双击即可运行（Windows x64）：

- **正式版**：从 [Releases](https://github.com/xyz2357/image-tools-tauri/releases) 下载 `ImageTools.exe`（打 tag `v*` 时由 CI 发布）。
- **最新开发版**：在 [Actions](https://github.com/xyz2357/image-tools-tauri/actions) 里选一次 `build` 运行，下载底部 `ImageTools-windows-x64` artifact（需要登录 GitHub）。

## 开发

需要 [Node.js](https://nodejs.org/) 和 [Rust](https://www.rust-lang.org/)。

```bash
npm install
npm run tauri dev      # 开发模式
npm run tauri build    # 打包发布
npm test               # 跑前端单元测试 (vitest)
```

## 技术栈

- [Tauri 2](https://tauri.app/) — Rust 后端 + WebView 前端
- 前端：原生 HTML / CSS / JS（无框架）
- 测试：[Vitest](https://vitest.dev/) + jsdom

## License

MIT
