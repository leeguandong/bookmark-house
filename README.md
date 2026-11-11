# 书签小屋

Chrome Manifest V3 扩展，用于网页卡片收藏与原生书签管理。当前版本为 2.4.7，采用 MIT 许可证开源。

[公开隐私政策](https://leeguandong.github.io/bookmark-house-privacy/) · [源码审核记录](docs/source-audit.md) · [许可证](LICENSE)

## 功能

- 工具栏、右键、快捷键、粘贴或拖拽保存网页，按日期显示卡片、摘要和预览。
- 搜索、星标、备注、阅读状态、文件夹整理及内容分析。
- 管理 Chrome 的真实书签；网页收藏与书签各自保存、删除和恢复。
- 本地回收站、撤销与导入导出。权限和数据行为见 [隐私政策](privacy.html)。

## 本地加载

打开 `chrome://extensions`，启用开发者模式，选择“加载已解压的扩展程序”，选中此仓库根目录。工具栏图标用于保存当前网页；扩展选项页打开收藏管理界面。`Alt+Shift+S` 可保存当前网页，macOS 默认使用 `Command+Shift+S`。

不要删除原本地安装的数据。商店安装版与本地加载版可能具有不同扩展 ID，更换前先导出网页收藏 JSON，并在新安装中核对导入结果。

## 开发与检查

开发依赖：Node.js 24、npm、Python 3.10+、Git。扩展运行不依赖开发用的 npm 模块。

```text
npm ci --ignore-scripts
npm test
python tools/scan_secrets.py
npm run audit:secrets
git config core.hooksPath .githooks
```

测试使用合成数据和模拟 DOM/IndexedDB，不读取真实 Chrome 书签或浏览器资料。需要历史诊断截图或真实页面抓取内容的临时测试不收入仓库。密钥检查使用本地规则及 Secretlint 推荐规则；提交前检查扫描 Git 暂存区的实际内容，报告不打印命中值。

```text
python tools/package_extension.py --source . --output ../artifacts/bookmark-house-2.4.7.zip --exclude index.html
```

打包器排除开发文件、检查声明资源及 ZIP 根目录，并生成文件与哈希报告。正式提交前仍需检查实际界面、动态依赖和商店要求。详细版本记录见 [README.txt](README.txt)。

## 仓库范围

仓库只保存扩展源码、图标、文档、合成数据测试和开发检查脚本。个人收藏、备份、浏览器数据库、发布后台截图、密钥、令牌和依赖安装目录不属于源码，不应提交。

源码与既有隐私政策共用 `bookmark-house-privacy` 仓库。根目录 `index.html` 是商店使用的独立政策页面；修改源码时请保留此页面与现有政策网址。扩展实际入口为 `manifest.json` 中声明的弹窗和管理页面。

## 开源与数据

项目代码与随附图标按 [MIT 许可证](LICENSE) 提供。开发依赖通过 npm 单独安装，保留各自许可证，不打入扩展运行包。本项目不需要配置开发者 API key，也未集成远程 AI 服务。请勿把真实收藏、账号凭据或完整网页快照作为问题附件提交；可用合成链接与脱敏样例复现问题。
