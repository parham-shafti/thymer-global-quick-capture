# Changelog

## 0.9.2 - 2026-11-15

- **New note in a collection** takes two clear steps: first pick the collection, then name the page. The title starts out as the first line of your capture; leave it as is and that line becomes the title.
- Fixed: **Nest under target** on a heading indents the captured content again. Since Thymer 1.0.20 a heading's content sits flush with the heading, so captures landed directly under it with no indent.
- Fixed: lines you just typed show up again as destinations in the picker. After a Thymer update the picker could no longer tell which page such a line is on and left it out.
- The hidden Quick Capture collection stays out of the command palette: neither the scratch page nor the collection itself (Open Collection, New Page, "Create in Quick Capture") shows there any more.

## 0.9.1

- Capture to a specific day's Journal: type a date in the destination picker (`tomorrow`, `next friday`, `2026-07-20`, `yesterday`) and a "Journal · <date>" option appears. Past and future both work; Today's Journal stays the default.

## 0.9.0

First public release.

- Floating capture box that is the real Thymer editor: indent/outdent, `@` references, dates, `#tags` and tasks all work inside it.
- Draggable and resizable, remembers size and position, theme-adaptive, click-outside to close, draft persists until sent.
- Send to Today's Journal (default), any page (Top, Bottom or under a heading), or any individual line.
- Destination picker styled after Thymer's own: searches page titles and line content, shows collection icons, highlights matches, `+` for multi-word AND, and previews a long line's full text on hover.
- Indent toggle (nest under the target, or place after it as a sibling), remembered.
- Fidelity-preserving sends via Thymer's move operation: references, dates, tags and subtree structure are kept.
- Configurable open/close shortcut (default `Cmd+Shift+Y` / `Ctrl+Shift+Y`), `Cmd+Shift+Enter` to send, `Cmd+Shift+M` to open the destination picker, and a toast with an **Open** button that jumps to what you sent.
- **Global hotkey (any app)** via `thymer://` action URLs, with a **Global hotkey setup** command that shows your exact URL and the per-OS steps. Verified on macOS; Windows and Linux documented but untested.
