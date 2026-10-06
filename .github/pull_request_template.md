## What and why

<!-- What was wrong or missing, and how this change fixes it. Link the issue. -->

## How it was verified

- [ ] `node_modules/.bin/tsc -p src/tsconfig.json --noEmit` is clean
- [ ] The regression tests listed in `.github/workflows/ci.yml` pass (CI uses Node 24)
- [ ] Security-relevant change: a test that fails without the fix is included
- [ ] User-visible change: `CHANGELOG.md` updated
