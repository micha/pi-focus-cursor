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

The terminal must implement standard focus reporting. The extension supports
both regular and fullscreen Pi UI modes and leaves fullscreen's focus reporting
enabled when it unloads. Pasted text is not treated as focus changes.

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
- Only one main-editor replacement can be active at a time. Another
  editor-replacement extension can override this one, or vice versa. This
  extension does not automatically combine with custom/vim editors.
- Validated with Pi **1.0.3**, Node **24**, and tmux **3.6a** on Linux, in both
  regular and fullscreen modes, including focus changes after `/reload`.
  Direct GUI terminal implementations and other Pi releases have not been
  independently tested.
- Relies on Pi's current cursor rendering. If that changes, the cursor may stay
  visible while unfocused; unrelated formatting is left unchanged.

## License

MIT.
