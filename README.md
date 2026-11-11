<p align="center">
  <img src="extension/icons/128.png" width="72" height="72" alt="书签小屋图标">
</p>

<h1 align="center">书签小屋 · Bookmark House</h1>
<p align="center">留住好内容，随时回来看看。</p>
<p align="center"><strong>简体中文</strong> · <a href="README.en.md">English</a></p>
<p align="center">
  <a href="https://github.com/leeguandong/bookmark-house/actions/workflows/ci.yml"><img src="https://github.com/leeguandong/bookmark-house/actions/workflows/ci.yml/badge.svg" alt="项目检查"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-326d58" alt="MIT License"></a>
  <img src="https://img.shields.io/badge/Chrome-109%2B-555b63" alt="Chrome 109+">
</p>
<p align="center">
  <a href="#快速开始">快速开始</a> · <a href="docs/getting-started.md">使用指南</a> · <a href="docs/development.md">开发指南</a> · <a href="CONTRIBUTING.md">参与贡献</a> · <a href="https://leeguandong.github.io/bookmark-house/privacy/">隐私政策</a>
</p>

书签小屋是一款开源 Chrome 扩展，把网页卡片收藏与浏览器书签管理放在同一个空间。看到值得保留的内容，可以随手保存；回来时，通过封面、摘句、备注和收藏日期找到它。

扩展无需注册账号，也无需配置 API key。收藏、缓存和回收站保存在当前浏览器的本地扩展空间，内容分析与摘要由本地规则完成。

## 能做什么

| 功能 | 使用方式 |
| --- | --- |
| 随手保存网页 | 工具栏、右键菜单、快捷键、粘贴分享内容，或拖入网址与网页链接 |
| 用卡片回顾内容 | 按收藏日期查看封面、正文摘句和备注，支持搜索、星标和阅读状态 |
| 管理书签库 | 浏览真实书签目录，拖动卡片归档，右键管理文件夹，修改同步作用于 Chrome 书签 |
| 整理与分析 | 预览整理方案，查看主题、关键词、网站来源和时间分布 |
| 找回与备份 | 按来源删除、恢复和清理，支持本地撤销与导入导出 |

**网页收藏与浏览器书签各自独立。** 同一网址可以同时存在于两边，删除当前这一份会保留另一份。Chrome 原生书签是否跨设备同步，由浏览器自身的同步设置决定。

## 快速开始

当前源码版本为 **2.5.0**。支持 Chrome 109 及以上，无需构建即可加载。

1. [下载源码 ZIP](https://github.com/leeguandong/bookmark-house/archive/refs/heads/main.zip) 并解压，或克隆本仓库。
2. 在 Chrome 打开 `chrome://extensions`，开启“开发者模式”。
3. 点击“加载已解压的扩展程序”，选择仓库里的 **`extension/` 文件夹**。
4. 固定工具栏中的书签小屋图标，打开一个普通网页，点击图标保存。
5. 点击弹窗中的“打开我的收藏”，进入管理界面。

Windows / Linux 默认快捷键为 `Alt+Shift+S`，macOS 为 `Command+Shift+S`，可在 `chrome://extensions/shortcuts` 调整。

已有安装请先导出重要收藏，并保留原扩展。商店安装版与源码加载版可能使用不同的扩展 ID，数据不会自动互通。详见[安装与数据迁移](docs/getting-started.md)。

## 中英文界面

首次打开跟随浏览器语言；在管理页右上角或保存弹窗中选择 **简体中文 / English**，即可切换并记住选择。导航、卡片操作、分析、整理、备份、提示信息、日期和右键入口均支持两种语言。切换不会翻译或修改你的收藏标题、正文、备注、自定义主题与文件夹名称。

## 保存与内容提取

- 拖拽支持地址栏的网址、网页内链接和其他应用分享的链接；Chrome 顶部的整个标签页不能直接拖入管理页面。
- 保存当前页使用用户主动触发的临时访问权限。补充已保存页面时，会按需请求对应站点的可选权限。
- 动态页面、登录限制或网站防护可能影响封面和正文提取；可以保留原页打开后重试，也可自行编辑标题、摘句和备注。
- 扩展没有接入远程 AI、广告或第三方统计服务。详细数据处理方式见[隐私政策](https://leeguandong.github.io/bookmark-house/privacy/)。

## 项目结构

```text
bookmark-house/
├── extension/       # 可直接加载的扩展，manifest.json 位于此处
├── tests/           # 使用合成数据的单元测试与集成测试
├── scripts/         # 源码检查、敏感信息扫描与打包工具
├── docs/            # 使用、开发、架构和隐私文档
├── .github/         # 自动检查、Issue 和 PR 模板
├── CHANGELOG.md     # 版本记录
├── CONTRIBUTING.md  # 贡献指南
├── SECURITY.md      # 安全问题与敏感信息处理
└── LICENSE          # MIT 许可证
```

扩展使用原生 JavaScript 模块、HTML 和 CSS，不依赖前端框架或运行时 npm 模块。工程目录与实际加载目录分开，运行文件之间的相对路径保持完整。

## 本地开发

需要 Node.js 24、npm、Python 3.10+ 和 Git。以下命令在仓库根目录执行：

```bash
npm ci --ignore-scripts
npm run prepare:hooks
npm run check
```

| 命令 | 用途 |
| --- | --- |
| `npm test` | 运行扩展行为测试与打包测试 |
| `npm run audit:secrets` | 在本机扫描已跟踪文件中的常见凭据 |
| `npm run audit:staged` | 检查暂存区的实际内容 |
| `npm run check` | 检查扩展资源、运行测试并扫描敏感信息 |
| `npm run package` | 生成 `dist/` 下可分发的扩展 ZIP 与文件报告 |

测试使用模拟 DOM、IndexedDB 和合成网址，不读取真实 Chrome 个人资料。自动检查覆盖同一套命令。更多说明见[开发指南](docs/development.md)与[架构说明](docs/architecture.md)。

## 参与与反馈

欢迎提交 [Issue](https://github.com/leeguandong/bookmark-house/issues) 和 Pull Request。提交问题时请附上版本、复现步骤与预期结果，并使用合成链接或脱敏示例。请勿公开真实收藏导出、Cookie、登录令牌或个人页面快照。

贡献流程见 [CONTRIBUTING.md](CONTRIBUTING.md)。潜在漏洞或敏感信息请按 [SECURITY.md](SECURITY.md) 私下报告。

## 许可证

项目代码与随附图标采用 [MIT 许可证](LICENSE)。通过 npm 安装的开发依赖保留各自许可证。
