# Global-ish Quick Capture

A [Thymer](https://thymer.com) plugin that pops a small floating box which **is the real Thymer editor**, so you can jot down a thought from anywhere and send it wherever it belongs: your Journal, any page (top, bottom, or under a heading), or a specific line. Because the box is the genuine editor, everything works inside it: indent and outdent, `@page` references, dates, `#tags`, tasks, the lot.

Press `Cmd+Shift+Y` (`Ctrl+Shift+Y` on Windows/Linux), type, and hit `Cmd+Shift+Enter` to send. The captured lines are **moved**, not re-typed, so references, dates, tags and structure survive intact.

![Opening, moving and resizing the capture box](Assets/demo-open-resize.gif)

![Searching for a destination and sending a capture to a page](Assets/demo-send-to-page.gif)

## Why "Global-ish"

This plugin was built with one intention: to be a *true* global quick-capture for Thymer. A box you can summon from anywhere, jot into, and send off, floating over whatever you are doing without ever leaving the app you are in.

It is not fully there yet, and that is why this is version `0.9.0` and not `1.0`. There is one missing piece. Today, triggering the box from another app brings Thymer to the front and opens it there, so you step into Thymer for a moment. A box that floats over your current window, without switching to Thymer, needs Thymer to let plugins open floating windows. The hard part for the global trigger, the `thymer://` action API, already shipped; the floating window is the next step.

I am hoping we get to reach a full Global Capture once the wonderful Thymer Devs have shipped the beta and have a moment to extend the API. Until then, enjoy Global-ish Quick Capture.

## Features

- **It is the real editor**, not a re-implementation. Indent/outdent, `@` references, dates, `#tags` and tasks all behave exactly as in Thymer.
- **Floating, draggable and resizable.** Drag the header, resize from the corner. It remembers its size and position, adapts to your theme, and closes when you click outside.
- **Send anywhere:**
  - **Today's Journal** (the default, just hit send), or type a date (`tomorrow`, `next friday`, `2026-07-20`) to send it to that day's Journal
  - **any page**, at the **Top**, at the **Bottom**, or under a **heading** you pick
  - **any individual line** in the workspace
- **A destination picker that matches Thymer's own.** Searches page titles and line content, shows each result's collection icon, highlights the matched words, and previews a long line's full text on hover. Use `+` to require several words: `project+monday` matches items containing both.
- **Indent toggle:** nest the sent content under the chosen heading/line, or place it directly after as a sibling. Your choice is remembered.
- **Fidelity preserving.** Content is relocated with Thymer's own move operation, so references, dates, tags and the whole subtree structure come across untouched.
- **Your draft persists.** Closing and reopening keeps what you were writing. Only sending empties the box.
- **Keyboard first.** A toast with an **Open** button jumps straight to what you just sent.

## Keyboard shortcuts

| Action | Shortcut |
| --- | --- |
| Open / close the box | `Cmd+Shift+Y` (`Ctrl+Shift+Y`) |
| Send the capture | `Cmd+Shift+Enter` |
| Open the destination picker | `Cmd+Shift+M` (`Ctrl+Shift+M`) |
| Navigate results / pick | `↑` `↓` / `Enter` |

The open/close shortcut is configurable (see [Settings](#settings)). `Cmd+Enter` is intentionally left to Thymer, so you can tick a checkbox inside the box; use `Cmd+Shift+Enter` to send.

## Global hotkey (any app)

The plugin already gives you an in-Thymer shortcut and handles `thymer://` action URLs. To summon the box from **any** application, bind that URL to a keyboard shortcut at the OS level.

Run **Quick Capture: Global hotkey setup** from the Command Palette. It shows your exact URL (it contains your account and workspace, which you cannot easily find otherwise) with a copy button, plus the steps for your platform:

- **macOS:** open the Shortcuts app, create a new shortcut, add the **Open URL** action, paste the URL, then assign a keyboard shortcut in the shortcut's details.
- **Windows:** create a shortcut (`.lnk`) that opens the URL and set its **Shortcut key** field.
- **Linux:** add a custom keyboard shortcut in your desktop environment that runs `xdg-open` with the URL.

Use the **same** shortcut as your in-Thymer one (`Cmd+Shift+Y` by default). When you are already in Thymer it opens the box; from any other app it brings Thymer to the front and opens the box. The OS-level hotkey takes the key first, so it does not clash with the in-Thymer shortcut. Thymer just needs to be running.

> The whole flow has been verified end to end on macOS. Windows and Linux are expected to work (Thymer registers the `thymer://` scheme on all platforms) but have not been tested here.

## Installation

1. In Thymer, open the Command Palette (`Cmd+P` / `Ctrl+P`), run **Plugins**, and click **Create Plugin** under Global Plugins.
2. In the plugin's dialog, go to the code editor (click **Edit as Code** if you see the settings view).
3. In the **Custom Code** tab, replace the contents with [`plugin.js`](plugin.js).
4. In the **Configuration** tab, replace the contents with [`plugin.json`](plugin.json).
5. Click **Save**, then set up the global hotkey as above.

Don't enable Hot Reload; it's a development feature and can leave the plugin in a state where saved data stops persisting.

## Settings

- **Quick Capture: Set Shortcut** (Command Palette) records a new open/close shortcut. Include at least one of `Cmd` / `Ctrl` / `Alt`. Stored locally per device.
- **Quick Capture: Global hotkey setup** shows your `thymer://` URL and the per-OS steps.
- The indent toggle state and the box geometry persist across sessions.

## Notes & limitations

- Escape can't close the box (Thymer captures it before plugins see it). Click outside, press the shortcut again, or use the `×`.
- The global hotkey needs Thymer to be running.
- The plugin is fully event-driven: nothing runs while the box is closed except one keydown check for the shortcut.

## Thanks

To the Thymer team, and JD in particular, for shipping the `thymer://` plugin-action API and the window controls that make triggering the box from outside Thymer possible.

## License

MIT
