// Optional test-only mapping to an existing Pi installation. Runtime loading
// uses Pi's own host-package mapping instead, and this file is not distributed.
import { registerHooks } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

if (process.env.PI_TEST_HOST) {
  const root = resolve(process.env.PI_TEST_HOST);
  const host = new Map([
    ["@earendil-works/pi-coding-agent", resolve(root, "dist/index.js")],
    ["@earendil-works/pi-tui", resolve(root, "node_modules/@earendil-works/pi-tui/dist/index.js")],
  ]);
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (host.has(specifier)) return { url: pathToFileURL(host.get(specifier)).href, shortCircuit: true };
      return nextResolve(specifier, context);
    },
  });
}
