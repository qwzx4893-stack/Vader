# Roadmap

What is done, what is next, and what is deliberately not planned. Items are ordered by how much they help someone using Vader every day, not by effort.
For the honest list of what is thin today, read [`docs/PRODUCT_ASSESSMENT.md`](./docs/PRODUCT_ASSESSMENT.md); for what changed, [`CHANGELOG.md`](./CHANGELOG.md).

## Done

- A real agent runtime with 43 tools, plan mode, checkpoints, sub-agents, permanent agents with scopes, MCP and a skills marketplace
- A hard policy engine in front of every tool call (locked rules cannot be switched off), with symbolic-link and `..` resolution
- 49 model providers, each native in Settings, searchable, with live model lists where the vendor has one
- No telemetry, measured with a network trace in the test suite
- Windows build, installer and an end-to-end suite that drives the installed app; zero known advisories across all lockfiles, enforced in CI

## Next

- [ ] Code-signed installers and an update channel
- [ ] macOS and Linux installers built and tested in CI (the Linux package is built and exercised locally already)
- [ ] A task-success benchmark with a strong model (pass@k) and long-session soak tests; needs a provider key and a spend limit
- [ ] Live verification of each vendor gateway against its real service when a maintainer has keys (the endpoints are from vendor documentation today)
- [ ] Opt-in, local-first crash reports

## Not planned

- Any server operated by the project: no account, no sync service, no analytics
- Reaching the network from renderer code: every outbound call goes through an `electron-main` service so it stays auditable

Ideas and votes are welcome in [issues](../../issues/new/choose); security reports go through [`SECURITY.md`](./SECURITY.md).
