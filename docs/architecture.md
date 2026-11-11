# 架构说明

## 运行边界

书签小屋是 Manifest V3 扩展，使用原生 JavaScript ES 模块、HTML 和 CSS。`extension/manifest.json` 声明工具栏弹窗、后台 Service Worker、管理页、权限及快捷键。

| 入口 | 主要职责 |
| --- | --- |
| `popup.html` / `popup-boot.js` | 首屏外壳与独立的打开管理页入口 |
| `popup.js` / `quick-capture.js` | 当前页保存、页面信息读取和保存反馈 |
| `background.js` | 右键与快捷键入口、书签事件和缓存更新 |
| `manager-start.js` / `manager.js` | 缓存首屏、后台核对、导航与管理操作 |

## 数据与展示

`local-store.js` 封装本地 IndexedDB。`collection-storage.js` 与 `web-collection.js` 管理网页收藏、封面、版本与事务；`private-trash.js` 管理原生书签的本地回收、撤销与恢复记录。原生书签的实际目录通过 Chrome bookmarks API 操作。

`collection-card.js`、`bookmark-cards.js` 与网页收藏视图共享卡片内容。相同网址可以复用已保存的预览，但两个来源的原始数据和删除操作保持独立。

`home-cache.js` 与 `bookmark-cache.js` 保存可校验的本地展示快照。启动先展示有效缓存，再读取最新数据并核对；修改操作以最新数据为准。封面与可见页面内容按需读取，避免每次打开遍历所有网页。

## 内容与分析

`page-preview.js` 读取页面中已有元信息和正文，`page-summary.js` 使用本地规则生成摘句。`page-identity.js` 识别网页身份；`preview-data.js` 规范化持久化预览。`analytics.js`、`core.js` 与整理模块基于已保存信息提供统计、分类与可预览方案。

扩展不调用远程模型。按需补充网页内容时，可能访问用户选择的原网站；相关站点权限、请求和截图行为见隐私政策。

## 开发与发布

测试在 Node.js 中模拟 DOM、IndexedDB 和 Chrome API，不连接私人浏览器。资源检查验证运行文件中的相对引用，打包器只收集运行目录与许可证。Git 仓库中的开发材料不会进入扩展 ZIP。
