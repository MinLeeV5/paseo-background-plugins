# 已安装插件的验收

2026-10-23（Asia/Shanghai），Paseo `0.13.0-beta.1`。

本文保留 v0.1.0 的首次安装验收。v0.1.1 修复了其遗漏的缓存工作区切换场景，新增证据见 [workspace-switch/README.md](workspace-switch/README.md)。

这份记录验收实际插件的安装和客户端行为。此前的[渲染原型](README.md)只验证了图片层方案，不能替代这里的插件加载证据。

## 环境

| 客户端 | 实际运行对象 | 结果 |
| --- | --- | --- |
| macOS 桌面 | 未修改的 `/Applications/Paseo.app`，真实主进程、preload、`paseo://app` 页面；Electron 44.2.0 / Chromium 152 | 6 组完整流程通过 |
| Web | 同版本官方桌面安装包导出的 `app-dist`，通过 HTTP 加载于 Playwright Chromium | 13 组完整流程通过 |
| 单元回归 | 配置、控制器、异步图片和 DOM 生命周期 | 15 项通过 |
| 类型检查 | SDK 0.13.0-beta.1、React 19.2.3、RN 0.86.3、TypeScript 5.9.3；客户端不启用 DOM lib | 通过 |

每次完整验证都创建独立 daemon、测试工作区和客户端用户目录，使用 CLI 安装生产入口。没有将诊断脚本注入客户端来替代插件，没有修改 Paseo 源文件或已安装的应用文件，没有重启日常 daemon，也没有发送模型请求。

## 已通过的行为

- 侧边栏入口与实际设置界面加载，首次安装默认关闭。
- 内置背景、图片与底色不透明度、模糊、亮度、缩放和位置即时预览、保存。
- 工作区和侧边栏的真实截图像素随换图变化，文字颜色和命中行为保持正常。
- 刷新页面后自动恢复保存值，无需先打开设置；桌面的关闭状态也可持久化。
- 离开设置或取消草稿时恢复保存值。
- Web 深浅主题切换重新计算区域底色；900px 窗口中设置可用。
- 非 HTTPS 输入显示错误；图片解码失败保留已加载图片；有效 HTTPS 图片可保存。图片测试通过请求拦截提供确定内容，不依赖第三方图片服务可用性。
- 两个独立浏览器上下文共享主机配置；旧 revision 保存被拒绝，重新读取后可继续保存。
- 图片强度为 0、背景开关关闭或停用插件时移除覆盖；重新启用和重载后只创建一层。
- 上述流程无未捕获页面异常。

Web 换图像素检查中，侧边栏约 **94.4%**、工作区采样区约 **96.6%** 的像素发生变化；采样区和阈值见 [scripts/e2e.mjs](../scripts/e2e.mjs)，精确结果随运行记录保存。

## 证据

- [Web 结果](installed/web-results.json)、[桌面结果](installed/desktop-results.json)
- [Web 设置](installed/web-settings.png)、[Web 工作区](installed/web-forest.png)、[浅色主题](installed/web-light.png)、[停用后](installed/web-disabled.png)
- [桌面设置](installed/desktop-settings.png)、[桌面工作区](installed/desktop-workspace.png)
- [Web 验证脚本](../scripts/e2e.mjs)、[桌面验证脚本](../scripts/desktop-e2e.mjs)

原版桌面进程通过其支持的独立 `PASEO_HOME`、`PASEO_ELECTRON_USER_DATA_DIR` 及临时 CDP 端口启动。桌面测试资料中的应用名改为测试名，避免和日常窗口混淆；应用代码与安装文件保持原样。测试关闭时只终止自己启动的进程。

## 边界

本轮完整流程使用空测试工作区，没有对长会话流式渲染、大图长期内存或终端 / 编辑器内部背景做性能验收。动态会话挂载和文字流更新的观察器行为另有回归检查。不能据此宣称所有 Paseo 页面与未来版本均兼容。

公开 Web 站点在本次检查时显示 v0.12.0，因此使用与桌面一致的 v0.13 UI 验证 Web，而未将旧站点计作插件通过。Windows / Linux 桌面及其他浏览器未实测，原生移动端不在支持范围。
