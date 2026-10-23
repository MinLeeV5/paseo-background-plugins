# v0.1.4：Paseo v0.12.0 兼容验收

2026-10-23，使用官方 [Paseo v0.12.0 发布包](https://github.com/getpaseo/paseo/releases/tag/v0.12.0)中的 macOS arm64 桌面应用、导出的 Web UI 及内置 CLI / daemon。CLI 与应用版本均核对为 `0.12.0`。

## 修正

- 兼容范围改为 `>=0.12.0 <0.14.0`，避免在加载插件前拒绝稳定版宿主。
- `Icon` 和 `TextInput` 改从 v0.12.0 已提供的 `@getpaseo/plugin/client/react-native` 导入；新版宿主保留这一入口的兼容别名。
- README 及中英文简介移除 beta 版本要求，安装与更新命令改为 v0.1.4。

## 结果

- v0.12.0 SDK 类型检查、当前开发 SDK 类型检查和 20 项回归检查通过。
- **Web 18 组流程**通过：[结果](web-results.json)。
- **原版 macOS 桌面 11 组流程**通过：[结果](desktop-results.json)。
- 覆盖设置入口、预览与保存、工作区切换及逐帧检查、左右侧栏、输入框周围、刷新恢复、深浅主题、双客户端同步、并发冲突，以及停用后的清理。

所有流程使用独立用户目录、daemon 和测试工作区，不发送模型请求；结束后关闭测试实例。日常应用、主机配置及背景参数不参与测试。Windows / Linux 未实测。

复现时，将 `PASEO_CLI` 指向待测版本的 CLI，`PASEO_APP_DIST` 或 `PASEO_DESKTOP_EXECUTABLE` 指向同版本发布包，并用 `PASEO_VERIFICATION_VERSION` 指定结果记录中的版本：

```sh
PASEO_CLI=/path/to/v0.12.0/Resources/bin/paseo \
PASEO_APP_DIST=/path/to/v0.12.0/Resources/app-dist \
PASEO_VERIFICATION_VERSION=0.12.0 \
PASEO_VERIFICATION_DIR=.local/compatibility-0.12.0 \
npm run test:e2e

PASEO_CLI=/path/to/v0.12.0/Resources/bin/paseo \
PASEO_DESKTOP_EXECUTABLE=/path/to/v0.12.0/MacOS/Paseo \
PASEO_VERIFICATION_VERSION=0.12.0 \
PASEO_VERIFICATION_DIR=.local/compatibility-0.12.0 \
npm run test:desktop
```
