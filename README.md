# Antigravity 自定义背景图片插件 (`bg-wallpaper`)

**零侵入、不修改 `app.asar`、无需管理员权限** 的 Antigravity 2.0 自定义背景壁纸与毛玻璃特效插件。让自定义图片无缝透出**左侧边栏、中间对话区以及右侧所有扩展面板**。

## ✨ 核心功能

1. **多种壁纸来源**：
   - **拖拽 / 点击上传本地图片**（支持 PNG / JPG / WEBP / GIF / AVIF，最大 20MB，自动持久化保存在侧边栏数据目录）；
   - **填写本地绝对路径**直接引用；
   - **4 套内置流光预设壁纸**（极光紫蓝、落日余晖、静谧星云、深海森光）。
2. **实时滑块热调节（无需重启）**：
   - **壁纸可见度（Opacity）**：5% – 100%
   - **背景模糊度（Blur）**：0 – 30 px
   - **界面底色浓度（Surface Opacity）**：平衡壁纸通透感与文字阅读清晰度
   - **填充模式**：铺满裁剪（Cover）/ 完整居中（Contain）
3. **深/浅主题自适应**：自动监听宿主深色/浅色主题切换并重新采样原始配色变量，弹窗/下拉菜单自动保留高浓度磨砂玻璃以确保清晰可读。

---

## ⚙️ 实现原理

本插件同样基于 Antigravity 官方 Sidecar + 原生 `DevToolsActivePort`（CDP）直连，解决了 Electron 背景透明化的三大经典难题：

1. **绕过 CSP 与 `file://` 限制**：
   - 后端在 Node.js 中读取本地图片并编码为 `data:image/...;base64,...`，在主窗口插入固定底层的 `#agy-bg-wallpaper-layer` 与单层柔光遮罩 `#agy-bg-wallpaper-scrim`。
2. **消除多层半透明叠加发黑**：
   - 剥离最外层全屏容器 `#root > div` 的重复底色，并通过 `.bg-sidebar .bg-sidebar { background-color: transparent !important; }` 消除左侧栏 20 余层嵌套项目标题的暗色块叠加，使左、中、右三栏通透度完全一致。
3. **解决右侧插件 `iframe` 灰白底色 Bug**：
   - 按 Chromium 规范，若父页面为 `color-scheme: dark` 而子 `iframe` 为 `normal`，浏览器会强制在 `iframe` 后绘制不透明白底。本插件会自动探测主窗口的 `color-scheme`，同步向所有 `plugin://` 侧边栏 `iframe` 注入匹配的 `color-scheme` 与透明毛玻璃样式，使右侧所有扩展面板同样完美透出壁纸。

---

## 🚀 安装方法

### 方式一：一键脚本（推荐）
在仓库根目录执行：
- Linux / macOS：`./install.sh bg-wallpaper`
- Windows：`.\install.ps1 bg-wallpaper`

### 方式二：手动复制
将整个 `bg-wallpaper` 文件夹复制到：
- **Linux / macOS**：`~/.gemini/config/plugins/bg-wallpaper`
- **Windows**：`%USERPROFILE%\.gemini\config\plugins\bg-wallpaper`

安装后**重启一次 Antigravity** 即可生效。打开右上角 **⋮** → **Extensions** → **背景图片设置** 上传你的壁纸并调节参数；禁用或卸载插件时会自动清理所有注入样式，100% 还原原生界面。
