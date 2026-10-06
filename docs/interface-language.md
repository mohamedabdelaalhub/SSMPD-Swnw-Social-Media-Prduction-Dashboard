# Interface language
The header and sign-in screen offer Arabic / English. Selection is stored locally as `ssmpd_language`; switching does not rerender tabs or reload the page.

Translations cover navigation, common actions, fields, workflow columns and filters across modules. Specialized prose, generated warnings, clinical document text and some dynamic messages may still appear in Arabic. User content, staff names, saved designs, input values and database identifiers are never automatically translated.

Static interface text is explicitly marked by `ssmpd-i18n:` comments or `data-i18n-*` attributes. Never translate arbitrary DOM text: user content can equal an interface label. Add new labels to `i18n-dictionary.js` and mark only interface output. `SSMPDI18n.textHtml` is for trusted interface labels, not user content. Attribute markers hold URI-encoded Arabic keys. The observer translates newly rendered marked elements without disturbing forms.

Run `SSMPD_TEST_MODULES=/path/to/node_modules node test/i18n.cjs` from the repository root (jsdom required).
