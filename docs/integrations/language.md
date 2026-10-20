# Language of the screens: English, Arabic, Chinese

Settings has a page, **Language**, with three choices written in their own language (English, العربية, 中文). The choice is the global setting `uiLanguage` and is made on the spot in every screen that is open. The first screen of the first run has the same choice (bottom left).

## How it works

The screens are written in English. A language is a table from the English text to the text of that language (`browser/react/src/util/i18n/ar.ts`, `zh.ts`), applied to what is on the screen by `util/i18n/translator.ts`, which every screen's root starts (`util/mountFnGenerator.tsx`):

- the words of the page, and the `placeholder`, `title`, `aria-label` and `alt` of what has one, are replaced when the page is drawn and again whenever React changes them; English is put back when English is chosen;
- a text with a number or a name in it is a template: `"{0} files"` is written once; a sentence made of several pieces that has no entry as a whole is translated piece by piece; a list of known words (`Files, Terminal, Network`) is translated word by word;
- **not translated, on purpose**: what a person or the agent wrote (messages, markdown), code, paths, commands, file names, model and provider names, and the names of the three languages. These sit in `pre`, `code`, `.mo`, `.md` or carry `data-i18n-skip`;
- a text that is not in the table shows in English. Nothing breaks.
- **Arabic is laid out right to left**: the root of each screen gets `dir="rtl"`; code, diffs and commands stay left to right (`shell.css`, end of file); the strip with the window controls stays left to right because the system draws the controls on the right. The editor around Vader's screens (the workbench menus) is not touched: that is VS Code's own language, set with a language pack.

## Adding or fixing a text

The texts are written in `util/i18n/source/*.tsv` (`English ::: Arabic ::: Chinese` in `both-*.tsv`, or one language in `ar-*.tsv` and `zh-*.tsv`); `python build/lib/vader/genI18nTables.py` makes `ar.ts` and `zh.ts` from them. To find what is still English: run the UI tests with `VADER_I18N_MISSING=<file>`; after each picture the page is turned to Chinese for a moment and every text without an entry is appended to the file (one JSON line each), then the page returns to English (`test/fixtures/uiAudit.mjs`, `test/fixtures/i18nHarness.ts`). `VADER_LANG=ar|zh` takes all the pictures of a run in that language.

## Tests

`settingsUiE2E.mjs` (the Language page: the three names, the setting, the direction, a title and a placeholder in each language, and back to English).

## Trying the screens

`node src/vs/workbench/contrib/vader/test/uiPreview.mjs <folder>` (after `npm run buildreact`) writes three pages that open from the file system: `index.html` (the window with Add-ons), `settings.html` and `welcome.html`, as a clean install shows them, with stand-ins for the services behind them (nothing is saved, no model answers). The language chosen on one page is kept for the others.
