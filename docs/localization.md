# Localization

Bookmark House supports Simplified Chinese (`zh-CN`) and English (`en`). Saved content remains in its original language.

## Message boundaries

`extension/i18n.js` provides:

- `t(source)` for authored interface text. Chinese source strings act as stable gettext-style message keys.
- `msg` tagged templates for complete sentences with indexed interpolation placeholders.
- `html` tagged templates for authored markup. Only static template segments are translated before values are inserted; interpolated titles, notes, keywords and HTML are never searched or translated. Existing escaping at the call site remains required.
- `date`, `number` and `locale` for language-aware formatting. Date formatters are cached per locale and options.
- `initLocale`, `setLanguage` and `onLanguageChange` for controls and live view updates.

English messages live in `extension/locales/en.js`. Static HTML uses `data-i18n` and matching attribute markers. Dynamic fields lose their initial marker before real content is written. Native Chrome manifest strings use `_locales/en/messages.json` and `_locales/zh_CN/messages.json`.

Built-in topic IDs and matching evidence remain stable. Their presentation can change language, while custom topics, saved text and folder names remain untouched. Generated category folders use the selected language; aliases recognize built-in names from either language.

## Preference and performance

On first use, the interface follows the browser language. A manual choice is remembered in extension-origin localStorage. The worker uses the existing IndexedDB store to restore the preference and update context-menu / action titles, without another permission. The preference is never uploaded.

The popup's first-load path has no module imports, collection reads or content extraction. `scripts/build_popup_locale.mjs` embeds only its small static message subset into `popup-boot.js`. Its full controller and catalog are loaded afterward. After editing popup text or translations, run:

```bash
npm run build:locales
npm run check:i18n
```

## Checks

The localization checker parses module messages, validates static HTML keys, ensures English entries contain no untranslated Chinese interface text, checks placeholder parity, and checks that the popup subset is current. Behavioral tests exercise both languages, singular counts, date grouping, live manager navigation, native worker surfaces, saved-content preservation and unsaved popup notes.

When adding a view, route authored text through these helpers and keep user data outside translation calls. Do not use a document-wide replacement or MutationObserver to translate saved content.

The extension privacy page follows the chosen UI language. `npm run build:policy` generates a standalone bilingual policy snapshot with language anchors and no JavaScript or external resources. Commit the generated `docs/privacy/index.html` with policy updates; GitHub Pages publishes it from this repository at https://leeguandong.github.io/bookmark-house/privacy/. The legacy repository remains available for existing links and other product policies.
