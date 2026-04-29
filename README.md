# Gmail Auto CC

A small Chrome extension that automatically adds a Cc recipient to Gmail
messages — with one rule per (From, Cc) pair, so the right Cc is added
depending on which account or alias you're sending from.

## Install (developer mode)

1. Open `chrome://extensions` in Chrome.
2. Toggle **Developer mode** on (top right).
3. Click **Load unpacked** and select this folder (`gmail-autocc`).
4. Click the extension icon, then **Open settings**.
5. Add one or more rules: each rule has a "From" address, a "Cc" address,
   and an enable/disable toggle. Leave "From" blank if you want a Cc to
   apply to every message.

## How it works

For each visible compose window, the extension applies every enabled rule
independently:

- If the rule's **From** matches the currently selected sender, the rule's
  **Cc** is added to the Cc field (revealing the field if needed).
- If it doesn't match, the rule's **Cc** is removed.
- A rule with an empty **From** matches every compose.

When you change the From in an open compose, the Cc field is updated on the
next tick (added or removed automatically). Cc addresses you typed yourself
are preserved.

If you have a single Gmail account (so Gmail doesn't show a From row), the
extension falls back to the email of your logged-in Google account.

Works on the English and French Gmail UIs.

## Files

- `manifest.json` — extension definition (Manifest V3).
- `content.js` — runs inside Gmail, watches compose windows, applies rules.
- `popup.html` / `popup.js` — the toolbar popup; opens the settings page.
- `options.html` / `options.js` — the full settings page (one row per rule).
- `icons/` — extension icons.

## Storage

Settings are stored in `chrome.storage.sync` under the key `rules`:

```js
[
  { from: "you@example.com", cc: "cc@example.com", enabled: true },
  { from: "",                cc: "always-cc@example.com", enabled: true }
]
```

Sync storage follows your Chrome profile across devices.

## Tests

A jsdom-based test harness lives outside this folder (in the parent project
workspace). It exercises the content script through ~35 scenarios covering
single-rule, multi-rule, From switching, live storage edits, legacy
migration, and the single-account fallback.
