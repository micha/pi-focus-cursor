# Development

This is a standalone Pi package. Runtime dependencies are provided by Pi; keep
those imports in peerDependencies, never bundle physical copies. The `pi`
manifest owns resource discovery. Do not depend on neighboring repositories,
machine-specific paths, or user configuration.

- `src/index.ts` owns the editor subclass, focus observation, and lifecycle.
- Observe standard terminal focus reports, not tmux commands or process guesses.
- Work only in interactive TUI mode with terminal stdin and stdout.
- Preserve prompt text, graphemes, width, shortcuts, autocomplete, working state,
  and unrelated reverse-video formatting. Do not strip all ANSI inverse styles.
- Use Pi's StdinBuffer to distinguish split reports and bracketed paste. Never
  consume the raw stdin stream or record keystrokes.
- Fullscreen Pi consumes focus reports before extension input listeners; retain
  the read-only raw observer. Do not disable fullscreen's owned reporting mode.
- Start resources on session_start, stop them idempotently on session_shutdown,
  and clean up failed startup. Do not clear another extension's editor factory.
- README is user documentation, including installation and honest limitations.

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
