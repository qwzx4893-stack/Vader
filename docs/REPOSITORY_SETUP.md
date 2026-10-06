# Repository settings (done in GitHub, not in code)

These settings live in GitHub's web interface. Everything that *can* be kept in the repository is (the ruleset below, the workflows, the
social-preview image); the rest is a few minutes of clicking.

## 1. About box (description, website, topics)

Repository page → the gear icon next to **About**.

**Description** (paste):

> AI-native IDE for agents you can trust: a full VS Code workbench plus an autonomous coding agent (Cline runtime) behind a hard policy engine. 49 model providers, local or hosted. MCP, browser automation, zero telemetry. Apache-2.0.

**Website:** `https://github.com/qwzx4893-stack/Vader/releases`

**Topics** (these are the blue tags that make the repository discoverable; paste them one by one, 20 is GitHub's maximum):

`ai-ide` `code-editor` `ai-coding-assistant` `coding-agent` `ai-agents` `vscode` `vscode-fork` `electron` `typescript` `cline`
`void-editor` `mcp` `model-context-protocol` `llm` `openai` `anthropic` `ollama` `local-llm` `developer-tools` `open-source`

Tick **Releases** and untick **Packages / Deployments** in the same dialog if you do not use them.

## 2. Social preview image

Settings → General → **Social preview** → upload `docs/assets/social-preview.png` (1280×640).

## 3. Delete the extra branches

All their commits are already in `main` (checked: zero commits ahead). Branches page: `https://github.com/qwzx4893-stack/Vader/branches`
→ the trash icon on each row. Delete:

- `upgrade/vscode-1.136.2`
- `claude/vader-product-rebranding-nt90sc`
- the six `dependabot/...` branches (close or merge the matching Dependabot pull requests first if you want those updates)

Or from any machine with push rights:

```bash
git push origin --delete upgrade/vscode-1.136.2 claude/vader-product-rebranding-nt90sc
git push origin --delete $(git branch -r | sed -n 's#^ *origin/\(dependabot/.*\)#\1#p')
```

Settings → General → Pull Requests → tick **Automatically delete head branches** so merged branches clean themselves up from now on.

## 4. Protect `main`

Settings → **Rules** → **Rulesets** → **New ruleset** → **Import a ruleset** → choose `.github/rulesets/protect-main.json`, then **Create**.

What it enforces on the default branch:

- `main` cannot be deleted and history cannot be rewritten (no force pushes);
- every change arrives through a pull request (no required approvals, so you can still merge your own), with review conversations resolved;
- the `Type check and regression tests` check (workflow **CI**) must pass.

No bypass actors are configured: even the owner goes through a pull request. If you ever need an emergency override, add the **Repository admin**
role under *Bypass list* in that ruleset.

Also worth turning on (Settings → **Code security**): Dependabot alerts and security updates, secret scanning with push protection, and private
vulnerability reporting (the path described in `SECURITY.md`).

## 5. Secrets used by workflows

| Secret | Used by | Needed? |
|---|---|---|
| `OPENROUTER_API_KEY` | `openrouter-free-e2e.yml` (free-model run through the real app) | optional |
| `WINDOWS_CERT_PFX_BASE64`, `WINDOWS_CERT_PASSWORD` | `windows-build.yml` code signing | optional (installer is unsigned without them) |

## 6. Publishing a release

Actions → **Windows Build** → **Run workflow** on `main`, set **publish** to true. The release is named `Vader <vaderVersion>` (from
`product.json`), carries `Vader-Setup-<arch>-<version>.exe`, and, with **remove_previous_releases** set, deletes every other release and tag.
