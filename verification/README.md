# 全局背景可行性验证

2026-10-22。目标版本：Paseo `0.13.0-beta.1`，对应源码提交 `3fa625701eae6b3a07ccae18299200b1a7cf2776`。

**历史原型结论：图片层与透明底色的渲染方案可行。** 这里保留的是实现前的检查；2026-10-23 已完成实际插件在原版桌面和 Web 客户端的安装验收，结果见 [INSTALLED.md](INSTALLED.md)。

范围在 2026-10-23 调整为仅桌面和 Web，不修改 Paseo 本体，当前方案见[设计文档](../DESIGN.md)。下列原生组件与手机源码检查保留为早期调研记录，不属于当前交付要求。

## 已验证的范围

| 对象 | 证据 | 结果与边界 |
| --- | --- | --- |
| Chromium 宽屏，1440 × 960 | 正式 UI 静态包、独立 daemon、真实测试工作区 | 11 项检查通过 |
| Chromium 紧凑网页，390 × 844 | 同一 UI 包的紧凑布局 | 9 项检查通过；属于手机尺寸网页，不是原生 App |
| Electron 渲染器，1440 × 960 | 独立窗口承载同一 UI 静态包 | 11 项检查通过；运行时为本机已有的 Electron 41.2.0，目标桌面源码依赖 44.2.0，未验收完整桌面窗口集成 |
| 跨平台图片组件 | 使用 React Native 0.86.3 的实际类型声明检查 | TypeScript 5.9.3 检查通过，无 DOM 依赖；不是原生运行证据 |
| iOS / Android | 共享根布局、原生导航与移动侧边栏源码审核 | 已找到接入位置；设备手势、安全区域、图片解码和性能仍待实测 |

测试工作区显示“新标签页”内容，没有运行 Agent、提交模型请求或打开终端。会话长列表、编辑器、终端、浅色主题、模糊效果和长时间性能不在本轮运行验证范围内。

使用桌面安装包 `app-dist` 中正式的 Web UI 文件，在独立浏览器上下文及独立 Electron 窗口中测试；没有单独构建浏览器发行包。没有安装插件，没有启用插件开关，没有重启日常 daemon，也没有修改用户原有 Paseo 源码工作区。独立测试 daemon 使用端口 `18942`，静态页面使用 `18941`。

## 结果

自动检查使用两张不同颜色的 PNG 图片切换，比较指定区域的真实截图像素，而非只检查 CSS 是否存在。

1. **只加图片，不改变底色**：工作区测试区域的图片切换像素变化比例为 0，确认图片被原有底色遮住。
2. **适配底色**：浏览器宽屏工作区约 82.9% 的采样区域像素改变，侧边栏采样区域为 100%；紧凑网页的空白边缘采样区域为 100%。控件保留不透明底色，因此不要求整个画面都随图片改变。
3. **图片不透明度为 0**：换图不再改变背景像素。
4. **区域底色不透明度为 1**：图片重新被遮住。这与图片自身不透明度独立。
5. **文字与交互**：标题文字颜色不变，祖先节点的 opacity 均为 1；图片不参与命中测试；实际点击“历史”及返回工作区成功。
6. **生命周期**：路由切换后图片节点仍存在；清理后图片节点消失，空白区域背景像素恢复原样。焦点框可能随导航改变，所以恢复比较不包含交互控件。
7. **应用异常**：检查过程中没有未捕获的页面异常。

完整机器可读结果：[浏览器 20 项检查](artifacts/results.json)、[Electron 11 项检查](artifacts/electron-results.json)、[原生组件类型检查](artifacts/native-typecheck.json)。

截图：

- [宽屏原始界面](artifacts/wide-original.png)
- [只加图片、仍被挡住](artifacts/wide-image-only-blocked.png)
- [宽屏背景效果](artifacts/wide-background.png)
- [紧凑网页背景效果](artifacts/compact-web-background.png)
- [Electron 背景效果](artifacts/electron-wide-background.png)
- [清理后恢复](artifacts/wide-restored.png)

## 需要适配的界面区域与相关源码

以下链接固定到本轮核对的发布提交，不随主分支更新。

| 位置 | 背景适配关注点 |
| --- | --- |
| [AppContainer / 根布局](https://github.com/getpaseo/paseo/blob/3fa625701eae6b3a07ccae18299200b1a7cf2776/packages/app/src/app/_layout.tsx#L584) | 定位应用根部图片层及其上方的表面容器 |
| [ThemedStack](https://github.com/getpaseo/paseo/blob/3fa625701eae6b3a07ccae18299200b1a7cf2776/packages/app/src/navigation/themed-stack.tsx#L41) | 导航 screen 与框架主题各有背景层，需要在运行时一起定位 |
| [WorkspaceScreen 表面](https://github.com/getpaseo/paseo/blob/3fa625701eae6b3a07ccae18299200b1a7cf2776/packages/app/src/screens/workspace/workspace-screen.tsx#L3799) | 区分布局容器的透明背景与工作区底色混合 |
| [SplitContainer 面板](https://github.com/getpaseo/paseo/blob/3fa625701eae6b3a07ccae18299200b1a7cf2776/packages/app/src/components/split-container.tsx#L847) | 为支持背景的面板调整底色，保留终端和编辑器自己的渲染边界 |
| [LeftSidebar](https://github.com/getpaseo/paseo/blob/3fa625701eae6b3a07ccae18299200b1a7cf2776/packages/app/src/components/left-sidebar.tsx#L560) | 桌面侧边栏有独立底色 |
| [插件公开契约](https://github.com/getpaseo/paseo/blob/3fa625701eae6b3a07ccae18299200b1a7cf2776/packages/plugin/src/client/contracts.ts#L155) 与 [运行时注册](https://github.com/getpaseo/paseo/blob/3fa625701eae6b3a07ccae18299200b1a7cf2776/packages/app/src/plugins/evaluate.ts#L210) | 没有正式全局背景贡献接口；桌面和 Web 采用浏览器专用运行时代码适配 |

这些源码用于理解渲染结构，当前路线不修改这些文件。生产插件使用限定范围的布局锚点和作用域样式。

[主题校验器](https://github.com/getpaseo/paseo/blob/3fa625701eae6b3a07ccae18299200b1a7cf2776/packages/app/src/plugins/themes/index.ts#L23) 接受 3、6、8 位十六进制颜色。8 位 alpha 可以表达透明底色，但不能注册背景图片，也不能自动清除导航的所有底色。

浏览器诊断在宽屏定位到 11 个、紧凑布局定位到 9 个需要适配的背景节点。这个数量是本次页面与挂载位置的观察结果，不是生产实现必须修改的固定视图数量。

## 原型与复查

- [browser-probe.js](browser-probe.js)：浏览器诊断。只沿指定采样点的祖先修改底色，并能恢复原有 style。**不是可发布插件**；生产插件需要版本与布局适配、限定的观察范围，以及不覆盖 React 动态样式的清理方式。
- [GlobalBackgroundLayer.tsx](GlobalBackgroundLayer.tsx)：使用 React Native `View` 和 `Image` 的宿主侧图片层样例。仅图片应用 opacity，容器不处理输入。Paseo 对应的 RN 0.86.3 已移除 `absoluteFillObject`，样例使用 `StyleSheet.absoluteFill`。
- [run.cjs](run.cjs)：运行截图像素对照、点击、导航和清理检查。
- [serve.cjs](serve.cjs)：只在本机监听的静态 UI 服务器，支持 SPA 深链接回退。
- [electron-main.cjs](electron-main.cjs)：使用临时用户目录的独立 Electron 窗口，不运行 Paseo 桌面主进程。
- [check-native-types.cjs](check-native-types.cjs)：将样例放在真实 RN 类型下检查，不冒充原生构建。

本次使用本机已有的 Playwright 1.58.2、pngjs 7.0.0 和 Electron 41.2.0；只下载解压了 RN 0.86.3 包来获取对应类型，没有为它运行安装脚本。

浏览器检查要求依赖目录中有 Playwright 和 pngjs；原生组件类型检查还要求 TypeScript 与 React 类型声明。

在一个已连接独立测试 daemon 的 Playwright 上下文中，通过 `context.storageState({ path: ... })` 保存连接状态。状态文件不纳入仓库。测试工作区标题使用 `Background verification`。然后运行：

```sh
# 启动独立静态页面，dist 指向 Paseo 导出的 UI 目录。
node verification/serve.cjs --dist /absolute/path/to/app-dist

# deps 是已安装 playwright 与 pngjs 的目录；本目录 npm install 后也可使用本目录。
node verification/run.cjs --deps /absolute/path/to/dependencies --state /absolute/path/to/test-state.json

# 独立 Electron 检查还要求 deps 中已安装 Electron。
node verification/run.cjs --electron --deps /absolute/path/to/dependencies --state /absolute/path/to/test-state.json

# react-native 指向解压后含 package.json 与 types/ 的 RN 包目录。
node verification/check-native-types.cjs --deps /absolute/path/to/dependencies --react-native /absolute/path/to/react-native
```

静态 UI 的来源需要加入**测试 daemon**的 `daemon.cors.allowedOrigins`，例如 `http://127.0.0.1:18941`。配置和停止测试实例时明确传入其独立的 `--home`，不要操作日常 daemon。运行记录中的独立实例已经在验证后停止。

## 下一步的边界

下一步在独立 daemon 上把背景注入封装成最小插件，直接安装进原版桌面和 Web 客户端，验证加载、调参、路由切换和停用恢复。再增加真实会话、主题切换、目标 Electron 桌面版本及布局变更的验收。本轮紧凑网页截图仅说明窄窗口渲染效果，不用于承诺原生移动端支持。
