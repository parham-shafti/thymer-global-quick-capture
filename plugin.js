/**
 * Quick Capture — a global "scratchpad" modal that IS the real Thymer editor.
 *
 * A command (bind a shortcut, or trigger from anywhere on the Mac via a small
 * macOS Shortcut) pops a centered modal whose body is a genuine Thymer edit
 * panel bound to a hidden, reusable scratch page. You get the full editor:
 * indent/outdent, @page references, dates, #tags — everything — because it is
 * the editor, not a re-implementation.
 *
 * On send, the captured lines are MOVED (not serialized) to a destination so
 * references/dates/tags survive perfectly. Default destination is today's
 * Journal; you can search for any page and optionally drop the content under
 * one of its headings, otherwise it appends at the bottom.
 *
 * Performance: fully event-driven. Nothing runs at idle — no intervals, no
 * rAF loop, no observers. Work happens only while the modal is open, and the
 * panel + overlay are fully torn down on close.
 *
 * The scratch page guid is remembered in the plugin config ("custom.scratchGuid").
 */

const CSS = `
.panel[data-qc-modal] {
	position: fixed !important;
	top: 8vh !important;
	/* centered WITHOUT a transform — a transform would create a containing block
	 * that mispositions the editor's portaled @/#/date menu. Geometry is set
	 * inline (with !important) once the window is dragged or resized. */
	left: 0 !important; right: 0 !important; margin-inline: auto !important;
	width: min(720px, 92vw) !important; height: auto !important;
	min-height: 46vh !important; max-height: 86vh !important;
	z-index: 99999 !important;
	border: 1px solid var(--qc-border, rgba(127,127,127,.45)) !important;
	box-shadow: var(--qc-shadow, 0 20px 70px rgba(0,0,0,.6), 0 4px 14px rgba(0,0,0,.45)) !important;
	border-radius: 12px !important; overflow: hidden !important;
	/* opaque background is set inline from the live theme on open */
}
/* the editor's @/#/date autocomplete (portaled to body) must float ABOVE the modal */
body.qc-modal-open .cmdpal--inline { z-index: 100001 !important; }
/* reserve room for the drag header (top) and the action footer (bottom) */
.panel[data-qc-modal] .panel-scroller-y { padding-top: 40px !important; padding-bottom: 56px !important; }
.panel[data-qc-modal] .page-props-editor-container { display: none !important; }
.panel[data-qc-modal] h1.title { display: none !important; }
.panel[data-qc-modal] .panel-header-scrim { display: none !important; }
.panel[data-qc-modal] .panel-bar { display: none !important; }
.panel[data-qc-modal] .content-container { padding-top: 6px !important; }

.qc-header {
	position: absolute; top: 0; left: 0; right: 0; height: 34px;
	display: flex; align-items: center; gap: 8px; padding: 0 6px 0 12px;
	cursor: move; user-select: none; z-index: 7;
	/* same reason as the footer: the drag strip sits over the scroller, and with no
	 * background at all the draft scrolled straight through it */
	background: var(--qc-surface, #1e1e22);
	border-bottom: 1px solid rgba(127,127,127,.14); font-size: 12px;
	color: var(--ed-button-color, var(--text-color, #ccc));
}
.qc-header .qc-title { opacity: .6; font-weight: 600; display: inline-flex; align-items: center; gap: 6px; }
.qc-grow { flex: 1 1 auto; }
.qc-x { width: 24px; height: 24px; display: inline-flex; align-items: center; justify-content: center; border-radius: 6px; cursor: pointer; opacity: .55; }
.qc-x:hover { background: rgba(127,127,127,.18); opacity: 1; }

.qc-resize {
	position: absolute; right: 0; bottom: 0; width: 18px; height: 18px;
	display: flex; align-items: flex-end; justify-content: flex-end;
	padding: 1px 2px; cursor: nwse-resize; z-index: 9; opacity: .4;
	color: var(--text-color, #888);
}
.qc-resize:hover { opacity: .8; }
.qc-resize .ti { font-size: 13px; }

.qc-footer {
	position: absolute; left: 0; right: 0; bottom: 0; height: 48px;
	display: flex; align-items: center; gap: 8px; padding: 0 10px;
	/* The bar is drawn OVER the scroller, which spans the full box height, so with a
	 * 93%-transparent background the draft scrolls visibly through it (only obvious
	 * once a capture is long enough to scroll — measured live 2026-07-19). Keep the
	 * 7% tint, but lay it over the box's own surface colour so the bar is opaque.
	 * --qc-surface is set inline on the wrapper and inherits down to here. */
	background: linear-gradient(rgba(127,127,127,.07), rgba(127,127,127,.07)), var(--qc-surface, #1e1e22);
	border-top: 1px solid rgba(127,127,127,.18);
	z-index: 6; font-size: 13px;
	container: qc-footer / inline-size;
}
/* in a narrow box the indent label would crowd out the destination button —
 * drop the label (icon-only, tooltip still explains) before that happens */
@container qc-footer (max-width: 660px) {
	.qc-indent-lbl { display: none; }
}
.qc-btn {
	display: inline-flex; align-items: center; gap: 6px;
	height: 30px; padding: 0 12px; border-radius: 7px; cursor: pointer;
	border: 1px solid rgba(127,127,127,.28);
	background: var(--ed-button-bg, transparent);
	color: var(--ed-button-color, var(--text-color, #ddd)); font-size: 13px; white-space: nowrap;
}
.qc-btn:hover { filter: brightness(1.18); }
.qc-dest { max-width: 320px; overflow: hidden; text-overflow: ellipsis; }
.qc-dest .ti { opacity: .8; }
.qc-indent { padding: 0 9px; }
.qc-indent.qc-on {
	/* the mid accent (--color-primary-500), matching the preview highlight; the
	 * button's old --ed-button-primary-bg (--color-primary-700) was too dark */
	color: var(--color-primary-500, #4caea1);
	border-color: var(--color-primary-500, #4caea1);
}
/* darker step in light themes (500 reads too pale there), same as the preview match */
html.is-light .qc-indent.qc-on {
	color: var(--color-primary-700, #2f8873);
	border-color: var(--color-primary-700, #2f8873);
}
.qc-spacer { flex: 1 1 auto; }
.qc-hint { opacity: .5; font-size: 11.5px; margin-right: 4px; }
.qc-send {
	background: var(--ed-button-primary-bg, #3aa37f) !important; border-color: transparent !important;
	color: #fff; font-weight: 600;
}
.qc-send:hover { filter: brightness(1.1); }

.qc-pop {
	position: absolute; left: 10px; bottom: 56px;
	width: min(640px, calc(100% - 20px)); max-width: calc(100vw - 24px);
	/* the native command palette's elevated surface, so the picker reads as a
	 * first-party popover (lighter than the near-black modal), theme-following */
	background: var(--cmdpal-bg-color, var(--qc-surface, var(--app-bg, #26262b)));
	/* typography mirrors the native command palette (.cmdpal) exactly: its font,
	 * text size, muted base colour, so the picker is indistinguishable from it */
	color: var(--cmdpal-fg-color, var(--text-color, #ddd));
	font-family: var(--font-mono, inherit);
	border: 1px solid var(--qc-border, rgba(127,127,127,.4));
	border-radius: var(--radius-larger, 6px);   /* match native cmdpal (was 10px, too round) */
	box-shadow: 0 16px 48px rgba(0,0,0,.5); z-index: 10; overflow: hidden;
}
.qc-pop-input {
	width: 100%; box-sizing: border-box; border: none; outline: none;
	padding: 10px; font-size: var(--text-size-small, .875rem); font-family: inherit;
	background: transparent; color: var(--cmdpal-fg-color, var(--text-color, #eee));
	border-bottom: 1px solid var(--divider-color, rgba(127,127,127,.2));
}
.qc-pop-list { max-height: 280px; overflow-y: auto; padding-bottom: 8px; }
.qc-opt {
	padding: 5px 10px; cursor: pointer;
	font-size: var(--text-size-small, .875rem); line-height: 16px; font-weight: var(--font-weight-normal, 400);
	display: flex; align-items: center; gap: 8px;
	color: var(--cmdpal-fg-color, var(--text-color, #ddd));
}
.qc-opt:hover:not(.qc-active) { background: rgba(127,127,127,.12); }
/* selection = native command-palette selection colours (accent bar); accent is
 * reserved for the active row, NOT matched letters (those are just bold) */
.qc-opt.qc-active { background: var(--cmdpal-selected-bg-color, var(--ed-button-primary-bg, #3aa37f)); color: var(--cmdpal-selected-fg-color, #fff); }
.qc-opt.qc-active .ti, .qc-opt.qc-active .qc-opt-sub { color: var(--cmdpal-selected-fg-color, #fff); opacity: .85; }
.qc-opt .ti { opacity: .7; font-size: 14px; flex: 0 0 auto; }
.qc-opt-text { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* exactly native's match highlight (.autocomplete--hilite): brightest contrast
 * colour + bold, so matched letters read crisp against the muted base text */
.qc-opt-text b { color: var(--cmdpal-hilite-color, var(--color-blackwhite-0, #fff)); font-weight: var(--font-weight-bold, 700); }
.qc-opt-sub { opacity: .55; font-size: 11.5px; flex: 0 0 auto; max-width: 170px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.qc-linepreview {
	/* above the fixed modal (99999) and the editor autocomplete (100001) — it is
	 * appended to <body>, a sibling of the modal, so it needs its own high z */
	position: fixed; z-index: 100002; max-width: 440px; box-sizing: border-box;
	padding: 10px 12px; border-radius: 8px; pointer-events: none;
	background: var(--cmdpal-bg-color, var(--qc-surface, #26262b));
	color: var(--cmdpal-fg-color, var(--text-color, #ddd));
	border: 1px solid var(--qc-border, rgba(127,127,127,.4));
	box-shadow: 0 12px 40px rgba(0,0,0,.5);
	font-family: var(--font-mono, inherit); font-size: var(--text-size-small, .875rem); line-height: 1.5;
	max-height: 60vh; overflow-y: auto;
}
.qc-lp-text { white-space: pre-wrap; overflow-wrap: anywhere; }
/* mid accent in the preview so the match pops without being harsh: 700 (the Send
 * button, --ed-button-primary-bg) read dull, 300 was too bright, 500 sits between.
 * In LIGHT themes 500 is too pale on the light surface, so step down to the darker
 * 700 (the primary scale runs light->dark with the number in both light and dark). */
.qc-lp-text b { font-weight: var(--font-weight-bold, 700); color: var(--color-primary-500, #4caea1); }
html.is-light .qc-lp-text b { color: var(--color-primary-700, #2f8873); }
.qc-lp-ctx { margin-top: 8px; padding-top: 6px; border-top: 1px solid rgba(127,127,127,.2); opacity: .6; font-size: 11.5px; }
.qc-sec { padding: 6px 12px 2px; font-size: 10.5px; letter-spacing: .04em; text-transform: uppercase; opacity: .45; }
.qc-hlvl {
	flex: 0 0 auto; min-width: 16px;
	font-size: 10px; font-weight: var(--font-weight-bold, 700);
	opacity: .5; letter-spacing: .03em;
}
.qc-opt.qc-active .qc-hlvl { opacity: .8; }

.qc-settings-backdrop {
	position: fixed; inset: 0; z-index: 100000;
	background: rgba(0,0,0,.45); backdrop-filter: blur(2px);
	display: flex; align-items: center; justify-content: center;
}
.qc-settings {
	width: 380px; max-width: 92vw; box-sizing: border-box; padding: 20px;
	background: var(--qc-surface, #26262b); border: 1px solid var(--qc-border, rgba(127,127,127,.4));
	border-radius: 12px; box-shadow: 0 20px 70px rgba(0,0,0,.55);
	color: var(--ed-button-color, var(--text-color, #ddd)); font-size: 13px;
}
.qc-settings h3 { margin: 0 0 4px; font-size: 15px; }
.qc-settings p { margin: 0 0 14px; font-size: 12px; opacity: .6; line-height: 1.4; }
.qc-keycap {
	display: flex; align-items: center; justify-content: center; gap: 6px;
	min-height: 46px; margin-bottom: 16px; border-radius: 8px;
	border: 1px dashed var(--qc-border, rgba(127,127,127,.5));
	font-size: 17px; font-weight: 700; letter-spacing: 1px;
}
.qc-keycap.qc-armed { border-style: solid; border-color: var(--ed-button-primary-bg, #3aa37f); opacity: .9; }
.qc-settings-row { display: flex; gap: 8px; justify-content: flex-end; }
.qc-guide { width: 460px; }
.qc-guide p { opacity: .72; }
.qc-url-wrap { display: flex; gap: 8px; align-items: flex-start; margin-bottom: 18px; }
.qc-url {
	flex: 1 1 auto; min-width: 0;
	font-family: var(--font-mono, monospace); font-size: 11.5px; line-height: 1.55;
	background: rgba(127,127,127,.1); border: 1px solid var(--qc-border, rgba(127,127,127,.4));
	border-radius: 8px; padding: 9px 11px;
	word-break: break-all; user-select: all; cursor: text;
}
.qc-url-copy { flex: 0 0 auto; }
.qc-os-list { display: flex; flex-direction: column; gap: 14px; margin-bottom: 20px; }
.qc-os { display: flex; flex-direction: column; gap: 3px; }
.qc-os-name { font-weight: 700; font-size: 13px; }
.qc-os-text { font-size: 12px; opacity: .66; line-height: 1.5; }

/* ---- panel mode: the whole window IS the capture box. Used when the web
 * client is loaded inside the floating-panel helper (or any tab) with #qc-panel
 * in the URL. The box fills the viewport; the app behind it is curtained off. */
body.qc-panel-mode::before {
	content: ''; position: fixed; inset: 0; z-index: 99998;
	background: var(--app-bg, #1e1e22);
}
body.qc-panel-mode .panel[data-qc-modal] {
	top: 0 !important; left: 0 !important; right: 0 !important; bottom: 0 !important;
	width: 100vw !important; height: 100vh !important;
	min-height: 100vh !important; max-height: none !important;
	margin: 0 !important; border: none !important; border-radius: 0 !important;
	box-shadow: none !important;
}
/* no drag/resize/cancel — the OS panel is the window; × hides it via the helper */
body.qc-panel-mode .qc-header { cursor: default; }
body.qc-panel-mode .qc-resize { display: none !important; }
body.qc-panel-mode .qc-cancel { display: none !important; }
/* Thymer's toasts sit at z-index 9999 — beneath the curtain (99998) and the
 * fullscreen box (99999). Lift them above both so "Sent …" is visible. */
body.qc-panel-mode .id--toaster-area { z-index: 100003 !important; }
/* Thymer's own popups set background from var(--cmdpal-bg-color) with NO literal
 * fallback (verified in the served CSS), so the moment that var is empty the
 * @/#/date menu paints fully TRANSPARENT and the page bleeds through it. Seen in
 * the panel (the box auto-opens DURING load, and a CUSTOM theme also waits on the
 * user's custom CSS) AND in the desktop app. Scoped to "our box is open", which is
 * the same scope as the z-index lift above. When the theme is present this changes
 * nothing — the var wins. --qc-surface is published on documentElement (these
 * popups are portaled to <body>, outside our wrapper, so they cannot inherit it). */
/* the panel window is narrow — let the line hover preview use most of it */
body.qc-panel-mode .qc-linepreview { max-width: min(640px, calc(100vw - 24px)); }
`;

// In-Thymer hotkey to open the capture box (active whenever Thymer is focused).
// Default is Cmd+Shift+Y on Mac / Ctrl+Shift+Y elsewhere (both unbound in Thymer
// and reach the plugin). Each user can record their own via "Quick Capture:
// Set Shortcut"; it's stored in the plugin's localStorage settings.
function defaultHotkey() {
	const mac = (typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform || ''))
		|| !!document.querySelector('.is-desktop-mac');
	return { key: 'y', meta: mac, ctrl: !mac, shift: true, alt: false };
}

// Panel mode: the tab/webview was opened with #qc-panel (or ?qc-panel) in the
// URL — the whole window becomes ONLY the capture box (used by the floating
// -panel helper, which loads the WEB client inside a native panel). The SPA may
// rewrite the URL before plugins load, so also check the URL the document was
// ORIGINALLY loaded with (the navigation timing entry), and remember the mode
// in sessionStorage so in-tab reloads keep it.
function qcPanelMode() {
	try {
		if (sessionStorage.getItem('qc_panel_mode') === '1') return true;
		const urls = [location.href || ''];
		const nav = performance.getEntriesByType && performance.getEntriesByType('navigation')[0];
		if (nav && nav.name) urls.push(nav.name);
		if (urls.some((u) => /[?#&]qc-panel\b/.test(u))) {
			sessionStorage.setItem('qc_panel_mode', '1');
			return true;
		}
	} catch (e) {}
	return false;
}

// The code the scratch collection carries (see dataCode): plugin data, kept out of the command palette.
const QC_DATA_CODE = '// Plugin-owned data. Kept out of the command palette, and never offered as a place to create a page.\n' +
	'// The owning plugin\'s own createRecord still works: supportsCreateItem is true only inside that call.\n' +
	'class Plugin extends CollectionPlugin {\n' +
	'\tgetJumpToPaletteOptions() { return []; }\n' +
	'\tsupportsCreateItem() { return this._dataCreate === true; }\n' +
	'\tcreateNewRecord(...args) { this._dataCreate = true; try { return super.createNewRecord(...args); } finally { this._dataCreate = false; } }\n' +
	'}\n';

/* A line's page guid. Thymer stopped putting `rguid` on line state in itemsByGuid (2026-11-14):
 * walk `.parent` to the root `document`, whose guid is the record guid (journal days too). */
function qcRguid(st) {
	if (!st) return null;
	if (st.rguid) return st.rguid;
	let n = st;
	for (let i = 0; n.parent && i < 500; i++) n = n.parent;
	return n !== st && n.type === 'document' ? n.guid : null;
}
class Plugin extends AppPlugin {

	/* All state as class fields so a stray onUnload() before onLoad() can't crash. */
	cmd = null;
	cmd2 = null;
	cmd3 = null;
	settingsEl = null;
	settingsRec = null;
	scratchGuid = null;
	homeCollectionGuid = null;
	panel = null;
	headerEl = null;
	footerEl = null;
	resizeEl = null;
	popEl = null;
	keyHandler = null;
	outsideHandler = null;
	hotkey = null;
	hotkeyHandler = null;
	dragCleanup = null;
	gridEl = null;        // .panels-grid we collapsed the modal's column in
	gridObserver = null;
	geometry = null;   // {left, top, width, height} — persisted, restored on open
	dest = { kind: 'journal' };   // {kind:'journal'} | {kind:'page', guid, name, afterHeadingGuid?, headingText?} | {kind:'line', guid, pageGuid, name, pageName}
	indentUnder = true;           // place sent content indented under the chosen heading/line (persisted)
	searchTimer = null;
	searchToken = 0;
	destOpts = [];                // selectable rows in the destination picker (arrow-key nav)
	destSel = 0;
	opening = false;
	seenActionNonces = [];        // dedupe for the helper's action-URL retries
	collMap = {};                 // collection guid -> name (built on picker open)
	recordsCache = [];            // all workspace records, snapshotted on picker open
	newNoteMode = false;          // picker is asking for a new note's title + collection
	newNoteFilter = null;         // repaints the collection list while step 1 is showing
	linePreviewEl = null;         // floating full-text preview shown on line hover
	panelMode = false;            // whole window = the capture box (#qc-panel in the URL)
	panelWatchdog = null;         // panel mode: heals the box when Thymer re-renders panels
	panelDeleteHandler = null;    // panel mode: WebKit Backspace/Delete fix (see onLoad)
	themeObserver = null;         // panel mode: re-tints the box when the theme lands

	onLoad() {
		this.loadSettings();
		this.ui.injectCSS(CSS);
		this.panelMode = qcPanelMode();
		if (this.panelMode) {
			document.body.classList.add('qc-panel-mode');
			this.autoOpenPanel();
			this.startPanelWatchdog();
			// the web client's panel LAYOUT is per-client but shared across tabs of
			// the same browser profile — close our box panel when the tab goes away
			// so a normal web session isn't left with a stray scratch panel
			window.addEventListener('pagehide', () => {
				try { if (this.panel) this.ui.closePanel(this.panel); } catch (e) {}
			});
			// moving the OS panel steals focus from the page for a moment (blur),
			// which drops the editor caret — typing dies. Re-place the caret
			// whenever focus comes back (and on any click into the box).
			window.addEventListener('focus', () => {
				if (this.panel) setTimeout(() => this.placeCaret(), 80);
			});
			// WebKit fix (the WKWebView panel): Thymer's editor drives deletes off
			// the NATIVE beforeinput stream from its hidden textarea (#virtualinput),
			// but the textarea is drained into the model per keystroke, and WebKit —
			// unlike Chromium — fires NO beforeinput for Backspace in an empty
			// textarea. Net effect: one delete right after typing, then dead keys.
			// Thymer's own (unused-on-desktop) fallback `Fp` shows the sanctioned
			// recipe: feed a synthetic beforeinput straight into the virtual input's
			// handler ($o) and swallow the keydown. Do exactly that, for exactly the
			// combos Fp maps. Verified live in the panel 2026-07-12.
			this.panelDeleteHandler = (e) => {
				if (e.key !== 'Backspace' && e.key !== 'Delete') return;
				if (e.metaKey || e.ctrlKey || e.defaultPrevented) return;
				const vi = window.g_virtual_input;
				if (!vi || !vi.$textarea) return;
				const t = e.target;
				// real inputs (destination picker, dialogs) keep native behaviour
				if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') && t !== vi.$textarea) return;
				const type = e.key === 'Backspace'
					? (e.altKey ? 'deleteWordBackward' : 'deleteContentBackward')
					: (e.altKey ? 'deleteWordForward' : 'deleteContentForward');
				// Feed Thymer's own beforeinput listener. Prefer the public route (dispatch
				// on the hidden textarea); fall back to the internal handler if this build
				// still exposes it. Depending on the minified name alone broke the moment
				// Thymer shipped a new bundle.
				const ie = new InputEvent('beforeinput', { inputType: type, bubbles: true, cancelable: true });
				if (typeof vi.$o === 'function') vi.$o(ie); else vi.$textarea.dispatchEvent(ie);
				e.preventDefault();
			};
			window.addEventListener('keydown', this.panelDeleteHandler, true);
			// The box is never torn down in panel mode, so hiding and reopening the
			// window kept the previously picked destination — easy to send to the wrong
			// page without noticing. Reset to the default every time the panel comes
			// back into view (the window being hidden flips visibilityState).
			document.addEventListener('visibilitychange', () => {
				if (document.visibilityState === 'visible' && this.panel) this.setDest({ kind: 'journal' });
			});
		}
		// One-shot sweep (both modes): interrupted panel-mode cycles can leak
		// scratch-page panels into the layout. Close any that aren't the live box.
		setTimeout(() => this.sweepScratchPanels(), 3000);
		setTimeout(() => this.sweepScratchPanels(), 12000);
		this.cmd = this.ui.addCommandPaletteCommand({
			label: 'Quick Capture',
			icon: 'ti-bolt',
			onSelected: () => this.open(),
		});
		this.cmd2 = this.ui.addCommandPaletteCommand({
			label: 'Quick Capture: Set Shortcut',
			icon: 'ti-keyboard',
			onSelected: () => this.openSettings(),
		});
		this.cmd3 = this.ui.addCommandPaletteCommand({
			label: 'Quick Capture: Global hotkey setup',
			icon: 'ti-world-bolt',
			onSelected: () => this.openHotkeyGuide(),
		});
		// global-within-Thymer hotkey (a macOS Shortcut sends this chord to open
		// the box from anywhere). One cheap keydown check — no idle cost.
		this.hotkeyHandler = (e) => {
			// while the box is open, the Move To chord (⌘⇧M / ⌃⇧M) opens/focuses OUR
			// destination picker instead — one muscle-memory chord, context-aware.
			// Move To yields to us via a guard that checks for the open modal.
			if (this.panel && this.matchesDestKey(e)) {
				e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
				// Same chord toggles: open it, or close it again if you change your mind.
				// Closing never alters the destination (only picking a row does), so a
				// second press is always a safe cancel. Hand focus back to the editor so
				// typing continues at the caret instead of going nowhere.
				if (this.popEl) {
					this.closeDestPicker();
					try { window.g_virtual_input.$textarea.focus(); } catch (e) {}
				} else {
					this.toggleDestPicker();
				}
				return;
			}
			if (!this.matchesHotkey(e)) return;
			e.preventDefault(); e.stopPropagation();
			// toggle: open it, or if it's already open close it (the draft is kept —
			// only Send empties the box, so you can reopen and continue)
			if (this.panel) this.cancel();
			else if (!this.opening) this.open();
		};
		window.addEventListener('keydown', this.hotkeyHandler, true);
	}

	matchesHotkey(e) {
		const hk = this.hotkey || defaultHotkey();
		return !!e.key && e.key.toLowerCase() === hk.key
			&& !!e.metaKey === !!hk.meta && !!e.shiftKey === !!hk.shift
			&& !!e.ctrlKey === !!hk.ctrl && !!e.altKey === !!hk.alt;
	}

	// ⌘⇧M on Mac, ⌃⇧M elsewhere — opens the destination picker while the box is open
	matchesDestKey(e) {
		if (!e.key || e.key.toLowerCase() !== 'm' || !e.shiftKey || e.altKey) return false;
		return qcIsMac() ? (e.metaKey && !e.ctrlKey) : (e.ctrlKey && !e.metaKey);
	}

	// thymer:// action URLs (desktop >= 1.0.17). Verified 2026-07-03:
	//   thymer://<accountHost>/plugin-action?workspaceGuid=<WS>&action=open-capture
	// payload = query params (repeated keys become arrays) + rawUrl + accountHost;
	// workspaceGuid and action are REQUIRED or the app drops the URL. Dispatched
	// to EVERY plugin in the workspace, so only react to our own action name.
	// The app deliberately does NOT foreground for action URLs — we do, below.
	//
	// The global helper registers the SAME chord as the in-Thymer hotkey and
	// consumes it system-wide (the window listener below never fires while the
	// helper runs — it stays as a fallback when the helper isn't installed).
	// So this handler carries the full toggle semantics: box open + Thymer
	// focused = "close it"; box open elsewhere = "show me it"; closed = open.
	onProtocolAction(action) {
		const name = typeof action === 'string' ? action
			: (action?.action ?? action?.name ?? '');
		if (String(name).toLowerCase() !== 'open-capture') return;
		// The helper re-fires the action URL a few times (with the same nonce)
		// to cover the no-window / cold-start case, where the first fire is
		// silently dropped by the app. Process each press only once, or the
		// retries would toggle the box straight back shut.
		const nonce = (action && typeof action === 'object' && action.nonce) || null;
		if (nonce) {
			if (this.seenActionNonces.includes(nonce)) return;
			this.seenActionNonces.push(nonce);
			if (this.seenActionNonces.length > 20) this.seenActionNonces.shift();
		}
		(async () => {
			try {
				if (this.panel) {
					let focused = false;
					try { focused = !!(await this.window?.isFocused?.()); } catch (e) {}
					if (focused) { this.cancel(); return; }
				}
				const w = this.window;
				if (w) {
					if (await w.isMinimized?.()) await w.restore?.();
					await w.show?.();
					await w.focus?.();
				}
			} catch (e) {}
			if (!this.panel && !this.opening) this.open();
		})();
	}

	onUnload() {
		if (this.panelWatchdog) { clearInterval(this.panelWatchdog); this.panelWatchdog = null; }
		if (this.panelDeleteHandler) { window.removeEventListener('keydown', this.panelDeleteHandler, true); this.panelDeleteHandler = null; }
		if (this.themeObserver) { this.themeObserver.disconnect(); this.themeObserver = null; }
		this.teardown();
		this.closeSettings();
		if (this.hotkeyHandler) { window.removeEventListener('keydown', this.hotkeyHandler, true); this.hotkeyHandler = null; }
		try { if (this.cmd) this.cmd.remove(); } catch (e) {}
		try { if (this.cmd2) this.cmd2.remove(); } catch (e) {}
		try { if (this.cmd3) this.cmd3.remove(); } catch (e) {}
		this.cmd = this.cmd2 = this.cmd3 = null;
	}

	// ---- shortcut settings -------------------------------------------------

	hotkeyLabel(hk) {
		hk = hk || this.hotkey || defaultHotkey();
		let s = '';
		if (hk.ctrl) s += '⌃';
		if (hk.alt) s += '⌥';
		if (hk.shift) s += '⇧';
		if (hk.meta) s += '⌘';
		s += (hk.key || '').toUpperCase();
		return s || '—';
	}

	openSettings() {
		if (this.settingsEl) return;
		const bd = document.createElement('div');
		bd.className = 'qc-settings-backdrop';
		bd.innerHTML = `
			<div class="qc-settings">
				<h3>Quick Capture shortcut</h3>
				<p>Press a key combination to open the capture box. Include at least one of ⌘ / ⌃ / ⌥.</p>
				<div class="qc-keycap qc-armed">${this.hotkeyLabel()}</div>
				<div class="qc-settings-row">
					<button class="qc-btn qc-set-cancel">Cancel</button>
					<button class="qc-btn qc-send qc-set-save">Save</button>
				</div>
			</div>`;
		const dlg = bd.querySelector('.qc-settings');
		dlg.style.setProperty('--qc-surface', this.themeSurfaceColor());
		dlg.style.setProperty('--qc-border', this.themeBorderColor());
		document.body.appendChild(bd);
		this.settingsEl = bd;

		let captured = null;
		const cap = bd.querySelector('.qc-keycap');
		this.settingsRec = (e) => {
			if (['Meta', 'Control', 'Shift', 'Alt', 'OS'].includes(e.key)) return; // wait for a real key
			if (!(e.metaKey || e.ctrlKey || e.altKey)) return;                      // require a strong modifier
			e.preventDefault(); e.stopPropagation();
			captured = { key: e.key.toLowerCase(), meta: !!e.metaKey, ctrl: !!e.ctrlKey, shift: !!e.shiftKey, alt: !!e.altKey };
			cap.textContent = this.hotkeyLabel(captured);
		};
		document.addEventListener('keydown', this.settingsRec, true);
		bd.querySelector('.qc-set-cancel').addEventListener('click', () => this.closeSettings());
		bd.addEventListener('pointerdown', (e) => { if (e.target === bd) this.closeSettings(); });
		bd.querySelector('.qc-set-save').addEventListener('click', () => {
			if (captured) { this.hotkey = captured; this.persistSettings(); this.toast('Quick Capture shortcut: ' + this.hotkeyLabel(captured)); }
			this.closeSettings();
		});
	}

	closeSettings() {
		if (this.settingsRec) { document.removeEventListener('keydown', this.settingsRec, true); this.settingsRec = null; }
		if (this.settingsEl) { this.settingsEl.remove(); this.settingsEl = null; }
	}

	// Shows the user's exact thymer:// action URL (with THEIR account host +
	// workspace guid, which they can't easily find otherwise) plus a per-OS hint,
	// so binding a global hotkey to it is a copy-paste job.
	openHotkeyGuide() {
		if (this.settingsEl) return;
		const wsGuid = this.ui.getActivePanel()?.getNavigation()?.workspaceGuid || '';
		const host = (typeof location !== 'undefined' && location.host) || '<your-account>.thymer.com';
		const url = `thymer://${host}/plugin-action?workspaceGuid=${wsGuid}&action=open-capture`;
		const bd = document.createElement('div');
		bd.className = 'qc-settings-backdrop';
		bd.innerHTML = `
			<div class="qc-settings qc-guide">
				<h3>Global hotkey setup</h3>
				<p>Bind this URL to a keyboard shortcut in your operating system, and the capture box opens from any app. Thymer just needs to be running.</p>
				<div class="qc-url-wrap">
					<div class="qc-url"></div>
					<button class="qc-btn qc-url-copy">Copy</button>
				</div>
				<div class="qc-os-list">
					<div class="qc-os"><span class="qc-os-name">macOS</span><span class="qc-os-text">Shortcuts app, new shortcut, add the "Open URL" action, paste the URL, then assign a keyboard shortcut in its details.</span></div>
					<div class="qc-os"><span class="qc-os-name">Windows</span><span class="qc-os-text">Make a shortcut (.lnk) to the URL and set its Shortcut key field.</span></div>
					<div class="qc-os"><span class="qc-os-name">Linux</span><span class="qc-os-text">Add a custom keyboard shortcut that runs xdg-open with the URL.</span></div>
				</div>
				<div class="qc-settings-row">
					<button class="qc-btn qc-send qc-guide-close">Done</button>
				</div>
			</div>`;
		const dlg = bd.querySelector('.qc-settings');
		dlg.style.setProperty('--qc-surface', this.themeSurfaceColor());
		dlg.style.setProperty('--qc-border', this.themeBorderColor());
		bd.querySelector('.qc-url').textContent = url;
		document.body.appendChild(bd);
		this.settingsEl = bd;
		bd.querySelector('.qc-url-copy').addEventListener('click', () => {
			try { navigator.clipboard.writeText(url); this.toast('Hotkey URL copied'); } catch (e) {}
		});
		bd.querySelector('.qc-guide-close').addEventListener('click', () => this.closeSettings());
		bd.addEventListener('pointerdown', (e) => { if (e.target === bd) this.closeSettings(); });
	}

	// ---- scratch page lifecycle -------------------------------------------

	// A global plugin cannot create top-level pages (data.createNewRecord is
	// disabled), so the editor needs a host record in a collection. We keep ONE
	// reusable scratch page (guid remembered in config) in a home collection,
	// cleared on each open — no per-capture churn.
	async getScratchRecord() {
		if (this.scratchGuid) {
			const r = this.data.getRecord(this.scratchGuid);
			if (r) return r;
		}
		const col = await this.homeCollection();
		if (!col) return null;
		// Fresh localStorage (the web client in panel mode, or a reinstall): adopt
		// the existing scratch page by name instead of creating a duplicate — the
		// desktop app and the panel then share ONE scratch page (and draft) via sync.
		try {
			const colGuid = col.getGuid ? col.getGuid() : null;
			const existing = (this.data.getAllRecords() || []).find((r) =>
				this.collGuidOf(r) === colGuid && ((r.getName && r.getName()) || '') === '⚡ Quick Capture');
			if (existing) {
				this.scratchGuid = rowGuid(existing);
				this.persistSettings();
				return existing;
			}
		} catch (e) {}
		const guid = await col.createRecord('⚡ Quick Capture');
		if (!guid) return null;
		let rec = null;
		for (let i = 0; i < 14 && !rec; i++) { await wait(120); rec = this.data.getRecord(guid); }
		if (!rec) return null;
		this.scratchGuid = guid;
		this.persistSettings();
		return rec;
	}

	async homeCollection() {
		const cols = await this.data.getAllCollections();
		if (this.homeCollectionGuid) {
			const c = cols.find((c) => c.getGuid && c.getGuid() === this.homeCollectionGuid);
			if (c) { this.ensureHidden(c); return c; }
		}
		// a dedicated collection just for the scratch page: safe (no required
		// properties) and clearly plugin-owned. Reused if it already exists, and
		// hidden from the sidebar so it isn't clutter.
		const byName = cols.find((c) => c.getName && c.getName() === 'Quick Capture');
		if (byName) { this.homeCollectionGuid = byName.getGuid(); this.ensureHidden(byName); return byName; }
		const nc = await this.data.createCollection();   // creates "New Collection"
		if (!nc) return null;
		try {
			const conf = nc.getConfiguration() || {};
			conf.name = 'Quick Capture';
			conf.icon = conf.icon || 'ti-bolt';
			conf.show_sidebar_items = false;
			conf.show_cmdpal_items = false;  // nor in the command palette's search
			conf.sidebar_display_mode = { mode: 'hidden_completely' };  // never in the sidebar
			await nc.saveConfiguration(conf);
		} catch (e) { /* keep default name if rename fails */ }
		await this.dataCode(nc);
		this.homeCollectionGuid = nc.getGuid ? nc.getGuid() : null;
		return nc;
	}

	// Auto-hide the home collection from the sidebar and the command palette (also
	// migrates collections made by an older version that were visible). Once per load.
	async ensureHidden(col) {
		if (this._hiddenChecked) return;
		this._hiddenChecked = true;
		try {
			const conf = col.getConfiguration();
			if (conf && !(conf.sidebar_display_mode && conf.sidebar_display_mode.mode === 'hidden_completely' && conf.show_cmdpal_items === false)) {
				conf.show_sidebar_items = false;
				conf.show_cmdpal_items = false;
				conf.sidebar_display_mode = { mode: 'hidden_completely' };
				await col.saveConfiguration(conf);
			}
		} catch (e) {}
		await this.dataCode(col);
	}

	// show_cmdpal_items keeps the scratch PAGE out of the command palette, but the
	// collection itself was still listed there (Open Collection, New Page, "Create
	// 'x' in Quick Capture"). Only the collection's own code drops that: no palette
	// entries, and supportsCreateItem true only inside our own createRecord. Written
	// only over Thymer's default stub, never over code someone wrote.
	async dataCode(col) {
		try {
			const guid = col && col.getGuid ? col.getGuid() : null;
			const api = guid ? this.data.getPluginByGuid(guid) : null;
			if (!api || typeof api.saveCode !== 'function' || typeof api.getExistingCodeAndConfig !== 'function') return false;
			const cur = String(((await Promise.resolve(api.getExistingCodeAndConfig())) || {}).code || '').trim();
			if (cur === QC_DATA_CODE.trim()) return true;
			if (cur && !/^class Plugin extends CollectionPlugin \{\s*onLoad\(\) \{\s*\/\/ Put your custom code here\.\.\.\s*\}\s*\}$/.test(cur)) return false;
			await Promise.resolve(api.saveCode(QC_DATA_CODE));
			return true;
		} catch (e) { return false; }
	}

	// Persist to localStorage (NOT saveConfiguration — that reloads the plugin and
	// would close an open modal). Keyed by plugin guid so installs in different
	// workspaces don't clobber each other.
	settingsKey() { return 'qc_settings_v1_' + (this.getGuid ? this.getGuid() : 'default'); }

	loadSettings() {
		try {
			const s = JSON.parse(localStorage.getItem(this.settingsKey()) || '{}');
			this.scratchGuid = s.scratchGuid || null;
			this.homeCollectionGuid = s.homeCollectionGuid || null;
			this.geometry = s.geometry || null;
			this.hotkey = s.hotkey || defaultHotkey();
			this.indentUnder = s.indentUnder === undefined ? true : !!s.indentUnder;
		} catch (e) { this.hotkey = defaultHotkey(); }
	}

	persistSettings() {
		try {
			localStorage.setItem(this.settingsKey(), JSON.stringify({
				scratchGuid: this.scratchGuid,
				homeCollectionGuid: this.homeCollectionGuid,
				geometry: this.geometry,
				hotkey: this.hotkey,
				indentUnder: this.indentUnder,
			}));
		} catch (e) {}
	}

	panelWrapper() {
		const el = this.panel && this.panel.getElement();
		return el ? (el.closest('.panel') || el) : null;
	}

	isDarkTheme() {
		return !!(document.documentElement.classList.contains('is-dark') || document.querySelector('.is-dark'));
	}

	themeSurfaceColor() {
		const probe = document.querySelector('.panels-grid-sidebar');
		const c = probe ? getComputedStyle(probe).backgroundColor : '';
		// The box gets this as its opaque surface, so a see-through value must NEVER
		// pass. The old guard string-matched 'rgba(0, 0, 0, 0)', but this build
		// serialises colours as color(display-p3 …) — and a transparent one comes back
		// as 'color(display-p3 0 0 0 / 0)', which slipped straight through and was
		// painted onto the box, making it (and the translucent footer over it)
		// see-through. VERIFIED live 2026-07-19.
		if (qcIsTransparent(c)) return this.isDarkTheme() ? '#1e1e22' : '#ffffff';
		return c;
	}

	// a border that reads clearly against the workspace (esp. in dark mode, where
	// the modal surface ≈ the background)
	themeBorderColor() {
		return this.isDarkTheme() ? 'rgba(255,255,255,0.22)' : 'rgba(0,0,0,0.16)';
	}

	// softer/lighter shadow in light mode (the deep one looks harsh on white)
	themeShadow() {
		return this.isDarkTheme()
			? '0 20px 70px rgba(0,0,0,.6), 0 4px 14px rgba(0,0,0,.45)'
			: '0 10px 34px rgba(0,0,0,.12), 0 2px 6px rgba(0,0,0,.07)';
	}

	// ---- open / teardown ---------------------------------------------------

	// Panel mode: open the box as soon as the workspace can host it. On a cold
	// web-client load, data (and the scratch page) may not be synced yet — keep
	// retrying quietly instead of toasting failures at the user.
	async autoOpenPanel() {
		for (let i = 0; i < 60 && !this.panel; i++) {
			if (!this.opening) { try { await this.open(true); } catch (e) {} }
			if (!this.panel) await wait(1000);
		}
	}

	// Close leaked scratch-page panels (from interrupted panel-mode cycles) —
	// every panel navigated to the scratch record EXCEPT the live box (identified
	// by its data-qc-modal wrapper, since panel object identity isn't reliable).
	sweepScratchPanels() {
		try {
			const panels = (this.ui.getPanels && this.ui.getPanels()) || [];
			for (const p of panels) {
				try {
					const el = p.getElement && p.getElement();
					if (el && el.closest && el.closest('.panel[data-qc-modal]')) continue;   // the live box
					const rootId = p.getNavigation && p.getNavigation()?.rootId;
					if (!rootId) continue;
					let isScratch = !!this.scratchGuid && rootId === this.scratchGuid;
					if (!isScratch) {
						const r = this.data.getRecord(rootId);
						isScratch = !!r && ((r.getName && r.getName()) || '') === '⚡ Quick Capture';
					}
					if (isScratch) this.ui.closePanel(p);
				} catch (e) {}
			}
		} catch (e) {}
	}

	// Panel mode only: when sync catches up after a (re)load, Thymer re-renders
	// the panels grid and REPLACES the element we tagged as the box — the modal
	// chrome vanishes while this.panel still looks alive. Detect that, tear down
	// cleanly (also closes the now-orphaned panel) and reopen fresh. Runs only in
	// the dedicated panel window, so the "no idle work" doctrine for the main app
	// still holds.
	startPanelWatchdog() {
		if (this.panelWatchdog) return;
		this.panelWatchdog = setInterval(() => {
			if (!this.panelMode || this.opening) return;
			if (this.panel && !document.querySelector('.panel[data-qc-modal]')) {
				try { this.teardown(); } catch (e) {}
				this.autoOpenPanel();
			}
		}, 1500);
	}

	async open(quiet) {
		if (this.panel || this.opening) return;
		this.opening = true;
		try {
			// NOTE: do NOT clear here — the scratch page persists its draft across
			// opens. It's only emptied by Send (which moves the content out).
			const rec = await this.getScratchRecord();
			if (!rec) { if (!quiet) this.toast('Could not open the capture box.'); return; }

			// The plugin instance carries its own workspaceGuid — always right, and
			// available even when no panel is active yet (e.g. right after a web
			// -client reload in panel mode, where the active panel's navigation
			// isn't ready and navigateTo would throw "no workspace guid specified").
			const wsGuid = this.workspaceGuid
				|| this.ui.getActivePanel()?.getNavigation()?.workspaceGuid || null;
			if (!wsGuid) { if (!quiet) this.toast('Could not open the capture box.'); return; }   // not ready — auto-open retries
			const panel = await this.ui.createPanel();
			if (!panel) { if (!quiet) this.toast('Could not open the capture box.'); return; }
			this.panel = panel;

			// Style as a modal IMMEDIATELY — before navigating in content and
			// before the browser paints — so the panel never flashes as a side
			// split. Wait briefly for the panel element if it isn't ready yet.
			let wrapper = this.panelWrapper();
			for (let i = 0; i < 20 && !wrapper; i++) { await wait(16); wrapper = this.panelWrapper(); }
			if (wrapper) this.mountChrome(wrapper);

			try {
				panel.navigateTo({
					type: 'edit_panel', rootId: this.scratchGuid, subId: null, workspaceGuid: wsGuid,
					state: { positions: [this.scratchGuid, 'empty-' + this.scratchGuid, 0, 'L'] },
				});
			} catch (e) {
				// leave nothing half-mounted: clear the panel so a retry starts clean
				this.teardown();
				if (!quiet) this.toast('Could not open the capture box.');
				return;
			}
			try { this.ui.setActivePanel(panel); } catch (e) {}
			this.dest = { kind: 'journal' };

			await wait(350);
			this.placeCaret();
		} finally {
			this.opening = false;
		}
	}

	// Paint the box from the LIVE theme. Split out of mountChrome because the box
	// may mount before the theme has landed (panel mode auto-opens during page
	// load, and a CUSTOM theme also waits on the user's custom CSS) — in that
	// case the first paint is the light-mode fallback and has to be redone.
	applyThemeColors(wrapper) {
		if (!wrapper) return;
		const surface = this.themeSurfaceColor(), border = this.themeBorderColor(), shadow = this.themeShadow();
		wrapper.style.backgroundColor = surface;
		wrapper.style.setProperty('--qc-surface', surface);
		wrapper.style.setProperty('--qc-border', border);
		wrapper.style.setProperty('--qc-shadow', shadow);
	}

	// Panel mode's replacement for watchGrid's re-tinting half. watchGrid is off
	// there (it observed the GRID's style AND wrote grid styles — that ping-pong
	// under the WKWebView's pageZoom was the 100%-CPU storm). This one observes
	// ONLY documentElement's class and writes ONLY the box's own colours, so it
	// cannot feed itself. Plus a few delayed re-tints, because a theme can land
	// without a class mutation (custom CSS arriving late).
	watchPanelTheme(wrapper) {
		[400, 1200, 3000, 8000].forEach((ms) => setTimeout(() => {
			const w = this.panelWrapper();
			if (w) this.applyThemeColors(w);
		}, ms));
		if (this.themeObserver) return;
		this.themeObserver = new MutationObserver(() => {
			const w = this.panelWrapper();
			if (w) this.applyThemeColors(w);
		});
		this.themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme'] });
	}

	mountChrome(wrapper) {
		if (!wrapper) return;
		wrapper.setAttribute('data-qc-modal', '1');
		this.applyThemeColors(wrapper);
		document.body.classList.add('qc-modal-open');
		// createPanel adds a real column to the panels grid; the modal floats
		// (fixed), so collapse that column to 0 — otherwise its slot shows as an
		// empty panel behind the floating window. NOT in panel mode: the box is
		// fullscreen over an opaque curtain, so the grid behind is invisible —
		// and the grid MutationObserver must not exist there (its computed-style
		// read + style writes ping-ponged with Thymer's relayout under the
		// WKWebView's pageZoom into a 100%-CPU microtask storm, 2026-07-12).
		if (!this.panelMode) {
			this.collapseModalTrack(wrapper);
			this.watchGrid(wrapper);
		} else {
			this.watchPanelTheme(wrapper);
		}
		// restore a saved position/size — it floats like a movable notepad
		// (not in panel mode: there the box always fills the whole window)
		if (this.geometry && !this.panelMode) this.applyGeometry(wrapper, this.geometry);

		// drag header (move the window) + close
		const header = document.createElement('div');
		header.className = 'qc-header';
		header.innerHTML = `
			<span class="qc-title"><span class="ti ti-bolt"></span>Quick Capture</span>
			<div class="qc-grow"></div>
			<span class="qc-x" title="Close"><span class="ti ti-x"></span></span>
		`;
		wrapper.appendChild(header);
		this.headerEl = header;
		header.querySelector('.qc-x').addEventListener('click', (e) => { e.stopPropagation(); this.cancel(); });
		if (!this.panelMode) this.attachDrag(wrapper, header);

		// footer with destination + actions
		const footer = document.createElement('div');
		footer.className = 'qc-footer';
		footer.innerHTML = `
			<button class="qc-btn qc-dest"><span class="ti ti-calendar-event"></span><span class="qc-dest-lbl">Today's Journal</span></button>
			<button class="qc-btn qc-indent"><span class="ti ti-indent-increase"></span><span class="qc-indent-lbl"></span></button>
			<div class="qc-spacer"></div>
			<span class="qc-hint">⌘⇧↵ to send</span>
			<button class="qc-btn qc-cancel">Cancel</button>
			<button class="qc-btn qc-send">Send</button>
		`;
		wrapper.appendChild(footer);
		this.footerEl = footer;
		const destBtn = footer.querySelector('.qc-dest');
		destBtn.title = 'Choose destination (' + (qcIsMac() ? '⌘⇧M' : 'Ctrl+Shift+M') + ')';
		destBtn.addEventListener('click', (e) => { e.stopPropagation(); this.toggleDestPicker(); });
		footer.querySelector('.qc-indent').addEventListener('click', (e) => {
			e.stopPropagation();
			this.indentUnder = !this.indentUnder;
			this.persistSettings();
			this.updateIndentBtn();
		});
		this.updateIndentBtn();
		footer.querySelector('.qc-cancel').addEventListener('click', () => this.cancel());
		footer.querySelector('.qc-send').addEventListener('click', () => this.send());

		// resize handle (bottom-right corner) — meaningless in panel mode
		if (!this.panelMode) {
			const grip = document.createElement('div');
			grip.className = 'qc-resize';
			grip.innerHTML = '<span class="ti ti-arrow-down-right"></span>';
			wrapper.appendChild(grip);
			this.resizeEl = grip;
			this.attachResize(wrapper, grip);
		}

		// Cmd/Ctrl+Shift+Enter sends. Shift is REQUIRED: plain Cmd/Ctrl+Enter must
		// fall through to Thymer's checkbox toggle so todos can be created inside
		// the box. NOTE: Escape can't cancel — Thymer (or Electron) swallows it
		// before any JS listener; close via Cancel / the × / the hotkey toggle.
		this.keyHandler = (e) => {
			if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && e.shiftKey) {
				// let the editor's @/date menu take it — but only when actually open
				// (a closed menu lingers in the DOM as display:none)
				const menu = document.querySelector('.cmdpal--inline');
				if (menu && getComputedStyle(menu).display !== 'none') return;
				e.preventDefault(); e.stopPropagation(); this.send();
			}
		};
		document.addEventListener('keydown', this.keyHandler, true);

		// click outside the box closes it — but not clicks on the editor's @/#/date
		// menu or the destination picker (both portaled outside the modal wrapper).
		// Use pointerdown: Thymer swallows mousedown before it reaches JS, but
		// pointerdown propagates. (Not in panel mode: the box IS the window,
		// there is no meaningful "outside".)
		if (!this.panelMode) {
			this.outsideHandler = (e) => {
				const w = this.panelWrapper();
				if (!w || w.contains(e.target)) return;
				if (e.target.closest && (e.target.closest('.cmdpal--inline') || e.target.closest('.qc-pop'))) return;
				this.cancel();
			};
			document.addEventListener('pointerdown', this.outsideHandler, true);
		}
	}

	// Once the modal is position:fixed it leaves the grid flow; the remaining
	// panels reflow and ONE column ends up empty. Collapse that empty column to
	// 0 (real panels → 1fr to fill, dividers keep their px). Must run AFTER the
	// modal is fixed. getBoundingClientRect forces the reflow we read.
	collapseModalTrack(wrapper) {
		const grid = wrapper.parentElement;
		if (!grid || getComputedStyle(grid).display !== 'grid') { this.gridEl = null; return; }
		this.gridEl = grid;
		// Build a template with exactly ONE column per IN-FLOW grid child. The
		// floating modal is position:fixed (out of flow) so it needs no column —
		// dropping it lets the real panels fill the row. Real panels → 1fr,
		// dividers → their px width. Order the children by their VISUAL left edge,
		// not DOM order: Thymer places dividers in explicit columns, so DOM order
		// (panels, then sizers) doesn't match the actual column order once there's
		// more than one workspace panel.
		const inflow = [...grid.children]
			.filter((c) => c !== wrapper && getComputedStyle(c).position !== 'fixed')
			.sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left);
		const cols = inflow.map((c) =>
			(c.classList && c.classList.contains('panel-h-sizer'))
				? Math.max(1, Math.round(c.getBoundingClientRect().width)) + 'px'
				: '1fr'
		);
		if (!cols.length) return;
		const newVal = cols.join(' ');
		// idempotent so the grid observer (which re-collapses after Thymer
		// re-lays-out, e.g. on a theme switch) doesn't loop on its own writes
		if (grid.style.gridTemplateColumns === newVal) return;
		grid.style.setProperty('grid-template-columns', newVal, 'important');
	}

	// Re-collapse the empty column whenever Thymer re-lays-out the grid (theme
	// switch, window resize, …) — otherwise the empty panel reappears. Also keeps
	// the modal surface/border matched to the current theme.
	watchGrid(wrapper) {
		if (!this.gridEl || this.gridObserver) return;
		this.gridObserver = new MutationObserver(() => {
			const w = this.panelWrapper();
			if (!w) return;
			this.collapseModalTrack(w);
			w.style.backgroundColor = this.themeSurfaceColor();
			w.style.setProperty('--qc-surface', this.themeSurfaceColor());
			w.style.setProperty('--qc-border', this.themeBorderColor());
			w.style.setProperty('--qc-shadow', this.themeShadow());
		});
		// grid style changes (Thymer relayout / resize) AND theme (is-dark/light)
		// changes — the latter may not touch the grid but must re-tint the modal
		this.gridObserver.observe(this.gridEl, { attributes: true, attributeFilter: ['style'] });
		this.gridObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
	}

	// ---- drag / resize / geometry ------------------------------------------

	applyGeometry(wrapper, g) {
		const W = window.innerWidth, H = window.innerHeight;
		const width = Math.min(Math.max(360, g.width || 720), W);
		const height = Math.min(Math.max(220, g.height || 480), H);
		// keep the WHOLE window on-screen (never partly off the right/bottom edge)
		const left = Math.min(Math.max(0, g.left), Math.max(0, W - width));
		const top = Math.min(Math.max(0, g.top), Math.max(0, H - height));
		const S = (k, v) => wrapper.style.setProperty(k, v, 'important');
		S('left', left + 'px'); S('top', top + 'px');
		S('right', 'auto'); S('margin-inline', '0');
		S('width', width + 'px'); S('height', height + 'px');
		S('min-height', '0'); S('max-height', 'none');
	}

	currentGeometry(wrapper) {
		const r = wrapper.getBoundingClientRect();
		return { left: Math.round(r.left), top: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) };
	}

	saveGeometry(wrapper) {
		this.geometry = this.currentGeometry(wrapper);
		this.persistSettings();   // localStorage write — safe mid-session (no reload)
	}

	attachDrag(wrapper, handle) {
		handle.addEventListener('pointerdown', (e) => {
			if (e.button !== 0 || e.target.closest('.qc-x')) return;
			const start = this.currentGeometry(wrapper);
			this.applyGeometry(wrapper, start);   // switch to explicit positioning
			const sx = e.clientX, sy = e.clientY;
			const move = (ev) => {
				const W = window.innerWidth, H = window.innerHeight;
				const left = Math.min(Math.max(0, start.left + ev.clientX - sx), W - 80);
				const top = Math.min(Math.max(0, start.top + ev.clientY - sy), H - 40);
				wrapper.style.setProperty('left', left + 'px', 'important');
				wrapper.style.setProperty('top', top + 'px', 'important');
			};
			const up = () => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); this.saveGeometry(wrapper); };
			document.addEventListener('pointermove', move);
			document.addEventListener('pointerup', up);
			e.preventDefault();
		});
	}

	attachResize(wrapper, grip) {
		grip.addEventListener('pointerdown', (e) => {
			if (e.button !== 0) return;
			const start = this.currentGeometry(wrapper);
			this.applyGeometry(wrapper, start);
			const sx = e.clientX, sy = e.clientY;
			const move = (ev) => {
				const W = window.innerWidth, H = window.innerHeight;
				const width = Math.min(Math.max(360, start.width + ev.clientX - sx), W - start.left - 4);
				const height = Math.min(Math.max(220, start.height + ev.clientY - sy), H - start.top - 4);
				wrapper.style.setProperty('width', width + 'px', 'important');
				wrapper.style.setProperty('height', height + 'px', 'important');
			};
			const up = () => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); this.saveGeometry(wrapper); };
			document.addEventListener('pointermove', move);
			document.addEventListener('pointerup', up);
			e.preventDefault(); e.stopPropagation();
		});
	}

	placeCaret() {
		const el = this.panel && this.panel.getElement();
		const lines = el && el.querySelectorAll('.line-div');
		const line = lines && lines.length ? lines[lines.length - 1] : null; // end, to continue a draft
		if (!line) return;
		const r = line.getBoundingClientRect();
		const o = { bubbles: true, cancelable: true, composed: true, clientX: r.x + 18, clientY: r.y + r.height / 2, pointerId: 1, pointerType: 'mouse', button: 0, buttons: 1, isPrimary: true };
		line.dispatchEvent(new PointerEvent('pointerdown', o));
		line.dispatchEvent(new PointerEvent('pointerup', { ...o, buttons: 0 }));
	}

	teardown() {
		document.body.classList.remove('qc-modal-open');
		if (this.keyHandler) { document.removeEventListener('keydown', this.keyHandler, true); this.keyHandler = null; }
		if (this.outsideHandler) { document.removeEventListener('pointerdown', this.outsideHandler, true); this.outsideHandler = null; }
		this.closeDestPicker();
		if (this.headerEl) { this.headerEl.remove(); this.headerEl = null; }
		if (this.footerEl) { this.footerEl.remove(); this.footerEl = null; }
		if (this.resizeEl) { this.resizeEl.remove(); this.resizeEl = null; }
		if (this.gridObserver) { this.gridObserver.disconnect(); this.gridObserver = null; }
		// Move the floating modal OUT of the panels grid and hide it BEFORE closing.
		// Closing it while it's still a grid child makes Thymer briefly recompute
		// the grid into an equal 2-column split (the workspace panel shrinks to
		// half) before removing the panel — a visible flash. On <body> + display:
		// none it vanishes instantly and the grid stays put until Thymer removes
		// the panel, then cleanly collapses to the remaining panel(s).
		const wrapper = this.panelWrapper();
		if (wrapper) { document.body.appendChild(wrapper); wrapper.style.setProperty('display', 'none', 'important'); }
		if (this.panel) { try { this.ui.closePanel(this.panel); } catch (e) {} this.panel = null; }
		if (wrapper) setTimeout(() => { try { if (wrapper.isConnected) wrapper.remove(); } catch (e) {} }, 400);
		this.gridEl = null;
		// content PERSISTS in the scratch page until Send empties it (or the user
		// clears it) — so we do NOT clear on close/cancel.
		this.persistSettings();
	}

	cancel() {
		// Panel mode: the box IS the window, so "close" means hiding the OS panel
		// (the helper's job) — never tear down the editor. The draft stays, as always.
		if (this.panelMode) { this.panelNotify('hide'); return; }
		this.teardown();
	}

	// Tell the native helper (the WKWebView host) about panel-worthy events
	// ('hide', 'sent'). Silently a no-op in a plain browser tab / the desktop app.
	panelNotify(event) {
		try { window.webkit?.messageHandlers?.qcPanel?.postMessage?.(event); } catch (e) {}
	}

	updateIndentBtn() {
		const btn = this.footerEl && this.footerEl.querySelector('.qc-indent');
		if (!btn) return;
		btn.classList.toggle('qc-on', !!this.indentUnder);
		btn.querySelector('.qc-indent-lbl').textContent = this.indentUnder ? 'Nest under target' : 'Place after target';
		btn.title = this.indentUnder
			? 'Content is placed indented under the chosen heading/line (click to place after it instead)'
			: 'Content is placed directly after the chosen heading/line (click to indent under it instead)';
	}

	// ---- destination picker ------------------------------------------------

	toggleDestPicker() {
		if (this.popEl) { this.closeDestPicker(); return; }
		const pop = document.createElement('div');
		pop.className = 'qc-pop';
		pop.innerHTML = `
			<input class="qc-pop-input" type="text" placeholder='Search pages, lines, or a date for the Journal (e.g. "tomorrow")…' />
			<div class="qc-pop-list"></div>
		`;
		this.footerEl.appendChild(pop);
		this.popEl = pop;
		const input = pop.querySelector('.qc-pop-input');
		const list = pop.querySelector('.qc-pop-list');
		// snapshot the full record set (names are searched directly, like the
		// native @ picker) and load collection names for the result labels
		try { this.recordsCache = this.data.getAllRecords() || []; } catch (e) { this.recordsCache = []; }
		this.loadCollMap();
		this.renderDefaultDestOptions(list);
		input.addEventListener('input', () => {
			if (this.newNoteMode) { if (this.newNoteFilter) this.newNoteFilter(); return; }   // new note: filters the collections (step 1) or is the title (step 2)
			clearTimeout(this.searchTimer);
			const q = input.value.trim();
			this.searchTimer = setTimeout(() => this.runDestSearch(q, list), 180);
		});
		input.addEventListener('mousedown', (e) => e.stopPropagation());
		// arrow-key navigation + Enter to pick the highlighted result
		input.addEventListener('keydown', (e) => {
			if (e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); this.setDestSel(this.destSel + 1); }
			else if (e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); this.setDestSel(this.destSel - 1); }
			else if (e.key === 'Enter') {
				e.preventDefault(); e.stopPropagation();
				const o = this.destOpts[this.destSel];
				if (o) o.pick();
			}
		});
		setTimeout(() => input.focus(), 0);
	}

	closeDestPicker() {
		this.newNoteMode = false;
		this.newNoteFilter = null;
		clearTimeout(this.searchTimer);
		this.searchToken++;   // invalidate in-flight searches
		this.destOpts = []; this.destSel = 0;
		this.hideLinePreview();
		if (this.popEl) { this.popEl.remove(); this.popEl = null; }
	}

	// Floating preview of a line's FULL text on hover (rows only show a snippet).
	showLinePreview(rowEl, text, ctx, parts) {
		this.hideLinePreview();
		if (!text) return;
		const box = document.createElement('div');
		box.className = 'qc-linepreview';
		const t = document.createElement('div'); t.className = 'qc-lp-text';
		t.innerHTML = qcHighlightAll(text, parts);   // bold every match, like the row
		box.appendChild(t);
		if (ctx) { const c = document.createElement('div'); c.className = 'qc-lp-ctx'; c.textContent = ctx; box.appendChild(c); }
		document.body.appendChild(box);
		this.linePreviewEl = box;
		// Sit right next to the hovered row: below it, or above it when the row is
		// near the viewport bottom. Cap the height to the space on the chosen side
		// so it always fits AND stays attached to the row (never pinned to an edge).
		const r = rowEl.getBoundingClientRect();
		const vw = window.innerWidth, vh = window.innerHeight;
		const belowSpace = vh - r.bottom - 12, aboveSpace = r.top - 12;
		const placeBelow = belowSpace >= aboveSpace;
		// 60vh suits the big app window; the panel window is small, so there the
		// preview may use nearly the full height (it long-truncated otherwise)
		const capRatio = this.panelMode ? 0.92 : 0.6;
		box.style.maxHeight = Math.max(80, Math.min(placeBelow ? belowSpace : aboveSpace, Math.round(vh * capRatio))) + 'px';
		const bw = box.offsetWidth, bh = box.offsetHeight;
		const left = Math.max(8, Math.min(r.left, vw - bw - 8));
		let top = placeBelow ? r.bottom + 4 : r.top - bh - 4;
		top = Math.max(8, Math.min(top, vh - bh - 8));
		box.style.left = left + 'px';
		box.style.top = top + 'px';
	}
	hideLinePreview() {
		if (this.linePreviewEl) { this.linePreviewEl.remove(); this.linePreviewEl = null; }
	}

	// collection guid -> display name, for the "which collection" result labels
	async loadCollMap() {
		try {
			const cols = await this.data.getAllCollections();
			const m = {};
			for (const c of (cols || [])) {
				let g = null; try { g = c._getRow ? c._getRow().guid : (c.guid || null); } catch (e) {}
				// _getRow() does not reliably carry a guid for COLLECTIONS; without this
				// fallback collMap can end up empty, which also costs the collection
				// name on every result row (Move To needed the same fallback)
				if (!g && c.getGuid) { try { g = c.getGuid(); } catch (e) {} }
				let n = ''; try { n = c.getName ? c.getName() : ''; } catch (e) {}
				// PluginCollectionAPI has NO getIcon() — it returns undefined, so icons were
				// always empty. The icon lives in getConfiguration().icon, and only ti-*
				// values are font glyphs (Thymer also stores CSS 'fill' icons like
				// blinking-dot, which would render blank as a class).
				let ic = ''; try { ic = collIconFromConf(c.getConfiguration()); } catch (e) {}
				if (g) m[g] = { name: n, icon: ic };
			}
			this.collMap = m;
		} catch (e) {}
	}
	collName(guid) { const e = guid && this.collMap[guid]; return (e && e.name) || ''; }
	collIcon(guid) { const e = guid && this.collMap[guid]; return (e && e.icon) || ''; }
	collGuidOf(rec) { try { return rec && rec._getRow ? rec._getRow().pguid : null; } catch (e) { return null; } }
	// Icon shown before a result, native-style: the record's own icon, else its
	// collection's icon, else a generic page glyph.
	iconOf(rec, collGuid) {
		let ic = null;
		try { ic = rec && rec.getIcon ? (rec.getIcon(true) || rec.getIcon()) : null; } catch (e) {}
		return ic || this.collIcon(collGuid) || 'ti-file';
	}
	iconForPage(pageGuid, collGuid) {
		let rec = null; try { rec = pageGuid ? this.data.getRecord(pageGuid) : null; } catch (e) {}
		return this.iconOf(rec, collGuid);
	}

	// Register a selectable row: click picks, pointer hover moves the highlight,
	// and arrow keys walk the same list.
	addDestOpt(list, el, pick) {
		const idx = this.destOpts.length;
		el.addEventListener('click', (e) => { e.stopPropagation(); pick(); });
		el.addEventListener('pointermove', () => { if (this.destSel !== idx) this.setDestSel(idx); });
		this.destOpts.push({ el, pick });
		if (idx === this.destSel) el.classList.add('qc-active');
		list.appendChild(el);
	}

	setDestSel(i) {
		const n = this.destOpts.length;
		if (!n) return;
		const next = ((i % n) + n) % n;   // wrap around
		const prev = this.destOpts[this.destSel];
		if (prev) prev.el.classList.remove('qc-active');
		this.destSel = next;
		const cur = this.destOpts[next];
		cur.el.classList.add('qc-active');
		try { cur.el.scrollIntoView({ block: 'nearest' }); } catch (e) {}
	}

	// New-note flow: type a title, pick a collection, and the capture becomes the
	// body of a freshly created note there. Ported from the Move To plugin, where
	// it came in as community PR #1 by phildrysdale1 — credit to him for the idea
	// and the original implementation. Adapted to Quick Capture's flow: picking
	// sets the destination, and Send creates the note. Two steps like Whiteboard's
	// (his ruling 2026-10-04: the old single field asked for a title while it
	// looked like it searched the collections):
	//   1. find and pick the collection, the field filters the list;
	//   2. the title, prefilled with the capture's first line and selected, then
	//      "Create page in <collection>" (Enter).
	// Title left as prefilled = at Send the first line BECOMES the title and
	// leaves the body (only a plain-text line without children).
	async pickNewNote(list) {
		const input = this.popEl && this.popEl.querySelector('.qc-pop-input');
		if (!input) return;
		clearTimeout(this.searchTimer);
		const my = ++this.searchToken;
		this.newNoteMode = true;
		this.newNoteFilter = null;
		input.value = '';
		input.placeholder = 'Find a collection';
		this.resetDestList(list);
		this.sec(list, 'Loading collections');
		input.focus();

		let collections = [];
		try { collections = await this.data.getAllCollections(); } catch (e) {}
		if (!this.popEl || !this.newNoteMode || my !== this.searchToken) return;
		collections = (collections || []).filter((c) => {
			try {
				if (!c || typeof c.createRecord !== 'function') return false;
				// journals own their pages by date, so a new note can't live there
				if (c.isJournalPlugin && c.isJournalPlugin()) return false;
				// our own hidden scratch collection is not a real destination
				if (this.homeCollectionGuid && c.getGuid && c.getGuid() === this.homeCollectionGuid) return false;
				return true;
			} catch (e) { return false; }
		});
		collections.sort((a, b) => {
			let an = '', bn = '';
			try { an = a.getName() || ''; } catch (e) {}
			try { bn = b.getName() || ''; } catch (e) {}
			return an.localeCompare(bn);
		});

		const paint = () => {
			const q = input.value.trim().toLowerCase();
			this.resetDestList(list);
			this.sec(list, 'New note');
			const back = document.createElement('div');
			back.className = 'qc-opt';
			back.innerHTML = `<span class="ti ti-arrow-left"></span><span class="qc-opt-text">Back to destinations</span>`;
			this.addDestOpt(list, back, () => {
				this.newNoteMode = false;
				this.newNoteFilter = null;
				this.searchToken++;
				input.value = '';
				input.placeholder = 'Search pages, lines, or a date for the Journal (e.g. "tomorrow")…';
				this.renderDefaultDestOptions(list);
				input.focus();
			});
			const shown = collections.filter((c) => { try { return !q || (c.getName() || '').toLowerCase().includes(q); } catch (e) { return false; } });
			this.sec(list, shown.length ? 'Choose a collection' : 'No collection matches');
			for (const c of shown) {
				let name = 'Collection', icon = '';
				try { name = c.getName() || name; } catch (e) {}
				try { icon = collIconFromConf(c.getConfiguration()); } catch (e) {}
				icon = icon || 'ti-folder';
				const opt = document.createElement('div');
				opt.className = 'qc-opt';
				opt.innerHTML = `<span class="ti ${esc(icon)}"></span><span class="qc-opt-text">${esc(name)}</span>`;
				this.addDestOpt(list, opt, () => this.pickNewNoteTitle(list, c, name, icon));
			}
			if (this.destOpts.length > 1) this.setDestSel(1);
		};
		this.newNoteFilter = paint;
		paint();
	}

	async pickNewNoteTitle(list, c, name, icon) {
		const input = this.popEl && this.popEl.querySelector('.qc-pop-input');
		if (!input) return;
		this.newNoteFilter = null;
		const my = ++this.searchToken;
		const first = await this.captureFirstTitle();
		if (!this.popEl || !this.newNoteMode || my !== this.searchToken) return;
		input.value = first.text;
		input.placeholder = 'Title for the new page';
		input.focus();
		try { input.select(); } catch (e) {}
		this.resetDestList(list);
		this.sec(list, 'New page in ' + name);
		const back = document.createElement('div');
		back.className = 'qc-opt';
		back.innerHTML = `<span class="ti ti-arrow-left"></span><span class="qc-opt-text">Back to collections</span>`;
		this.addDestOpt(list, back, () => this.pickNewNote(list));
		const create = document.createElement('div');
		create.className = 'qc-opt';
		create.innerHTML = `<span class="ti ti-file-plus"></span><span class="qc-opt-text">Create page in ${esc(name)}</span>`;
		this.addDestOpt(list, create, () => {
			const title = input.value.trim();
			// left as prefilled, or empty: the capture's first line decides at Send
			const fromFirst = !title || title === first.text;
			this.newNoteMode = false;
			this.setDest({ kind: 'new', collection: c, name: title, collectionName: name, icon, fromFirst });
			this.closeDestPicker();
		});
		this.setDestSel(1);
	}

	// The capture's first line as a page title: { text, guid }. text is '' when
	// that line is not PLAIN text (refs, tags, dates or links can't be a title).
	async captureFirstTitle() {
		const none = { text: '', guid: null };
		const rec = this.scratchGuid && this.data.getRecord(this.scratchGuid);
		if (!rec) return none;
		let items = [];
		try { items = (await rec.getLineItems()) || []; } catch (e) { return none; }
		const first = topLevelItems(items, this.scratchGuid).find((li) => !isEmptyLine(li));
		if (!first) return none;
		const ts = liRaw(first).ts;
		if (!Array.isArray(ts) || !ts.length) return none;
		let text = '';
		for (let i = 0; i < ts.length; i += 2) {
			if (ts[i] !== 'text' || typeof ts[i + 1] !== 'string') return { text: '', guid: liGuid(first) };
			text += ts[i + 1];
		}
		return { text: text.trim().slice(0, 120), guid: liGuid(first) };
	}

	resetDestList(list) {
		this.destOpts = []; this.destSel = 0;
		this.hideLinePreview();
		list.innerHTML = '';
	}

	sec(list, text) {
		const h = document.createElement('div'); h.className = 'qc-sec'; h.textContent = text;
		list.appendChild(h);
	}

	renderDefaultDestOptions(list) {
		this.resetDestList(list);
		this.sec(list, 'Default');
		const journal = document.createElement('div');
		journal.className = 'qc-opt';
		journal.innerHTML = `<span class="ti ti-calendar-event"></span><span class="qc-opt-text">Today's Journal</span><span class="qc-opt-sub">default</span>`;
		this.addDestOpt(list, journal, () => { this.setDest({ kind: 'journal' }); this.closeDestPicker(); });
		const newNote = document.createElement('div');
		newNote.className = 'qc-opt';
		newNote.innerHTML = `<span class="ti ti-file-plus"></span><span class="qc-opt-text">New note in a collection</span>`;
		this.addDestOpt(list, newNote, () => this.pickNewNote(list));
		this.sec(list, 'Type to search pages, lines, or a date');
	}

	// Parse a typed query as a journal date ("tomorrow", "next friday",
	// "2026-07-20", "yesterday", ...). Returns { dt, label } or null, where dt is
	// a `{toDate()}` shim (getJournalRecord only calls .toDate()), so this works
	// whether or not Thymer's rich DateTime parser is reachable from a plugin.
	parseJournalDate(q) {
		const s = String(q || '').trim();
		if (!s) return null;
		let d = null;
		try {
			const DT = (typeof DateTime !== 'undefined') ? DateTime : (typeof globalThis !== 'undefined' ? globalThis.DateTime : null);
			if (DT && DT.parseDateTimeString) {
				const dt = DT.parseDateTimeString(s);
				if (dt && typeof dt.toDate === 'function') { const jd = dt.toDate(); if (jd && !isNaN(jd.getTime())) d = jd; }
			}
		} catch (e) {}
		if (!d) d = fallbackJournalDate(s);
		if (!d) return null;
		const label = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).replace(',', '');
		const jd = d;
		return { dt: { toDate: () => jd }, label };
	}

	// Search pages by NAME (over the full record set, like the native @ picker —
	// a title match is what makes a page a good destination) and lines by their
	// text. "+" is an AND: every part must appear. Pages are ranked by match
	// quality (exact > prefix > word-start > substring) so the strongest titles
	// surface first, and each result shows the collection it lives in.
	async runDestSearch(q, list) {
		if (!q) { this.renderDefaultDestOptions(list); return; }
		const my = ++this.searchToken;
		const parts = q.split('+').map((p) => qcNorm(p)).filter(Boolean);
		if (!parts.length) { this.renderDefaultDestOptions(list); return; }
		const jdate = this.parseJournalDate(q);   // a "Journal · <date>" row when the query reads as a date
		const terms = new Set();
		for (const p of parts) {
			terms.add(p);
			const w = p.split(/\s+/).filter((x) => x.length >= 2).sort((a, b) => b.length - a.length)[0];
			if (w) terms.add(w);
		}
		const pageSeen = new Set(), lineSeen = new Set();
		const pages = [], lines = [];
		const addPage = (rec, guid, name) => {
			if (!guid || guid === this.scratchGuid || pageSeen.has(guid)) return;
			pageSeen.add(guid);
			pages.push({ rec, guid, name: name || 'Untitled', collGuid: this.collGuidOf(rec), score: qcNameScore(qcNorm(name), parts) });
		};
		const sortPages = () => pages.sort((a, b) => b.score - a.score || a.name.length - b.name.length || a.name.localeCompare(b.name));
		const considerLine = (guid, segments, pageFn) => {
			if (!guid || lineSeen.has(guid) || lines.length >= 40) return;
			lineSeen.add(guid);
			// text match FIRST — pageFn (getRecord + getName) only runs for hits
			const text = this.displayText(segments).trim();
			if (!text) return;
			const lt = qcNorm(text);
			if (!parts.every((p) => lt.includes(p))) return;
			let info = null;
			try { info = pageFn(); } catch (e) {}
			if (!info || !info.guid || info.guid === this.scratchGuid) return;
			lines.push({ lineGuid: guid, pageGuid: info.guid, text, page: info.name || '', collGuid: info.collGuid || null });
		};
		// 1) PAGES — scan every record's title. Comprehensive and instant: the
		//    record set is the whole workspace map (not the virtualised lines),
		//    so title matches can't be missed the way a line-ranked search misses
		//    thin pages. Also seeds line search with loaded content below.
		for (const rec of this.recordsCache) {
			const guid = rowGuid(rec);
			if (!guid || guid === this.scratchGuid || pageSeen.has(guid)) continue;
			const name = (rec.getName && rec.getName()) || '';
			if (!name || !parts.every((p) => qcNorm(name).includes(p))) continue;
			addPage(rec, guid, name);
		}
		sortPages();
		// loaded lines directly (reliable substring AND; sees just-typed text),
		// cheap raw-text prefilter + time budget, rendered immediately
		const byGuid = (window.g_universe && window.g_universe.itemsByGuid) || {};
		const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
		const t0 = nowMs();
		for (const guid in byGuid) {
			if (lines.length >= 40 || nowMs() - t0 > 150) break;
			const it = byGuid[guid];
			if (!it || it.is_deleted || it.is_trashed || it.type === 'document') continue;
			const pg = qcRguid(it);
			if (!pg || pg === this.scratchGuid) continue;
			const ts = it.text_segments;
			if (!ts || !ts.length) continue;
			let raw = '';
			for (let i = 0; i + 1 < ts.length; i += 2) { if (typeof ts[i + 1] === 'string') raw += ts[i + 1] + ' '; }
			const rawNorm = qcNorm(raw);
			if (!parts.some((p) => rawNorm.includes(p))) continue;
			considerLine(it.guid || guid, segmentsFromState(it), () => {
				const r = this.data.getRecord(pg);
				return r ? { guid: pg, name: r.getName && r.getName(), collGuid: this.collGuidOf(r) } : null;
			});
		}
		this.renderDestResults(list, pages, lines, parts, true, jdate);
		// 2) workspace-wide search: extra LINE matches beyond what's loaded, plus
		//    a safety net for any title match the record snapshot might have
		//    missed. Merged in when it arrives (token-guarded).
		for (const t of terms) {
			let res;
			try { res = await this.data.searchByQuery(t, 60); } catch (e) { res = {}; }
			if (my !== this.searchToken) return;
			for (const r of res.records || []) {
				const g = rowGuid(r);
				if (!g || g === this.scratchGuid || pageSeen.has(g)) continue;
				const name = (r.getName && r.getName()) || '';
				if (!parts.every((p) => qcNorm(name).includes(p))) continue;   // NAME match only
				addPage(r, g, name);
			}
			for (const li of res.lines || []) {
				considerLine(li.guid, li.segments, () => {
					const r = li.getRecord && li.getRecord();
					return r ? { guid: rowGuid(r), name: r.getName && r.getName(), collGuid: this.collGuidOf(r) } : null;
				});
			}
		}
		if (my !== this.searchToken) return;
		sortPages();
		this.renderDestResults(list, pages, lines, parts, false, jdate);
	}

	renderDestResults(list, pages, lines, parts, searching, jdate) {
		this.resetDestList(list);
		if (jdate) {
			this.sec(list, 'Journal');
			const j = document.createElement('div');
			j.className = 'qc-opt';
			j.innerHTML = `<span class="ti ti-calendar-event"></span><span class="qc-opt-text">Journal · ${esc(jdate.label)}</span>`;
			this.addDestOpt(list, j, () => { this.setDest({ kind: 'journal', date: jdate.dt, dateLabel: jdate.label }); this.closeDestPicker(); });
		}
		if (!pages.length && !lines.length) {
			if (!jdate) {
				const e = document.createElement('div'); e.className = 'qc-opt';
				e.textContent = searching ? 'Searching…' : 'No pages or lines found';
				list.appendChild(e);
			}
			return;
		}
		if (pages.length) {
			this.sec(list, 'Pages');
			for (const p of pages.slice(0, 40)) {
				const coll = this.collName(p.collGuid);
				const opt = document.createElement('div');
				opt.className = 'qc-opt';
				opt.innerHTML = `<span class="ti ${esc(this.iconOf(p.rec, p.collGuid))}"></span><span class="qc-opt-text">${qcSnippetHTML(p.name, parts)}</span>`;
				opt.title = p.name + (coll ? ' · ' + coll : '');
				this.addDestOpt(list, opt, () => this.pickPage(p.rec, list));
			}
		}
		if (lines.length) {
			this.sec(list, 'Lines');
			for (const l of lines.slice(0, 20)) {
				const coll = this.collName(l.collGuid);
				const opt = document.createElement('div');
				opt.className = 'qc-opt';
				opt.innerHTML = `<span class="ti ${esc(this.iconForPage(l.pageGuid, l.collGuid))}"></span><span class="qc-opt-text">${qcSnippetHTML(l.text, parts)}</span>` + (l.page ? `<span class="qc-opt-sub">${esc(l.page)}</span>` : '');
				// full-text hover preview (a line can be a whole paragraph the row
				// snippet truncates); replaces the raw browser title tooltip
				const ctx = [l.page, coll].filter(Boolean).join(' · ');
				opt.addEventListener('mouseenter', () => this.showLinePreview(opt, l.text, ctx, parts));
				opt.addEventListener('mouseleave', () => this.hideLinePreview());
				this.addDestOpt(list, opt, () => this.pickLine(l));
			}
		}
	}

	pickLine(l) {
		this.setDest({ kind: 'line', guid: l.lineGuid, pageGuid: l.pageGuid, name: truncate(l.text, 34), pageName: l.page, icon: this.iconForPage(l.pageGuid, l.collGuid) });
		this.closeDestPicker();
	}

	async pickPage(rec, list) {
		const guid = rowGuid(rec);
		const name = rec.getName ? rec.getName() : 'Page';
		const icon = this.iconOf(rec, this.collGuidOf(rec));   // carried onto the dest so the button matches the result row
		// look for headings to offer section placement, and whether the page has
		// any real content (so Top vs Bottom is a meaningful choice)
		let headings = [], hasContent = false;
		try {
			const items = await rec.getLineItems();
			// getLineItems() is FLAT and NOT in document order (all top-level lines
			// first, then children), so a nested heading used to be listed last.
			// outlineHeadings walks the tree depth-first and reports how many HEADINGS
			// each one sits under. QC captures text, it never moves existing lines, so
			// there is nothing to exclude — hence the empty skip set.
			headings = outlineHeadings(items, guid, new Set());
			hasContent = topLevelItems(items, guid).some((li) => !isEmptyLine(li));
		} catch (e) {}
		// empty page: top and bottom are the same, so skip the chooser
		if (!hasContent) { this.setDest({ kind: 'page', guid, name, icon }); this.closeDestPicker(); return; }
		// render the placement chooser (also arrow-navigable). Bottom is the
		// default (highlighted first); Top prepends above existing content.
		this.resetDestList(list);
		this.sec(list, name + ' · where?');
		// Top is listed first, but Bottom stays the default selection (see setDestSel below).
		const top = document.createElement('div');
		top.className = 'qc-opt';
		top.innerHTML = `<span class="ti ti-arrow-bar-to-up"></span><span class="qc-opt-text">Top of page</span>`;
		this.addDestOpt(list, top, () => { this.setDest({ kind: 'page', guid, name, atTop: true, icon }); this.closeDestPicker(); });
		const bottomIdx = this.destOpts.length;
		const bottom = document.createElement('div');
		bottom.className = 'qc-opt';
		bottom.innerHTML = `<span class="ti ti-arrow-bar-to-down"></span><span class="qc-opt-text">Bottom of page</span><span class="qc-opt-sub">default</span>`;
		this.addDestOpt(list, bottom, () => { this.setDest({ kind: 'page', guid, name, icon }); this.closeDestPicker(); });
		for (const h of headings) {
			if (!h.guid) continue;
			const opt = document.createElement('div');
			// indent by OUTLINE depth, label with the REAL level: a text badge, because
			// Thymer's font has ti-h-1 but not every ti-h-N (missing ones render blank)
			opt.className = 'qc-opt';
			opt.style.paddingLeft = (10 + Math.min(h.depth, 6) * 14) + 'px';
			opt.innerHTML = `<span class="qc-hlvl">H${h.size}</span><span class="qc-opt-text">${esc(h.text || 'Heading')}</span>`;
			this.addDestOpt(list, opt, () => { this.setDest({ kind: 'page', guid, name, afterHeadingGuid: h.guid, headingText: h.text, icon }); this.closeDestPicker(); });
		}
		// keep Bottom highlighted as the default (Enter picks it), even though Top is first
		this.setDestSel(bottomIdx);
	}

	setDest(dest) {
		this.dest = dest;
		const lbl = this.footerEl && this.footerEl.querySelector('.qc-dest-lbl');
		const icon = this.footerEl && this.footerEl.querySelector('.qc-dest .ti');
		if (!lbl) return;
		if (dest.kind === 'journal') { lbl.textContent = dest.dateLabel ? ('Journal · ' + dest.dateLabel) : "Today's Journal"; if (icon) icon.className = 'ti ti-calendar-event'; }
		else if (dest.kind === 'new') {
			lbl.textContent = dest.name || ('New page in ' + (dest.collectionName || 'collection'));
			lbl.title = 'New note in ' + (dest.collectionName || 'collection');
			if (icon) icon.className = 'ti ti-file-plus';
		}
		else if (dest.kind === 'line') {
			lbl.textContent = dest.name;
			lbl.title = dest.pageName ? `${dest.pageName} › ${dest.name}` : dest.name;
			if (icon) icon.className = 'ti ' + (dest.icon || 'ti-align-left');
		} else {
			lbl.textContent = dest.afterHeadingGuid ? `${dest.name} › ${dest.headingText || 'heading'}`
				: dest.atTop ? `${dest.name} › Top` : dest.name;
			if (icon) icon.className = 'ti ' + (dest.icon || 'ti-file');
		}
	}

	// Display text of a line's segments (refs resolve to their title/page name).
	displayText(segments) {
		return (segments || [])
			.map((s) => {
				if (typeof s.text === 'string') return s.text;
				const t = s.text || {};
				if (s.type === 'ref') {
					if (t.title) return t.title;
					try { const r = t.guid && this.data.getRecord(t.guid); if (r && r.getName) return r.getName(); } catch (e) {}
					return '↗';
				}
				return t.title || t.text || t.name || '';
			})
			.join('');
	}

	// ---- send --------------------------------------------------------------

	async resolveJournalRecord(dt) {
		const cols = await this.data.getAllCollections();
		const wsGuid = this.ui.getActivePanel()?.getNavigation()?.workspaceGuid
			|| (typeof window !== 'undefined' && window.g_universe && window.g_universe.workspaceGuid) || null;
		const userGuid = await this.currentUserGuid();
		if (!userGuid) return null;
		for (const c of cols) {
			try {
				if (c.isJournalPlugin && c.isJournalPlugin()) {
					// getJournalRecord({workspaceGuid, guid}, date?) — `guid` is the
					// USER guid (the journal is per-user); date omitted = today.
					// Passing the collection guid here creates a PARALLEL/duplicate
					// journal page, so it must be the user guid.
						// dt (a DateTime) omitted = today; otherwise that date's journal
						return await c.getJournalRecord({ workspaceGuid: wsGuid, guid: userGuid }, dt);
				}
			} catch (e) {}
		}
		return null;
	}

	async currentUserGuid() {
		// Every strategy must yield a STRING: ref.guid is interpolated into the
		// journal record id, so an object here mints a page called
		// S-<coll>-[object Object]-0-<date> that breaks Markdown Mirror sync.
		const str = (g) => (typeof g === 'string' && g.length ? g : null);
		try {
			if (typeof window !== 'undefined' && window.g_universe && str(window.g_universe.userId)) return window.g_universe.userId;
		} catch (e) {}
		try {
			const us = await this.data.getActiveUsers();
			if (us && us.length) {
				const self = us.find((u) => u && (u.is_self || (u._getRow && u._getRow().is_self))) || us[0];
				const g = self && (self.guid || (self._getRow && self._getRow().guid));
				if (str(g)) return g;
			}
		} catch (e) {}
		return null;
	}

	async send() {
		const rec = this.scratchGuid && this.data.getRecord(this.scratchGuid);
		if (!rec) { this.toast('Nothing to send.'); return; }
		const items = await rec.getLineItems();
		const roots = topLevelItems(items, this.scratchGuid).filter((li) => !isEmptyLine(li));
		if (!roots.length) { this.toast('Nothing to capture yet.'); return; }

		// Resolve destination into a move target: `parentTarget` (a record for
		// top-level placement, or a line item to nest under) + `anchor` (the
		// sibling to insert after; null = start). The indent toggle picks between
		// nesting under the chosen heading/line vs placing directly after it.
		let destRec = null, parentTarget = null, anchor = null, destLabel = '';
		let titleGuid = null;   // a new page titled by the capture's first line
		const indent = !!this.indentUnder;
		try {
			if (this.dest.kind === 'new') {
				// title from the first line: decided now, the capture may have changed since the pick
				let title = this.dest.name;
				if (this.dest.fromFirst) {
					const first = await this.captureFirstTitle();
					if (first.text) { title = first.text; titleGuid = first.guid; }
				}
				if (!title) { this.toast('Type a title for the new page.'); return; }
				// createRecord's result is only queryable a beat later — same polling
				// pattern as the scratch page
				let guid = null;
				try { guid = await this.dest.collection.createRecord(title); } catch (e) {}
				if (!guid) { this.toast('Could not create the new note in that collection.'); return; }
				destRec = this.data.getRecord(guid);
				for (let i = 0; !destRec && i < 16; i++) { await wait(120); destRec = this.data.getRecord(guid); }
				if (!destRec) { this.toast('The new note was created but could not be loaded.'); return; }
				destLabel = title + (this.dest.collectionName ? ' · ' + this.dest.collectionName : '');
				parentTarget = destRec;
				anchor = null;
			} else if (this.dest.kind === 'journal') {
				destRec = await this.resolveJournalRecord(this.dest.date);
				if (!destRec) { this.toast('No Journal found in this workspace — pick a page instead.'); return; }
				destLabel = this.dest.dateLabel ? ('the Journal, ' + this.dest.dateLabel) : "today's Journal";
				parentTarget = destRec;
				anchor = await lastTopLevel(destRec);
			} else if (this.dest.kind === 'line') {
				destRec = this.data.getRecord(this.dest.pageGuid);
				if (!destRec) { this.toast('Destination page not found.'); return; }
				destLabel = this.dest.name;
				const ditems = await destRec.getLineItems();
				const target = ditems.find((li) => liGuid(li) === this.dest.guid);
				if (!target) {
					// the line disappeared since it was picked — fall back to page bottom
					parentTarget = destRec; anchor = lastOf(topLevelItems(ditems, rowGuid(destRec)));
					destLabel = this.dest.pageName || destLabel;
				} else if (indent) {
					parentTarget = target; anchor = nestAnchor(ditems, target, null);
				} else {
					parentTarget = siblingParent(ditems, target, destRec); anchor = target;
				}
			} else {
				destRec = this.data.getRecord(this.dest.guid);
				if (!destRec) { this.toast('Destination page not found.'); return; }
				destLabel = this.dest.name;
				if (this.dest.afterHeadingGuid) {
					const ditems = await destRec.getLineItems();
					const heading = ditems.find((li) => liGuid(li) === this.dest.afterHeadingGuid);
					destLabel += ' › ' + (this.dest.headingText || 'heading');
					if (!heading) {
						parentTarget = destRec; anchor = lastOf(topLevelItems(ditems, rowGuid(destRec)));
					} else if (indent) {
						parentTarget = heading; anchor = nestAnchor(ditems, heading, null);
					} else {
						parentTarget = siblingParent(ditems, heading, destRec); anchor = heading;
					}
				} else if (this.dest.atTop) {
					// prepend above existing content: move(record, null) inserts as
					// the FIRST top-level line (verified 2026-07-02)
					parentTarget = destRec; anchor = null;
					destLabel += ' › Top';
				} else {
					parentTarget = destRec;
					anchor = await lastTopLevel(destRec);
				}
			}
		} catch (e) { this.toast('Could not resolve destination.'); return; }

		// Move captured roots (each subtree rides along), preserving order and
		// segment fidelity. Anchors must be STABLE pre-existing lines (never the
		// just-moved item). Insert-order semantics (verified 2026-07-02): a null
		// anchor PREPENDS (first top-level child of a record, or first child of a
		// line); a real anchor inserts right AFTER it. Both cases put each moved
		// item ahead of the previous one, so iterate in REVERSE for the final
		// order to match the capture.
		let moved = 0;
		const movedGuids = new Set();
		const order = [...roots].reverse();
		for (const li of order) {
			try { await li.move(parentTarget, anchor); moved++; movedGuids.add(liGuid(li)); await wait(40); } catch (e) {}
		}
		// a heading's children render flush since Thymer 1.0.20: indent them the way Tab does
		if (moved && isHeading(parentTarget)) {
			await indentUnderHeading(liGuid(parentTarget), anchor ? liGuid(anchor) : null, roots.map(liGuid).filter((g) => movedGuids.has(g)));
		}
		// that first line is the title now, so it leaves the body, unless it
		// carries children (they need their parent)
		if (moved && titleGuid && movedGuids.has(titleGuid)) {
			try {
				const ditems = (await destRec.getLineItems()) || [];
				const first = ditems.find((li) => liGuid(li) === titleGuid);
				if (first && !ditems.some((li) => liRaw(li).pguid === titleGuid)) await first.delete();
			} catch (e) {}
		}

		// Panel mode: the box stays alive (now empty) for the next capture — the
		// OS panel hides via the helper. Otherwise: close the modal as before.
		if (!this.panelMode) this.teardown();
		if (!moved) { this.toast('Nothing was sent.'); return; }
		if (this.panelMode) {
			this.panelNotify('sent');
			this.setDest({ kind: 'journal' });   // next capture starts at the default again
			setTimeout(() => this.placeCaret(), 300);   // ready for the next capture
			// no "Open" action in the panel: navigation belongs to the main app
			this.toast(`Sent ${moved} line${moved > 1 ? 's' : ''} to ${destLabel}.`, { autoDestroyTime: 4000 });
			return;
		}
		// "Open" jumps to the first line that actually moved (highlighted), so a
		// partially failed send can't navigate to a line still in the scratch page.
		const firstGuid = roots.map(liGuid).find((g) => movedGuids.has(g)) || null;
		const destGuid = rowGuid(destRec);
		this.toast(`Sent ${moved} line${moved > 1 ? 's' : ''} to ${destLabel}.`, {
			primaryLabel: 'Open',
			onPrimary: () => this.openDestination(firstGuid, destGuid),
			autoDestroyTime: 6000,
		});
	}

	// Navigate the active panel to a sent capture: to the exact line
	// (highlighted) when possible, else to the destination page.
	async openDestination(lineGuid, pageGuid) {
		try {
			const panel = this.ui.getActivePanel();
			if (!panel) return;
			if (lineGuid) {
				const ok = await panel.navigateTo({ itemGuid: lineGuid, highlight: true });
				if (ok) return;
			}
			if (!pageGuid) return;
			const wsGuid = panel.getNavigation()?.workspaceGuid || null;
			panel.navigateTo({ type: 'edit_panel', rootId: pageGuid, subId: null, workspaceGuid: wsGuid });
		} catch (e) {}
	}

	toast(message, opts) {
		try { this.ui.addToaster({ title: 'Quick Capture', message, dismissible: true, autoDestroyTime: 2600, ...(opts || {}) }); } catch (e) {}
	}
}

// ---- helpers --------------------------------------------------------------

// ---- QC-only helpers (NOT owned by the shared picker file — keep them
// OUTSIDE the markers below or the sync will delete them) -------------


// True for any colour that would let the page show through, in ANY css colour
// syntax: empty, the transparent keyword, rgba()/hsla() with a zero alpha, and the
// modern color(...) / lab() / oklch() forms where alpha comes after a slash.
// String-comparing 'rgba(0, 0, 0, 0)' is not enough — see themeSurfaceColor.
function qcIsTransparent(c) {
	const s = String(c == null ? '' : c).trim().toLowerCase();
	if (!s || s === 'transparent' || s === 'none') return true;
	const alphaText = (s.match(/\/\s*([0-9.]+%?)\s*\)$/) || [])[1]        // color(... / a)
		|| (s.match(/^(?:rgba|hsla)\([^)]*?[,\s]\s*([0-9.]+%?)\s*\)$/) || [])[1];   // rgba(r,g,b,a)
	if (alphaText == null) return false;
	const a = alphaText.endsWith('%') ? parseFloat(alphaText) / 100 : parseFloat(alphaText);
	return !(a > 0);
}

function qcIsMac() { try { return /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || ''); } catch (e) { return true; } }

async function lastTopLevel(rec) {
	try { const items = await rec.getLineItems(); return lastOf(topLevelItems(items, rowGuid(rec))); } catch (e) { return null; }
}

// <<<SHARED destination-picker — GENERATED, DO NOT EDIT HERE.
// Source: shared/destination-picker.js  |  regenerate: node tools/sync-picker.mjs
function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function rowGuid(o) { try { return o && o._getRow ? o._getRow().guid : null; } catch (e) { return null; } }
// A collection's icon comes from its CONFIGURATION (`icon`); PluginCollectionAPI
// has no getIcon(). Thymer also stores a few non-font "fill" icons (blinking-dot)
// that it renders as CSS rather than a glyph — those would come out blank, so
// only pass through real `ti-` classes and let the caller fall back.
function collIconFromConf(conf) {
	const ic = conf && conf.icon;
	if (!ic || typeof ic !== 'string') return '';
	return ic.startsWith('ti-') ? ic : '';
}
// Line items: the runtime accessors (getType/getParent/getHeadingSize) are
// unreliable — read the raw row. Top-level when pguid === record guid.
function liRaw(li) { try { return (li && li._getItem) ? (li._getItem() || {}) : {}; } catch (e) { return {}; } }
function liGuid(li) { return liRaw(li).guid || null; }
function liType(li) { return liRaw(li).type || 'text'; }
function isHeading(li) { return liType(li) === 'heading'; }
function isEmptyLine(li) { return liType(li) === 'text' && lineText(li) === ''; }
function headingSize(li) { const mp = liRaw(li).mp; return (mp && mp.hsize) || 1; }
function lineText(li) {
	const ts = liRaw(li).ts; if (!Array.isArray(ts)) return '';
	let s = ''; for (let i = 0; i < ts.length; i += 2) s += String(ts[i + 1] || ''); return s.trim();
}
function topLevelItems(items, recGuid) { return (items || []).filter((li) => liRaw(li).pguid === recGuid); }
// Build the page's heading outline: real document order + nesting depth.
// getLineItems() is a FLAT list that is NOT in document order (every top-level
// line comes first, then the children), so listing headings straight from it
// puts nested ones at the end. It IS sibling-ordered within a single parent,
// so regrouping by parent guid and walking depth-first restores the true order.
// `depth` counts ANCESTOR HEADINGS, not raw tree depth, so the result reads as
// an outline: two same-size headings where one sits under the other still come
// out on different levels.
function outlineHeadings(items, recGuid, skip) {
	const kids = new Map();
	for (const li of (items || [])) {
		const pg = liRaw(li).pguid;
		if (!pg) continue;
		if (!kids.has(pg)) kids.set(pg, []);
		kids.get(pg).push(li);
	}
	const out = [];
	const walk = (parentGuid, depth) => {
		for (const li of (kids.get(parentGuid) || [])) {
			const g = liGuid(li);
			if (!g) continue;
			const isH = isHeading(li) && !(skip && skip.has(g));
			if (isH) out.push({ guid: g, text: lineText(li), size: headingSize(li), depth });
			walk(g, isH ? depth + 1 : depth);
		}
	};
	walk(recGuid, 0);
	return out;
}
// Thymer 1.0.20 made headings own the lines that follow them and draws a
// heading's children FLUSH with the heading, so nesting content under a heading
// no longer shows as an indent. Thymer's own Tab indents such a line with
// OVERINDENT (`oind`), but the public line.move() always writes oind 0. After the
// move, re-issue each root's final position through the editor's mutation queue
// with oind 1: exactly the mutation Tab produces. `guids` must be in final
// document order, the first sitting right after `afterGuid` (null = first child).
// The queue silently DROPS a mutation for a line the editor has not loaded (a
// line moved off a page no panel shows, e.g. a Whiteboard card), so load each one
// first with getOrLoadItem, the app's own loader.
// The one helper here with a side effect, kept shared so the internal call lives
// in one place. Best effort: without these internals the lines stay flush, which
// is where move() already put them. Measured 2026-10-04, app 1.0.20.
async function indentUnderHeading(headingGuid, afterGuid, guids) {
	const ops = window.g_universe && window.g_universe.operations;
	if (!headingGuid || !ops || typeof ops.enqueueMutation !== 'function') return false;
	let after = afterGuid || null;
	for (const g of (guids || [])) {
		if (!g) continue;
		try {
			if (typeof ops.getOrLoadItem === 'function') await ops.getOrLoadItem(g);
			ops.enqueueMutation({ action: 'move_tree', item_guid: g, value: [headingGuid, after, 1] });
		} catch (e) { return false; }
		after = g;
	}
	return true;
}
// The anchor for content nested under `target`. Under a plain line: after its
// last child, as before. Under a HEADING: right below the heading, after any
// lines already indented there. Thymer folds an indented line that follows a
// FLUSH one into that line (measured 2026-10-04), so appending at the end of a
// section would quietly make the content a child of whatever line ends it.
// Directly under the heading the indent survives, exactly as Thymer's own Tab.
function nestAnchor(items, target, skip) {
	const tg = liGuid(target);
	const kids = (items || []).filter((li) => liRaw(li).pguid === tg && !(skip && skip.has(liGuid(li))));
	if (!isHeading(target)) return lastOf(kids);
	let anchor = null;
	for (const li of kids) { if ((liRaw(li).oind || 0) >= 1) anchor = li; else break; }
	return anchor;
}
function lastOf(arr) { return arr && arr.length ? arr[arr.length - 1] : null; }
// The move target for "place directly after `target` at the same level":
// the record when the target is top-level, else the target's parent line.
function siblingParent(items, target, rec) {
	const pg = liRaw(target).pguid;
	if (pg === rowGuid(rec)) return rec;
	return (items || []).find((li) => liGuid(li) === pg) || rec;
}
function truncate(s, n) { s = String(s == null ? '' : s); return s.length > n ? s.slice(0, n - 1) + '…' : s; }
function qcNorm(s) { return String(s == null ? '' : s).toLowerCase().replace(/\s+/g, ' ').trim(); }
// Rank a page-name match: exact > prefix > word-start > plain substring, summed
// across the "+" parts, so the strongest titles float to the top of the Pages list.
function qcNameScore(nn, parts) {
	let s = 0;
	for (const p of parts) {
		if (nn === p) s += 100;
		else if (nn.startsWith(p)) s += 45;
		else if (nn.includes(' ' + p)) s += 25;
		else s += 8;
	}
	return s;
}
// Minimal date fallback (used only if Thymer's DateTime parser is unreachable):
// ISO YYYY-MM-DD, plus today / tomorrow / yesterday. Returns a JS Date or null.
function fallbackJournalDate(s) {
	const t = s.toLowerCase().trim();
	const today = new Date(); today.setHours(0, 0, 0, 0);
	if (t === 'today') return today;
	if (t === 'tomorrow') { const d = new Date(today); d.setDate(d.getDate() + 1); return d; }
	if (t === 'yesterday') { const d = new Date(today); d.setDate(d.getDate() - 1); return d; }
	const m = t.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
	if (m) { const d = new Date(+m[1], +m[2] - 1, +m[3]); d.setHours(0, 0, 0, 0); return isNaN(d.getTime()) ? null : d; }
	return null;
}
// Escape + bold EVERY occurrence of the matched words in the full text (no
// windowing — used by the line hover preview so the search terms stand out).
function qcHighlightAll(text, parts) {
	const full = String(text == null ? '' : text);
	const words = [...new Set((parts || []).concat((parts || []).flatMap((p) => p.split(/\s+/))))].filter((w) => w.length >= 2).sort((a, b) => b.length - a.length);
	if (!words.length) return esc(full);
	const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const re = new RegExp('(' + words.map(escRe).join('|') + ')', 'ig');
	let html = '', last = 0, m;
	while ((m = re.exec(full)) !== null) {
		html += esc(full.slice(last, m.index)) + '<b>' + esc(m[0]) + '</b>';
		last = m.index + m[0].length;
		if (m.index === re.lastIndex) re.lastIndex++;
	}
	return html + esc(full.slice(last));
}
// A short one-line snippet centred on the first matched part, with matched
// words highlighted (<b>, accent-coloured via CSS).
function qcSnippetHTML(text, parts) {
	const full = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
	const words = [...new Set((parts || []).concat((parts || []).flatMap((p) => p.split(/\s+/))))].filter((w) => w.length >= 2).sort((a, b) => b.length - a.length);
	const tail = (s, n) => s.slice(0, n) + (s.length > n ? '…' : '');
	if (!words.length) return esc(tail(full, 160));
	const lower = full.toLowerCase();
	let first = -1;
	for (const w of words) { const i = lower.indexOf(w); if (i >= 0 && (first < 0 || i < first)) first = i; }
	if (first < 0) return esc(tail(full, 160));
	const start = Math.max(0, first - 50);
	const end = Math.min(full.length, first + 115);
	const win = full.slice(start, end);
	const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const re = new RegExp('(' + words.map(escRe).join('|') + ')', 'ig');
	let html = '', last = 0, m;
	while ((m = re.exec(win)) !== null) {
		html += esc(win.slice(last, m.index)) + '<b>' + esc(m[0]) + '</b>';
		last = m.index + m[0].length;
		if (m.index === re.lastIndex) re.lastIndex++;
	}
	html += esc(win.slice(last));
	return (start > 0 ? '…' : '') + html + (end < full.length ? '…' : '');
}
// Reconstruct {type, text} segments from the pair-encoded live model.
function segmentsFromState(state) {
	const ts = (state && state.text_segments) || [];
	const segs = [];
	for (let i = 0; i + 1 < ts.length; i += 2) segs.push({ type: String(ts[i]), text: ts[i + 1] });
	return segs;
}
// >>>SHARED
