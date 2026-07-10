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
	background: rgba(127,127,127,.07);
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
.qc-indent-1 { padding-left: 26px; }
.qc-indent-2 { padding-left: 40px; }

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
	linePreviewEl = null;         // floating full-text preview shown on line hover

	onLoad() {
		this.loadSettings();
		this.ui.injectCSS(CSS);
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
				const input = this.popEl && this.popEl.querySelector('.qc-pop-input');
				if (input) input.focus(); else this.toggleDestPicker();
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
			conf.sidebar_display_mode = { mode: 'hidden_completely' };  // never in the sidebar
			await nc.saveConfiguration(conf);
		} catch (e) { /* keep default name if rename fails */ }
		this.homeCollectionGuid = nc.getGuid ? nc.getGuid() : null;
		return nc;
	}

	// Auto-hide the home collection from the sidebar (also migrates collections
	// made by an older version that were visible). No-op once already hidden.
	async ensureHidden(col) {
		try {
			const conf = col.getConfiguration();
			if (!conf || (conf.sidebar_display_mode && conf.sidebar_display_mode.mode === 'hidden_completely')) return;
			conf.show_sidebar_items = false;
			conf.sidebar_display_mode = { mode: 'hidden_completely' };
			await col.saveConfiguration(conf);
		} catch (e) {}
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
		let c = probe ? getComputedStyle(probe).backgroundColor : '';
		if (!c || c === 'rgba(0, 0, 0, 0)' || c === 'transparent') {
			c = this.isDarkTheme() ? '#1e1e22' : '#ffffff';
		}
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

	async open() {
		if (this.panel || this.opening) return;
		this.opening = true;
		try {
			// NOTE: do NOT clear here — the scratch page persists its draft across
			// opens. It's only emptied by Send (which moves the content out).
			const rec = await this.getScratchRecord();
			if (!rec) { this.toast('Could not open the capture box.'); return; }

			const wsGuid = this.ui.getActivePanel()?.getNavigation()?.workspaceGuid || null;
			const panel = await this.ui.createPanel();
			if (!panel) { this.toast('Could not open the capture box.'); return; }
			this.panel = panel;

			// Style as a modal IMMEDIATELY — before navigating in content and
			// before the browser paints — so the panel never flashes as a side
			// split. Wait briefly for the panel element if it isn't ready yet.
			let wrapper = this.panelWrapper();
			for (let i = 0; i < 20 && !wrapper; i++) { await wait(16); wrapper = this.panelWrapper(); }
			if (wrapper) this.mountChrome(wrapper);

			panel.navigateTo({
				type: 'edit_panel', rootId: this.scratchGuid, subId: null, workspaceGuid: wsGuid,
				state: { positions: [this.scratchGuid, 'empty-' + this.scratchGuid, 0, 'L'] },
			});
			try { this.ui.setActivePanel(panel); } catch (e) {}
			this.dest = { kind: 'journal' };

			await wait(350);
			this.placeCaret();
		} finally {
			this.opening = false;
		}
	}

	mountChrome(wrapper) {
		if (!wrapper) return;
		wrapper.setAttribute('data-qc-modal', '1');
		wrapper.style.backgroundColor = this.themeSurfaceColor();
		wrapper.style.setProperty('--qc-surface', this.themeSurfaceColor());
		wrapper.style.setProperty('--qc-border', this.themeBorderColor());
		wrapper.style.setProperty('--qc-shadow', this.themeShadow());
		document.body.classList.add('qc-modal-open');
		// createPanel adds a real column to the panels grid; the modal floats
		// (fixed), so collapse that column to 0 — otherwise its slot shows as an
		// empty panel behind the floating window.
		this.collapseModalTrack(wrapper);
		this.watchGrid(wrapper);
		// restore a saved position/size — it floats like a movable notepad
		if (this.geometry) this.applyGeometry(wrapper, this.geometry);

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
		this.attachDrag(wrapper, header);

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

		// resize handle (bottom-right corner)
		const grip = document.createElement('div');
		grip.className = 'qc-resize';
		grip.innerHTML = '<span class="ti ti-arrow-down-right"></span>';
		wrapper.appendChild(grip);
		this.resizeEl = grip;
		this.attachResize(wrapper, grip);

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
		// pointerdown propagates.
		this.outsideHandler = (e) => {
			const w = this.panelWrapper();
			if (!w || w.contains(e.target)) return;
			if (e.target.closest && (e.target.closest('.cmdpal--inline') || e.target.closest('.qc-pop'))) return;
			this.cancel();
		};
		document.addEventListener('pointerdown', this.outsideHandler, true);
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

	cancel() { this.teardown(); }

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
			<input class="qc-pop-input" type="text" placeholder='Search pages & lines… ("+" matches words anywhere)' />
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
		box.style.maxHeight = Math.max(80, Math.min(placeBelow ? belowSpace : aboveSpace, Math.round(vh * 0.6))) + 'px';
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
				let n = ''; try { n = c.getName ? c.getName() : ''; } catch (e) {}
				let ic = ''; try { ic = (c.getIcon && c.getIcon()) || ''; } catch (e) {}
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
		this.sec(list, 'Type to search pages & lines');
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
			if (!it.rguid || it.rguid === this.scratchGuid) continue;
			const ts = it.text_segments;
			if (!ts || !ts.length) continue;
			let raw = '';
			for (let i = 0; i + 1 < ts.length; i += 2) { if (typeof ts[i + 1] === 'string') raw += ts[i + 1] + ' '; }
			const rawNorm = qcNorm(raw);
			if (!parts.some((p) => rawNorm.includes(p))) continue;
			considerLine(it.guid || guid, segmentsFromState(it), () => {
				const r = this.data.getRecord(it.rguid);
				return r ? { guid: it.rguid, name: r.getName && r.getName(), collGuid: this.collGuidOf(r) } : null;
			});
		}
		this.renderDestResults(list, pages, lines, parts, true);
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
		this.renderDestResults(list, pages, lines, parts, false);
	}

	renderDestResults(list, pages, lines, parts, searching) {
		this.resetDestList(list);
		if (!pages.length && !lines.length) {
			const e = document.createElement('div'); e.className = 'qc-opt';
			e.textContent = searching ? 'Searching…' : 'No pages or lines found';
			list.appendChild(e);
			return;
		}
		if (pages.length) {
			this.sec(list, 'Pages');
			for (const p of pages.slice(0, 12)) {
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
			for (const l of lines.slice(0, 10)) {
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
			headings = items.filter((li) => isHeading(li)).map((li) => ({ guid: liGuid(li), text: lineText(li), size: headingSize(li) }));
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
			opt.className = 'qc-opt qc-indent-' + Math.min(2, Math.max(0, (h.size || 1) - 1));
			opt.innerHTML = `<span class="ti ti-heading"></span><span class="qc-opt-text">${esc(h.text || 'Heading')}</span>`;
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
		if (dest.kind === 'journal') { lbl.textContent = "Today's Journal"; if (icon) icon.className = 'ti ti-calendar-event'; }
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

	async resolveJournalRecord() {
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
					return await c.getJournalRecord({ workspaceGuid: wsGuid, guid: userGuid });
				}
			} catch (e) {}
		}
		return null;
	}

	async currentUserGuid() {
		try {
			if (typeof window !== 'undefined' && window.g_universe && window.g_universe.userId) return window.g_universe.userId;
		} catch (e) {}
		try {
			const us = await this.data.getActiveUsers();
			if (us && us.length) {
				const self = us.find((u) => u && (u.is_self || (u._getRow && u._getRow().is_self))) || us[0];
				const g = self && (self.guid || (self._getRow && self._getRow().guid));
				if (g) return g;
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
		const indent = !!this.indentUnder;
		try {
			if (this.dest.kind === 'journal') {
				destRec = await this.resolveJournalRecord();
				if (!destRec) { this.toast('No Journal found in this workspace — pick a page instead.'); return; }
				destLabel = "today's Journal";
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
					parentTarget = target; anchor = lastChildOf(ditems, this.dest.guid);
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
						parentTarget = heading; anchor = lastChildOf(ditems, this.dest.afterHeadingGuid);
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

		this.teardown();
		if (!moved) { this.toast('Nothing was sent.'); return; }
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

function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function rowGuid(o) { try { return o && o._getRow ? o._getRow().guid : null; } catch (e) { return null; } }
// Line items: the runtime accessors (getType/getParent/getHeadingSize) are
// unreliable here, so read the raw row instead. A line is top-level when its
// parent guid equals the record guid; type/heading live on the raw row.
function liRaw(li) { try { return (li && li._getItem) ? (li._getItem() || {}) : {}; } catch (e) { return {}; } }
function liGuid(li) { return liRaw(li).guid || null; }
function liType(li) { return liRaw(li).type || 'text'; }
function isHeading(li) { return liType(li) === 'heading'; }
function headingSize(li) { const mp = liRaw(li).mp; return (mp && mp.hsize) || 1; }
function lineText(li) {
	const ts = liRaw(li).ts; if (!Array.isArray(ts)) return '';
	let s = ''; for (let i = 0; i < ts.length; i += 2) s += String(ts[i + 1] || ''); return s.trim();
}
function isEmptyLine(li) { return liType(li) === 'text' && lineText(li) === ''; }
function topLevelItems(items, recGuid) { return (items || []).filter((li) => liRaw(li).pguid === recGuid); }
function lastOf(arr) { return arr && arr.length ? arr[arr.length - 1] : null; }
function lastChildOf(items, parentGuid) { return lastOf((items || []).filter((li) => liRaw(li).pguid === parentGuid)); }
// The move target for "place directly after `target` at the same level":
// the record when the target is top-level, else the target's parent line.
function siblingParent(items, target, rec) {
	const pg = liRaw(target).pguid;
	if (pg === rowGuid(rec)) return rec;
	return (items || []).find((li) => liGuid(li) === pg) || rec;
}
async function lastTopLevel(rec) {
	try { const items = await rec.getLineItems(); return lastOf(topLevelItems(items, rowGuid(rec))); } catch (e) { return null; }
}
function truncate(s, n) { s = String(s == null ? '' : s); return s.length > n ? s.slice(0, n - 1) + '…' : s; }
function qcNorm(s) { return String(s == null ? '' : s).toLowerCase().replace(/\s+/g, ' ').trim(); }
function qcIsMac() { try { return /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || ''); } catch (e) { return true; } }
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
// A short one-line snippet centred on the first matched part, with every part
// word highlighted (<b>, accent-coloured via CSS). Adapted from Reference
// Extravaganza's [[ picker.
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
// Reconstruct {type, text} segments from the pair-encoded live model
// (itemsByGuid[guid].text_segments = [typeStr, data, typeStr, data, ...]).
function segmentsFromState(state) {
	const ts = (state && state.text_segments) || [];
	const segs = [];
	for (let i = 0; i + 1 < ts.length; i += 2) segs.push({ type: String(ts[i]), text: ts[i + 1] });
	return segs;
}
