# Agent instructions

## Development

This is a standalone Pi package. Runtime dependencies are provided by Pi; keep
those imports in peerDependencies, never bundle physical copies. The `pi`
manifest owns resource discovery. Do not depend on neighboring repositories,
machine-specific paths, or user configuration.

- `src/index.ts` owns the editor subclass, focus observation, and lifecycle.
- Replace the main editor through Pi's `CustomEditor` API. Pi has only one editor
  factory; do not assume composition with other editor-replacement extensions.
- Observe standard terminal focus reports, not tmux commands or process guesses.
- Work only in interactive TUI mode with terminal stdin and stdout.
- Preserve prompt text, graphemes, width, shortcuts, autocomplete, working state,
  and unrelated reverse-video formatting. Remove only the reverse-video cursor
  cell adjacent to Pi's `CURSOR_MARKER`, retaining its character and width. Leave
  unknown rendering unchanged; do not strip all ANSI inverse styles.
- Use Pi's StdinBuffer to distinguish split reports and bracketed paste. Never
  consume the raw stdin stream or record keystrokes.
- Request DEC private mode 1004 in regular UI mode and release it on cleanup.
  Fullscreen Pi consumes focus reports before extension input listeners; retain
  the read-only raw observer. Do not disable fullscreen's owned reporting mode.
- Start resources on session_start, stop them idempotently on session_shutdown,
  and clean up failed startup. Do not clear another extension's editor factory.
- Keep `README.md` for users: installation, behavior, terminal setup, and honest
  limitations. Keep agent workflows, validation commands, and implementation
  constraints in this file; do not direct users to agent instructions.

## Validation

Unit tests require Node 24+ for native TypeScript loading:

```sh
npm install --ignore-scripts
npm test
```

Alternatively, test against an installed Pi package without installing peers:

```sh
PI_TEST_HOST=/path/to/pi-package npm test
```

The host path must contain `dist/index.js` and Pi's `node_modules`. It is an
optional testing input, never a runtime requirement. Integration tests need
Python 3.10+, Pi, and tmux:

```sh
npm run test:integration
git diff --check
```

Integration validation must use temporary HOME/config directories and private
tmux sockets. Never call a model, modify a live server, install into real Pi
settings, publish, or push as part of testing. Test regular and fullscreen modes,
blur/focus, reload, non-interactive loading, and local package install/remove.
Inspect real rendered cursor cells in integration tests, not just focus state.
