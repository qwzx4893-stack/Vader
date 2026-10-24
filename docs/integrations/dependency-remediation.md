# Dependency remediation in progress

Status: PARTIAL. This source candidate must not be called security-verified or
merged on the strength of the earlier advisory exceptions. No release or installer
was produced by this work.

The unsupported package-name waivers introduced in `51a007c8` have been removed.
Compatible patches were applied in the lockfiles for Zod 4, Undici, body-parser,
fast-uri and serialize-javascript. The audit gate now covers every repository
lockfile and rejects registry/spawn/malformed-report errors rather than treating
them as empty vulnerability reports.

The remaining findings require source-compatible remediation:

- [Zod GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5):
  root/remote `@vscode/sandbox-runtime` and root `dify-ai-provider` still require
  Zod 3.25.76. No patched stable Zod 3 package was published at the review time.
  Actual parser probes reproduce issue amplification. The `zod/v3` entrypoint in
  a patched Zod 4 package still contains the old parser behavior; changing only
  the package version does not repair that path.
- [MSAL GHSA-xcx6-jx8p-x3h5](https://github.com/advisories/GHSA-xcx6-jx8p-x3h5):
  build Azure Identity and the Microsoft authentication extension retain affected
  MSAL versions. Patched MSAL 7.1.1 removes interfaces/options used by the
  extension's protocol-handler authentication flow. An isolated compile of the
  unchanged extension gives six errors with 7.1.1; its installed baseline passes.
  Dropping the callback flow or casting away those errors is not an acceptable fix.

Run `node src/vs/workbench/contrib/vader/test/shippedAdvisoriesE2E.mjs` from the
repository root for current registry results. The reviewed compatible-update
candidate audited 62 lockfiles and exited 1 with 97 checks passing and two
aggregate checks failing. New advisories can change this result.

Dry-run installation plans and dependency constraints passed, but the local
node_modules trees were not replaced. Actual candidate installation, type checks,
native integrations and Windows runtime CI remain required. Passing UI tests with
older installed dependencies does not verify compatibility with the new locks.
