# pi-focus-cursor

Hide Pi's **drawn prompt cursor** when its terminal window, tab, or multiplexer
pane loses focus, and restore it when focus returns.

The extension uses standard terminal focus reports (`CSI I` / `CSI O`), not
tmux commands. It preserves prompt text, wrapping, Unicode graphemes, editing
shortcuts, autocomplete, and unrelated reverse-video styling. No polling or
background subprocesses are needed.

## Install

From a local checkout:

```sh
pi install /path/to/pi-focus-cursor
```

Or, from this directory:

```sh
pi install .
```

Local packages load from the checkout without copying it. After editing or
installing, run `/reload` in an existing Pi session, or restart Pi.

Once the repository has been published on GitHub:

```sh
pi install git:github.com/micha/pi-focus-cursor
```

**The repository is currently local only.** The GitHub command will not work
until it is published. No npm publication or build step is required for either
installation method. Pi supplies the runtime dependencies.

To try the extension without saving an installation:

```sh
pi --extension /path/to/pi-focus-cursor/focus-cursor.ts
```

Remove a local installation with the same source path:

```sh
pi remove /path/to/pi-focus-cursor
```

Use `pi remove git:github.com/micha/pi-focus-cursor` for a GitHub installation.
Reload or restart Pi after removing it. `pi install --local` can instead record
an installation in project settings; Pi loads it only after project trust is
resolved.

## Terminal support

The terminal must implement standard focus reporting. In regular Pi UI mode,
the extension requests reporting with DEC private mode 1004 and releases it on
shutdown/reload. In fullscreen mode, Pi already owns that mode, so the extension
does not disable it. A read-only stdin observer sees fullscreen focus reports
before Pi consumes them; Pi's input parser keeps bracketed paste from being
mistaken for focus changes.

Inside tmux, opt in to forwarding focus events:

```tmux
set -g focus-events on
```

Detach and reattach clients after changing this setting, as recommended by the
tmux manual. The extension never changes tmux configuration. Outside a
multiplexer, a supporting terminal reports window/tab focus directly.

Without focus reports, terminal-focus behavior stays unchanged. Until the first
report, the extension assumes the terminal is focused. It also removes the main
prompt's drawn cursor while another Pi component owns keyboard focus.

## Scope and compatibility

- Targets the **main prompt editor**, not every dialog, search box, or overlay.
- Does not change the `showHardwareCursor` preference; the fix targets Pi's
  reverse-video software cursor.
- Runs only in interactive TUI sessions with terminal stdin and stdout. RPC,
  JSON, print, and redirected output are untouched.
- Replaces the main editor through Pi's supported `CustomEditor` API. Pi has one
  editor factory: another editor-replacement extension can override this one,
  or vice versa. This is not automatic composition with custom/vim editors.
- Validated with Pi **1.0.3**, Node **24**, and tmux **3.6a** on Linux, in both
  regular and fullscreen modes, including focus changes after `/reload`.
  Direct GUI terminal implementations and other Pi releases have not been
  independently tested.
- Pi currently has no separate software-cursor visibility hook. The extension
  removes only the reverse-video cell adjacent to Pi's `CURSOR_MARKER`, retaining
  its character and width. If that rendering convention changes, unknown output
  is left unchanged rather than stripping unrelated formatting.

## Development

Tests require Node 24+ for native TypeScript loading. With peer packages
available locally:

```sh
npm install --ignore-scripts
npm test
```

To test against an existing Pi installation without installing another copy:

```sh
PI_TEST_HOST=/path/to/pi-package npm test
```

`PI_TEST_HOST` is a test-only option; it should point to Pi's package directory
containing `dist/index.js` and `node_modules`.

Native integration tests need Python 3.10+, Pi, and tmux:

```sh
npm run test:integration
```

They use temporary configuration directories and private sockets, exercise
local package install/remove, inspect real rendered cursor cells, and make no
model calls. See [AGENTS.md](AGENTS.md) for development and validation rules.

## License

MIT.
