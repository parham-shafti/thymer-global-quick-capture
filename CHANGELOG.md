# Changelog

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
