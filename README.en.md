<p align="center">
  <img src="extension/icons/128.png" width="72" height="72" alt="Bookmark House icon">
</p>

<h1 align="center">Bookmark House</h1>
<p align="center">Keep good content. Come back anytime.</p>
<p align="center"><a href="README.md">简体中文</a> · <strong>English</strong></p>
<p align="center">
  <a href="https://github.com/leeguandong/bookmark-house/actions/workflows/ci.yml"><img src="https://github.com/leeguandong/bookmark-house/actions/workflows/ci.yml/badge.svg" alt="Project checks"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-326d58" alt="MIT license"></a>
  <img src="https://img.shields.io/badge/Chrome-109%2B-555b63" alt="Chrome 109+">
</p>
<p align="center">
  <a href="#quick-start">Quick start</a> · <a href="docs/getting-started.en.md">User guide</a> · <a href="docs/development.en.md">Development</a> · <a href="CONTRIBUTING.md">Contributing</a> · <a href="https://leeguandong.github.io/bookmark-house/privacy/#english">Privacy</a>
</p>

Bookmark House is an open-source Chrome extension that brings webpage cards and native bookmark management into one space. Save something worth keeping, then find it again through covers, excerpts, notes and save dates.

No account or API key is required. Collections, caches and internal Trash stay in the current browser's local extension storage. Summaries and content analysis use local rules, without a remote AI service.

## Features

| Feature | What it does |
| --- | --- |
| Save from anywhere | Use the toolbar, context menu, keyboard shortcut, pasted shares, or dropped address-bar and webpage links |
| Revisit visual cards | Browse by save date, search, star, add notes and manage reading status |
| Manage native bookmarks | Browse real Chrome folders, drag cards to organize them, and right-click folders for actions |
| Analyze and organize | Explore topics, keywords, sources and timelines; review a plan before applying folder changes |
| Recover and back up | Delete and restore by source, undo supported operations, and import or export local backups |
| Choose your language | Use English or Simplified Chinese across the manager, popup, actions, messages and date formatting |

**Web collection and native bookmarks are independent.** The same URL may exist in both. Deleting the current copy keeps the other. Chrome's own settings determine whether native bookmark changes sync to other devices.

## Quick start

The current source version is **2.5.0**. Chrome 109 or later is required. There is no build step for loading the extension.

1. [Download the source ZIP](https://github.com/leeguandong/bookmark-house/archive/refs/heads/main.zip) and extract it, or clone this repository.
2. Open `chrome://extensions` in Chrome and enable **Developer mode**.
3. Click **Load unpacked** and select the repository's **`extension/` directory**.
4. Pin Bookmark House to the toolbar. Open a regular webpage and click its icon to save it.
5. Use **Open my collection** in the popup to open the manager.

The default shortcut is `Alt+Shift+S` on Windows and Linux, or `Command+Shift+S` on macOS. Customize it at `chrome://extensions/shortcuts`.

If you already have an installation, export important saves and keep the original extension. Store and unpacked installations may have different extension IDs, and local card data does not move between them automatically. See the [installation and migration guide](docs/getting-started.en.md).

## English and Simplified Chinese

On first launch, the interface follows your browser language. Choose **English** or **简体中文** in the manager's top bar or save popup to remember your preference on this device. Open manager windows and popups share the preference; the native context menu follows it too.

Switching languages preserves the current view, search, selection and unsaved popup note. Your saved page titles, article text, notes, custom topics and folder names retain their original content. The language choice requires no extra extension permission and is not uploaded.

## Saving and extraction

- Drag an address-bar URL or a link inside a webpage. Entire Chrome tabs cannot be dropped directly into the manager.
- The toolbar uses temporary access to the page you actively choose. Updating a saved page may ask for optional access to that website.
- Dynamic pages, login requirements and website protections may limit covers or excerpts. Keep the original page open and try updating its content, or edit the title, excerpt and note manually.
- The extension has no advertising, third-party analytics or remote AI integration. A full English policy is available through **Privacy** inside the extension; the public [privacy page](https://leeguandong.github.io/bookmark-house/privacy/#english) describes storage, access, retention and deletion.

## Repository layout

```text
bookmark-house/
├── extension/       # Load this directory in Chrome; contains manifest.json
├── tests/           # Unit and integration tests with synthetic data
├── scripts/         # Resource checks, localization checks, secret scans and packaging
├── docs/            # User, development, architecture and privacy documentation
├── .github/         # Continuous checks and issue / pull request templates
├── CHANGELOG.md     # Release history
├── CONTRIBUTING.md  # Contribution process
├── SECURITY.md      # Security reporting and sensitive-data guidance
└── LICENSE          # MIT license
```

The extension uses native JavaScript ES modules, HTML and CSS. It does not require a front-end framework or runtime npm dependencies. Development files stay outside the loadable extension directory.

## Development

Use Node.js 24, npm, Python 3.10+ and Git. Run commands from the repository root:

```bash
npm ci --ignore-scripts
npm run prepare:hooks
npm run check
```

| Command | Purpose |
| --- | --- |
| `npm test` | Run extension behavior and packaging tests |
| `npm run check:i18n` | Verify translations, placeholders and the lightweight popup bundle |
| `npm run build:locales` | Regenerate the popup's small, local translation subset |
| `npm run audit:secrets` | Scan tracked files locally with two sets of secret-detection rules |
| `npm run audit:staged` | Scan the exact staged content before committing |
| `npm run check` | Check resources and localization, run tests, and scan for sensitive information |
| `npm run package` | Write a distributable extension ZIP and file report to `dist/` |

Tests use a simulated DOM, IndexedDB and Chrome APIs. They do not read a real Chrome profile or personal bookmarks. Continuous checks run the same commands. See the [development guide](docs/development.en.md) and [localization guide](docs/localization.md).

## Contributing and feedback

[Issues](https://github.com/leeguandong/bookmark-house/issues) and pull requests are welcome. Describe the version, reproducible steps, expected result and observed behavior. Use synthetic links and redacted screenshots. Never attach real collection exports, cookies, login tokens or private page snapshots.

For code changes, keep the two content sources independent, maintain backward compatibility for stored data, add behavior-focused regression tests, and run `npm run check`. Explain what changed and how you verified it. The detailed contribution guide is in [CONTRIBUTING.md](CONTRIBUTING.md).

Report possible vulnerabilities privately to **leeguandon@gmail.com**. Do not post secrets or private collection data in a public issue. Follow [SECURITY.md](SECURITY.md) for the reporting and cleanup process.

## License

Project code and bundled icons are available under the [MIT license](LICENSE). Development dependencies installed through npm retain their own licenses.
