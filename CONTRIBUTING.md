# Contributing to Vader

Thanks for helping. Vader is an Electron app (a full editor workbench plus an agent platform), so a few things are worth knowing before you start.

## Ways to contribute

- **Report a bug or request a feature:** [open an issue](https://github.com/qwzx4893-stack/Vader/issues/new/choose). For a bug, paste the output of `Help: About` (<kbd>Ctrl/Cmd</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd>), the model and provider you used, and what you expected.
- **Report a vulnerability:** privately, as described in [`SECURITY.md`](./SECURITY.md). Please do not open a public issue.
- **Send a pull request:** small and focused is best. Open an issue first for anything large.

## Read first

1. [`ARCHITECTURE.md`](./ARCHITECTURE.md): the subsystem map. Find which subsystem owns the thing you are touching.
2. [`AGENTS.md`](./AGENTS.md): how to change the agent platform safely (the exhaustive tool maps, the policy gate order, persisted formats, what the renderer may import).
3. [`docs/integrations/`](./docs/integrations/): a guide per subsystem.
4. [`docs/CODEBASE_GUIDE.md`](./docs/CODEBASE_GUIDE.md): a tour of `src/vs/workbench/contrib/vader/`, where most of Vader's own code lives.

## Prerequisites

- **Node.js** at the version in [`.nvmrc`](./.nvmrc) (with [nvm](https://github.com/nvm-sh/nvm): `nvm install && nvm use`), Git, and Python 3.
- **macOS:** Xcode command line tools.
- **Windows:** Visual Studio 2022 (Community is fine) or the Build Tools, with the *Desktop development with C++* and *Node.js build tools* workloads, plus these individual components: *MSVC v143 x64/x86 Spectre-mitigated libs (Latest)*, *C++ ATL for latest build tools with Spectre Mitigations*, *C++ MFC for latest build tools with Spectre Mitigations*.
- **Linux:** `npm install -g node-gyp`, then
  - Debian/Ubuntu: `sudo apt-get install build-essential g++ libx11-dev libxkbfile-dev libsecret-1-dev libkrb5-dev python-is-python3`
  - Fedora/RHEL: `sudo dnf install @development-tools gcc gcc-c++ make libsecret-devel krb5-devel libX11-devel libxkbfile-devel`
  - openSUSE: `sudo zypper install patterns-devel-C-C++-devel_C_C++ krb5-devel libsecret-devel libxkbfile-devel libX11-devel`

## Build and run

```bash
git clone https://github.com/qwzx4893-stack/Vader.git
cd Vader
npm install
npm run buildreact      # React chat / settings UI (rebuild after touching browser/react/src)
npm run buildcline      # the agent runtime bundle the renderer loads (run after a fresh clone)
npm run watch           # or: npm run compile  (one-off)
./scripts/code.sh       # macOS / Linux          (scripts\code.bat on Windows)
```

Useful flags for `code.sh`: `--user-data-dir ./.tmp/user-data --extensions-dir ./.tmp/extensions` (delete `.tmp` to reset), and reload a running dev window with <kbd>Ctrl/Cmd</kbd>+<kbd>R</kbd>.

### Common problems

- Path to the repo must not contain spaces.
- `Failed to fetch dynamically imported module`: every import must end in `.js`.
- React build runs out of memory: `NODE_OPTIONS="--max-old-space-size=8192" npm run buildreact`.
- `libtool: unrecognised option '-static'` on macOS: put GNU libtool first in `PATH`.
- `The SUID sandbox helper binary was found, but is not configured correctly` on Linux: `sudo chown root:root .build/electron/chrome-sandbox && sudo chmod 4755 .build/electron/chrome-sandbox`.

## Before you open a pull request

The project has no unit-test runner beyond a type check and a set of Node regression tests, so treat a clean type check as the minimum, not as proof.

```bash
node_modules/.bin/tsc -p src/tsconfig.json --noEmit          # must be clean
for t in $(grep -o '[A-Za-z]*E2E' .github/workflows/ci.yml | sort -u); do node src/vs/workbench/contrib/vader/test/$t.mjs || echo "FAILED $t"; done
```

(The exact list CI runs is in [`.github/workflows/ci.yml`](./.github/workflows/ci.yml); CI uses Node 24, so run the tests on that version.) If you touched anything under `browser/react/src/`, run `npm run buildreact` *before* the type check, because `src/tsconfig.json` resolves against the built bundle.

Rules that exist for a reason:

- **Tests for security-relevant changes.** A fix to the policy engine, path handling, or anything an injected model could reach needs a test that fails without it (see `symlinkPolicyE2E.mjs`, `policyBypassE2E.mjs`).
- **Never add a way to disable a `locked: true` policy rule.**
- **Anything that reaches the network** goes through an `electron-main/*MainService.ts` behind an IPC channel, not a `fetch()` from browser code.
- **Renderer code (`browser/`, `common/`) must not import npm packages by bare name.** See `AGENTS.md`.
- **Persisted types** (`ChatMessage`, `ThreadType`) only get optional fields with safe defaults.
- Add a line to [`CHANGELOG.md`](./CHANGELOG.md) for user-visible changes.

## Commit messages and pull requests

Describe *what was wrong and why the change fixes it*, not only what changed. Link the issue. Keep unrelated cleanups out of the same pull request.

## Code of conduct

Be kind and assume good faith. See [`CODE_OF_CONDUCT.md`](./CODE_OF_CONDUCT.md).

## Adding a model provider

Vendors that speak the OpenAI chat-completions protocol are rows in a generated table, not new code: add the vendor to `build/lib/vader/genVendorProviders.py`,
regenerate `common/vendorProviderData.ts`, and run `node src/vs/workbench/contrib/vader/test/vendorProvidersE2E.mjs`. Details in
[`docs/integrations/providers/README.md`](./docs/integrations/providers/README.md). Please link the vendor's own documentation for the gateway URL in the pull request.
