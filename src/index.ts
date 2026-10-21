import { CustomEditor, type ExtensionAPI, type ExtensionContext, type KeybindingsManager } from "@earendil-works/pi-coding-agent";
import { CURSOR_MARKER, StdinBuffer, type EditorTheme, type TUI } from "@earendil-works/pi-tui";

export const FOCUS_IN = "\x1b[I";
export const FOCUS_OUT = "\x1b[O";
const ENABLE_FOCUS = "\x1b[?1004h";
const DISABLE_FOCUS = "\x1b[?1004l";
const CURSOR_START = CURSOR_MARKER + "\x1b[7m";
const CURSOR_END = "\x1b[0m";

/** Remove only the marked software cursor, never other reverse-video text. */
export function withoutCursor(line: string): string {
  const start = line.indexOf(CURSOR_START);
  if (start < 0) return line;
  const cell = start + CURSOR_START.length;
  const end = line.indexOf(CURSOR_END, cell);
  if (end < 0) return line; // Unknown renderer format: leave it unchanged.
  return line.slice(0, start) + line.slice(cell, end) + line.slice(end + CURSOR_END.length);
}

export interface FocusState {
  focused: boolean;
}

export class FocusCursorEditor extends CustomEditor {
  private readonly focusState: FocusState;
  private readonly beforeRender: () => void;

  constructor(tui: TUI, theme: EditorTheme, keys: KeybindingsManager, state: FocusState, beforeRender = () => {}) {
    super(tui, theme, keys, { embedWorkingStatus: true });
    this.focusState = state;
    this.beforeRender = beforeRender;
  }

  render(width: number): string[] {
    this.beforeRender();
    if (this.focusState.focused && this.focused) return super.render(width);
    // Pi currently draws its software cursor even when editor.focused is false.
    // Ask the base renderer to mark that exact cell, then remove its cursor SGR
    // and hardware marker. Keep its grapheme/space and geometry unchanged.
    const focused = this.focused;
    this.focused = true;
    try {
      return super.render(width).map(withoutCursor);
    } finally {
      this.focused = focused;
    }
  }
}

/** Session-scoped resources; injectable streams keep tests off real terminals. */
export function startSession(
  ctx: ExtensionContext,
  input: NodeJS.ReadStream = process.stdin,
  output: NodeJS.WriteStream = process.stdout,
): () => void {
  if (ctx.mode !== "tui" || !input.isTTY || !output.isTTY) return () => {};

  const state: FocusState = { focused: true };
  const parser = new StdinBuffer();
  let tui: TUI | undefined;
  let reportingMode: TUI["mode"] | undefined;
  let stopped = false;

  const ensureReporting = () => {
    if (!tui || stopped || tui.mode === reportingMode) return;
    reportingMode = tui.mode;
    // Also re-request after switching from fullscreen to regular mode: Pi's
    // fullscreen teardown disables 1004. The editor receives a stable TUI proxy.
    if (reportingMode === "regular") tui.terminal.write(ENABLE_FOCUS);
  };

  const focus = (data: string) => {
    if (data !== FOCUS_IN && data !== FOCUS_OUT) return;
    const focused = data === FOCUS_IN;
    if (state.focused === focused) return;
    state.focused = focused;
    tui?.requestRender();
  };

  // Fullscreen Pi consumes focus reports before onTerminalInput listeners.
  // Observe, but never consume or rewrite, the underlying terminal stream.
  // Pi's parser handles split/coalesced sequences and excludes bracketed paste.
  parser.on("data", focus);
  const observe = (data: string | Buffer) => parser.process(data);
  input.on("data", observe);

  let unsubscribe = () => {};
  try {
    // In regular mode, stop reports from falling through to the text editor.
    unsubscribe = ctx.ui.onTerminalInput((data) => {
      if (data !== FOCUS_IN && data !== FOCUS_OUT) return;
      focus(data);
      return { consume: true };
    });
    ctx.ui.setEditorComponent((activeTui, theme, keys) => {
      tui = activeTui;
      // Fullscreen Pi owns mode 1004 already. Do not disable its mouse/focus
      // reporting on extension reload; request our own mode only in regular UI.
      ensureReporting();
      return new FocusCursorEditor(tui, theme, keys, state, ensureReporting);
    });
  } catch (error) {
    input.removeListener("data", observe);
    parser.destroy();
    unsubscribe();
    if (tui?.mode === "regular") tui.terminal.write(DISABLE_FOCUS);
    throw error;
  }

  return () => {
    if (stopped) return;
    stopped = true;
    input.removeListener("data", observe);
    parser.destroy();
    unsubscribe();
    if (tui?.mode === "regular") tui.terminal.write(DISABLE_FOCUS);
    tui = undefined;
    state.focused = true;
    // Pi restores its editor factory during reload. Do not clear a factory
    // another extension may have installed after ours.
  };
}

export default function focusCursor(pi: ExtensionAPI): void {
  let stop: (() => void) | undefined;
  pi.on("session_start", (_event, ctx) => {
    stop?.();
    stop = undefined;
    stop = startSession(ctx);
  });
  pi.on("session_shutdown", () => {
    stop?.();
    stop = undefined;
  });
}
