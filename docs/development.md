# 开发指南

## 环境与命令

使用 Node.js 24、npm、Python 3.10+ 和 Git。在仓库根目录运行：

```bash
npm ci --ignore-scripts
npm run prepare:hooks
npm run check
```

扩展没有构建步骤。浏览器加载 `extension/`；开发依赖只用于测试和检查，不随扩展分发。

| 命令 | 范围 |
| --- | --- |
| `npm run check:extension` | 清单、模块引用、页面资源和 npm 版本一致性 |
| `npm run test:extension` | 模拟 DOM、IndexedDB 和 Chrome API 的行为测试 |
| `npm run test:package` | 打包边界、缺失资源、许可证和归档结构 |
| `npm test` | 扩展与打包测试 |
| `npm run audit:secrets` | 两套本地规则检查已跟踪文件 |
| `npm run audit:staged` | 两套本地规则检查 Git 暂存内容 |
| `npm run check` | 资源检查、测试和敏感信息扫描 |
| `npm run package` | 生成 `dist/bookmark-house-2.5.0.zip` 与报告 |

Windows 若只提供 `py` 命令，可直接使用 `py -3` 执行 `scripts/` 下相应 Python 脚本，或将 Python 安装目录加入 PATH。

## 目录边界

`extension/` 是浏览器运行目录，保留其模块和页面间的相对引用。`tests/` 从此目录导入源码。`scripts/` 中的检查以仓库根目录为扫描范围，打包器只从 `extension/` 读取运行文件，并附入根目录的 MIT 许可证。

`docs/` 保存使用与维护说明。公开隐私政策的兼容地址由独立的 `bookmark-house-privacy` 仓库托管，不依赖源码仓库的文件布局。

## 验证修改

自动测试覆盖数据读写与并发、独立来源删除、回收与恢复、卡片渲染、缓存、启动顺序、弹窗入口、侧栏与拖拽相关行为。测试不访问真实浏览器资料；它们不能替代 Chrome 的真实权限弹窗和站点兼容验证。

涉及界面或 Chrome API 的改动，应在独立测试资料中加载扩展并检查实际流程。使用合成内容制作截图，避免读取或提交私人收藏。性能验证区分“Chrome 创建弹窗前等待”“弹窗首屏”和“内容提取”，不要混用计时结果。

## 打包与发布

```bash
npm run package
```

ZIP 根目录包含 `manifest.json`，不包含 `extension/` 外层目录、测试、开发依赖或工作区备份。生成的报告记录版本、文件和 SHA-256；同路径已有不同内容时默认拒绝覆盖。

目录整理本身不递增扩展版本。对商店发布运行行为的修改，应同步清单、npm 元数据、版本记录与实际分发文件。仓库自动检查不自动向 Chrome 商店发布。

## 安全检查

提交前钩子仅在运行 `npm run prepare:hooks` 的本地仓库生效。GitHub 的自动检查在推送与 PR 时执行。上传前仍需核对暂存差异及提交历史，真实数据与凭据不得作为测试样例。

详见 [SECURITY.md](../SECURITY.md)、[贡献指南](../CONTRIBUTING.md)和[首次源码审核记录](source-audit.md)。
