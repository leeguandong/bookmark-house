# Development

## Environment

Use Node.js 24, npm, Python 3.10+ and Git. From the repository root:

```bash
npm ci --ignore-scripts
npm run prepare:hooks
npm run check
```

Load `extension/` in Chrome. No bundle or framework build is required. npm dependencies are used only for development checks.

## Commands

| Command | Scope |
| --- | --- |
| `npm run check:extension` | Manifest, module and page resources, and package-version consistency |
| `npm run check:i18n` | Message coverage, English text, placeholders and popup generation |
| `npm run build:locales` | Rebuild the popup's small translation subset |
| `npm run test:extension` | Behavioral tests with simulated DOM, IndexedDB and Chrome APIs |
| `npm run test:package` | Archive structure, missing resources, MIT license and overwrite protection |
| `npm run audit:secrets` | Local checks of tracked content with project rules and Secretlint |
| `npm run audit:staged` | Scan the exact Git index |
| `npm run check` | Resources, localization, tests and secret scans |
| `npm run package` | Produce `dist/bookmark-house-2.5.0.zip` and its report |

If Windows only provides the `py` launcher, run the corresponding Python script with `py -3`, or add Python to PATH.

## Directory boundaries

Keep loadable files under `extension/` and preserve their relative references. Tests import from that directory. Scripts operate on the repository root for scans, but package only extension runtime files and the root MIT license.

Documentation belongs in `docs/`. Public policy hosting uses the separate `bookmark-house-privacy` repository so the established store URL does not depend on the source layout.

## Validation

Tests cover storage and concurrency, independent content sources, recovery, rendering, startup and caches, popup behavior, sidebar interaction, language switching, original-content preservation and packaging. They use synthetic data and never connect to a private Chrome profile.

Use a separate test browser profile to validate real Chrome permission prompts and website compatibility. Screenshots must use synthetic or redacted content. Distinguish the wait before Chrome creates a popup, the cold shell's first load, and later content extraction when reporting performance.

Language support is documented in [localization.md](localization.md). The popup remains independent of module imports and collection reads until its initial load completes.

## Packaging and release

`npm run package` creates a ZIP with `manifest.json` at the root, without the outer `extension/` folder. Tests, development dependencies, private exports and workspace backups are excluded. The file report includes the version and SHA-256. A different existing archive is not overwritten by default.

Keep the manifest, npm metadata, current documentation and packaged runtime in agreement. Repository checks do not publish to the Chrome Web Store.

## Security

Enable local commit hooks with `npm run prepare:hooks`. Continuous checks run on pushes and pull requests. Before upload, still review the staged diff and the history being pushed. Automated scans identify known patterns and cannot guarantee detection of every encoded or unknown secret.

Do not add credentials, real exports or private page captures to source or tests. Report vulnerabilities privately to the address in [SECURITY.md](../SECURITY.md).
