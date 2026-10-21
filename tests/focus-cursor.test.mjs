import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import { CustomEditor } from "@earendil-works/pi-coding-agent";
import { CURSOR_MARKER, stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import entryPoint from "../focus-cursor.ts";
import extension, { FOCUS_IN, FOCUS_OUT, FocusCursorEditor, startSession, withoutCursor } from "../src/index.ts";

test("named package entry point exports the extension factory", () => {
  assert.equal(entryPoint, extension);
});

const theme = { borderColor: (text) => text, selectList: {} };
const keys = { matches: () => false };

function fixture(mode = "regular") {
  const input = Object.assign(new EventEmitter(), { isTTY: true });
  const writes = [];
  const tui = { mode, requestRender: () => ++state.renders, terminal: { rows: 30, write: (data) => writes.push(data) } };
  const state = { renders: 0, unsubscribed: 0 };
  let editor;
  let listener;
  const ctx = {
    mode: "tui",
    ui: {
      onTerminalInput: (handler) => {
        listener = handler;
        return () => ++state.unsubscribed;
      },
      setEditorComponent: (factory) => {
        editor = factory(tui, theme, keys);
        editor.focused = true;
        editor.setText("prompt");
      },
    },
  };
  const stop = startSession(ctx, input, { isTTY: true });
  return { input, writes, state, editor, stop, listener, tui };
}

const hasCursor = (editor) => editor.render(40).some((line) => line.includes(CURSOR_MARKER));

test("removes only the marked cursor and retains its character and other inverse text", () => {
  const unrelated = "\x1b[7mselection\x1b[0m";
  assert.equal(withoutCursor(unrelated), unrelated);
  for (const cell of [" ", "C", "界", "e\u0301", "👩‍💻"]) {
    const line = unrelated + " before " + CURSOR_MARKER + "\x1b[7m" + cell + "\x1b[0m after";
    assert.equal(withoutCursor(line), unrelated + " before " + cell + " after");
    assert.equal(visibleWidth(withoutCursor(line)), visibleWidth(line));
  }
  const unknown = CURSOR_MARKER + "different renderer";
  assert.equal(withoutCursor(unknown), unknown);
  assert.equal(withoutCursor(CURSOR_MARKER + "\x1b[7mX"), CURSOR_MARKER + "\x1b[7mX");
});

test("real CustomEditor preserves text, wrapping, graphemes, and normal focused output", () => {
  for (const text of ["", "abc", "long text that wraps across lines", "界", "e\u0301", "👩‍💻"]) {
    for (const width of [8, 20, 80]) {
      const tui = { terminal: { rows: 30 }, requestRender() {} };
      const focus = { focused: true };
      const editor = new FocusCursorEditor(tui, theme, keys, focus);
      const baseline = new CustomEditor(tui, theme, keys, { embedWorkingStatus: true });
      editor.focused = baseline.focused = true;
      editor.setText(text);
      baseline.setText(text);
      editor.handleInput("\x01");
      baseline.handleInput("\x01");
      const active = editor.render(width);
      assert.deepEqual(active, baseline.render(width));
      focus.focused = false;
      const inactive = editor.render(width);
      assert.deepEqual(inactive.map(stripTerminalSequences), active.map(stripTerminalSequences));
      assert.equal(editor.getText(), text);
      assert.equal(editor.focused, true);
      assert.ok(!inactive.some((line) => line.includes(CURSOR_MARKER) || line.includes("\x1b[7m")));
      focus.focused = true;
      assert.deepEqual(editor.render(width), active);
    }
  }
});

test("internal editor focus is respected without removing reverse-video borders", () => {
  const tui = { terminal: { rows: 30 }, requestRender() {} };
  const inverseTheme = { ...theme, borderColor: (text) => "\x1b[7m" + text + "\x1b[0m" };
  const editor = new FocusCursorEditor(tui, inverseTheme, keys, { focused: true });
  editor.focused = false;
  const lines = editor.render(30);
  assert.equal(editor.focused, false);
  assert.ok(!lines.some((line) => line.includes(CURSOR_MARKER)));
  assert.ok(lines[0].includes("\x1b[7m"));
});

for (const mode of ["regular", "fullscreen"]) {
  test(`${mode}: raw focus reports redraw, split/coalesced input works, paste is ignored`, (t) => {
    const f = fixture(mode);
    t.after(f.stop);
    assert.equal(hasCursor(f.editor), true);
    f.input.emit("data", "\x1b[");
    f.input.emit("data", "O");
    assert.equal(hasCursor(f.editor), false);
    assert.equal(f.state.renders, 1);
    f.input.emit("data", FOCUS_OUT);
    assert.equal(f.state.renders, 1); // Deduplicate repeated focus reports.
    f.input.emit("data", Buffer.from(FOCUS_IN));
    assert.equal(hasCursor(f.editor), true);
    f.input.emit("data", "\x1b[200~pasted " + FOCUS_OUT);
    f.input.emit("data", "\x1b[201~");
    assert.equal(hasCursor(f.editor), true);
    assert.equal(f.state.renders, 2);
    f.input.emit("data", FOCUS_OUT + FOCUS_IN);
    assert.equal(hasCursor(f.editor), true);
    assert.equal(f.state.renders, 4);
    assert.equal(f.editor.getText(), "prompt");
  });
}

test("regular input listener consumes reports but not keys or paste", (t) => {
  const f = fixture();
  t.after(f.stop);
  assert.deepEqual(f.listener(FOCUS_OUT), { consume: true });
  assert.equal(hasCursor(f.editor), false);
  assert.deepEqual(f.listener(FOCUS_IN), { consume: true });
  assert.equal(f.listener("typing"), undefined);
  assert.equal(f.listener("\x1b[200~" + FOCUS_OUT + "\x1b[201~"), undefined);
});

test("cleanup is idempotent and preserves fullscreen's owned reporting", () => {
  for (const mode of ["regular", "fullscreen"]) {
    const f = fixture(mode);
    assert.equal(f.input.listenerCount("data"), 1);
    f.stop();
    f.stop();
    assert.equal(f.input.listenerCount("data"), 0);
    assert.equal(f.state.unsubscribed, 1);
    assert.deepEqual(f.writes, mode === "regular" ? ["\x1b[?1004h", "\x1b[?1004l"] : []);
    const renders = f.state.renders;
    f.input.emit("data", FOCUS_OUT);
    assert.equal(f.state.renders, renders);
  }
});

test("switching UI modes requests reporting only when regular mode needs it", () => {
  const f = fixture("fullscreen");
  f.tui.mode = "regular";
  hasCursor(f.editor);
  hasCursor(f.editor);
  assert.deepEqual(f.writes, ["\x1b[?1004h"]);
  f.tui.mode = "fullscreen";
  hasCursor(f.editor);
  f.tui.mode = "regular";
  hasCursor(f.editor);
  f.stop();
  assert.deepEqual(f.writes, ["\x1b[?1004h", "\x1b[?1004h", "\x1b[?1004l"]);
});

test("non-TUI and non-terminal modes do nothing, including RPC with hasUI", () => {
  for (const mode of ["rpc", "json", "print", "tui"]) {
    const input = Object.assign(new EventEmitter(), { isTTY: mode !== "tui" });
    const stop = startSession({ mode, hasUI: true, ui: {} }, input, { isTTY: true });
    stop();
    assert.equal(input.listenerCount("data"), 0);
  }
  const input = Object.assign(new EventEmitter(), { isTTY: true });
  startSession({ mode: "tui", ui: {} }, input, { isTTY: false })();
  assert.equal(input.listenerCount("data"), 0);
});

test("failed editor setup releases input resources", () => {
  const input = Object.assign(new EventEmitter(), { isTTY: true });
  let released = 0;
  assert.throws(() => startSession({
    mode: "tui",
    ui: {
      onTerminalInput: () => () => ++released,
      setEditorComponent: () => { throw new Error("setup failed"); },
    },
  }, input, { isTTY: true }), /setup failed/);
  assert.equal(input.listenerCount("data"), 0);
  assert.equal(released, 1);
});

test("failed input subscription also releases the raw observer", () => {
  const input = Object.assign(new EventEmitter(), { isTTY: true });
  assert.throws(() => startSession({ mode: "tui", ui: {
    onTerminalInput() { throw new Error("subscription failed"); },
  } }, input, { isTTY: true }), /subscription failed/);
  assert.equal(input.listenerCount("data"), 0);
});

test("extension factory only registers lifecycle callbacks, with no startup I/O", () => {
  const handlers = new Map();
  extension({ on: (name, handler) => handlers.set(name, handler) });
  assert.deepEqual([...handlers.keys()], ["session_start", "session_shutdown"]);
  handlers.get("session_start")({}, { mode: "rpc", ui: {} });
  handlers.get("session_shutdown")();
  handlers.get("session_shutdown")();
});
