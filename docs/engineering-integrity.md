# Engineering integrity: executable evidence and scoped review

This adds a local verifier and a CI self-test. It does not change the agent runtime, model, permissions, or test expectations. Instructions guide behavior; checks only enforce their tested scope. Nothing here establishes that Vader's outstanding performance/UI issues are fixed.

## Task acceptance and verification

Before a substantial change, record each observable acceptance criterion, affected path/dependency, required layer, and evidence location. Use VERIFIED / IMPLEMENTED BUT UNVERIFIED / PARTIAL / FAILED / BLOCKED / NOT STARTED. Keep routine edits proportionate. Do not change criteria after the fact to fit incomplete work.

Use existing commands, after inspecting the applicable source and CI:

| Scope | Actual check | What it establishes |
| --- | --- | --- |
| Integrity tooling | `python -B -m unittest discover -s build/integrity -p test_integrity.py -v` | Disposable adversarial fixtures, including real child-process failures |
| TypeScript changes | `node_modules/.bin/tsc -p src/tsconfig.json --noEmit` (Windows: invoke the installed TypeScript entry with Node) | Static type check; preserve baseline failures |
| React source changes | `npm run buildreact`, then `node src/vs/workbench/contrib/vader/test/reactTypecheckE2E.mjs` and affected `*UiE2E.mjs` | Bundle/type/component behavior, not installed-app behavior; run UI suites serially |
| Cline renderer boundary | `npm run buildcline`, then `node src/vs/workbench/contrib/vader/test/clineBundleBrowserE2E.mjs` | Runtime in Chromium without Node globals |
| Tools/policy | Relevant existing suites in `.github/workflows/ci.yml`, e.g. `node src/vs/workbench/contrib/vader/test/policyBypassE2E.mjs` | The paths and assertions that actually ran |
| Packaged Windows journey | Existing Windows build/smoke/E2E workflows, with owner's authorization | Specific installed-app scenarios; not a guarantee about resource use |
| Real provider/agent quality | Existing live-agent and real-model suites, with service access and cost approval as applicable | Only the actual vendor interactions/tasks performed; mocks do not count |

No new installer build or external workflow dispatch is authorized by these instructions. Do not turn a historical approval into a new one. Missing credentials, unavailable services, and unexecuted commands stay BLOCKED/UNVERIFIED/NOT RUN.

## Reproducible local evidence

Review a command plan before running it: it executes trusted argv directly, not a sandbox. Python 3.10+ is required; no dependencies are installed. Use a fresh evidence directory outside the source tree:

```text
python -B build/integrity/integrity.py run --plan build/integrity/plan.json --root . --evidence <fresh-directory>
python -B build/integrity/integrity.py audit --plan build/integrity/plan.json --root . --evidence <same-directory>
python -B build/integrity/integrity.py scan --root . --base HEAD
```

The committed plan verifies the integrity tooling only. It is not a plan for all of Vader. For another task, define a reviewed plan with `version: 1`, explicit `inputs`, gates (`id`, `argv`, `level`, `timeout`, optional `reject_output`), and criteria (`id`, observable `behavior`, required `gates`, required `levels`). Include every relevant source/test/config input; files not listed are not fingerprinted. Verification levels: static/build/unit/integration/e2e/manual. An automated command labeled manual is not proof that a person looked at the app; choose labels honestly and review evidence semantics.

Each run preserves actual exit codes, combined output, duration, plan/input hashes and missing gates. `--gate ID` selects checks, but unselected gates remain NOT RUN and audit rejects incomplete evidence. A nonzero exit is never rewritten as success. A timeout kills only the process tree started for that check. Gate output can be checked for known failure/skip summaries even when a defective test harness exits zero.

`audit --claim <report.json>` additionally challenges a structured completion claim, for example a `final_status` and `criteria` array with `id` and `state`. This validates structured evidence, not arbitrary prose or truth of an assertion. A forged log with correspondingly forged hashes is outside its protection. No digital signatures or remote attestation are provided.

## Anti-gaming review

The tracked-diff scanner flags probable production placeholders, skipped/only tests, removed assertions and failure suppression. Exit 3 means REVIEW_REQUIRED. A clean scan means only NO_HEURISTIC_FINDINGS. It cannot prove completeness or identify every hardcoded response, no-op, meaningless test, or suppressed exception. Review untracked files and the final diff manually. Legitimate removals require behavioral justification, not weakening tests to satisfy the scanner.

Never pass credentials in argv; logs redact common tokens/Bearer headers only, not every secret. Keep evidence local/private and review before sharing.

For substantial changes a separate reviewer inspects the actual diff, acceptance criteria and raw evidence and may rerun critical checks. Identify the reviewer; a second pass by the implementer is SELF-REVIEW.

## Enforcement boundary

The CI workflow runs these adversarial tests and audits their evidence before existing build/typecheck/regression steps. This is configured in the local checkout. It is not externally enforced until pushed, executed on GitHub, and made required by authorized branch protection. Existing CI/build/security workflows are retained. No branch protection, CODEOWNERS, permissions, model settings or global configuration are changed by this repository patch.

## Completion report

Report scope, changes, commands/outcomes/evidence, criterion matrix, limitations, and integrity/review findings. A successful build is not runtime verification. Use final VERIFIED only if all essential criteria have appropriate evidence; otherwise PARTIAL / FAILED / BLOCKED / UNVERIFIED.
