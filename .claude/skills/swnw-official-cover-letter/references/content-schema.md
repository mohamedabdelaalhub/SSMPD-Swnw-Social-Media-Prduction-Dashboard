# content.json schema

```json
{
  "cover": true,
  "meta": {
    "doc_title": "PDF/Word document title",
    "kicker": "optional small orange label above the title (only if the owner gave one)",
    "title": "Main title — second title line (split on the first ' — ')",
    "subtitle": "(optional line under the titles)",
    "to": "مُقدم إلى: ...",
    "date": "التاريخ: ..."
  },
  "sections": [
    { "title": "1. Section heading",
      "blocks": [
        {"type": "p", "text": "paragraph"},
        {"type": "bullet", "head": "bold lead-in:", "body": "rest of the bullet"},
        {"type": "split", "title": "heading", "items": [
          {"num": "60%", "head": "bold", "body": "text"},
          {"num": "40%", "head": "bold", "body": "text"}]},
        {"type": "formula", "title": "heading", "text": "equation / key sentence"},
        {"type": "table", "head": ["col 1", "col 2", "col 3"], "rows": [["a", "b", "c"]]}
      ]}
  ]
}
```

Notes
- Consecutive `bullet` blocks form one list. `split` is exactly two highlighted cards (blue then orange). `table` accepts any number of columns (first column is the bold row label).
- Keep Arabic text as given (including «» quotes and Latin terms); do not add diacritics or change digits.
- `meta.title` is split on the first " — ": the first part becomes the big blue cover title, the second the orange line.
