# Skill lifecycle and security

**Contract:** `ISkillService` in `common/skills/skillServiceTypes.ts`. **Implementation:** `common/skills/skillService.ts`. **Tool:** `install_skill`. **Settings UI:** `SkillsSection` in `vader-settings-tsx/Settings.tsx`.

## What existed before this, and the gap it left

`common/discovery/` already did real, live search against SkillNet and could fetch a skill's raw instructions text (`search_skillnet`, `fetch_skill_instructions`) - genuinely working, not stubbed. But that was the entire lifecycle: discovery only. A comment in `discoveryServiceTypes.ts` referenced "`skills/skillProviderTypes.ts` for the provider abstraction this feeds," describing a file that was never actually created - install/cache/pin/enable/disable/update/remove and any trust model didn't exist. This closes that gap for real.

## The lifecycle

`install` → `SkillsSection` (review/enable/trust/block/pin/remove) → `update` (content-change-aware) → `remove`. Every state transition is a real, callable `ISkillService` method, not a plan for one:

- **Install** (`install_skill` tool, or `ISkillService.install` directly): takes instructions text the caller already has (from `fetch_skill_instructions`, or the agent's own writing) and creates a `SkillRecord`. Re-installing a `repositoryUrl` that's already installed is treated as an **update**, not a duplicate - discovery finding something already present doesn't pile up copies.
- **Cache**: the instructions text itself *is* the cache - once installed, nothing needs to hit SkillNet again to use it.
- **Pin**: `setPinned` - marks a skill as never subject to any future automatic cache-eviction policy (none exists yet, since there's no unbounded growth to evict - this is forward-compatible plumbing, not decoration).
- **Enable/Disable**: `setEnabled` - governs whether the skill's instructions are actually composed into a system prompt (see below). Cannot enable a `blocked` skill; this is enforced in the service, not just the UI.
- **Update**: `update(id, newInstructions)` - the only place `instructionsHash` (a `base/common/hash.ts` hash of the content, not cryptographic - only needs to detect change, not resist tampering) is compared. If the content actually changed **and** the skill was `trusted`, it's automatically downgraded to `review_required`. This is the literal mechanism behind the mission's requirement that an external update can never silently keep trusted status - promotion back to `trusted` is always a fresh, explicit `setTrustState` call from the user; demotion away from it can happen automatically, promotion never can.
- **Remove**: `remove(id)` - deletes the record outright.

## Trust states - defense in depth, not a claim of static analysis

This codebase has no sandboxed execution environment or static analyzer to run a skill's instructions through, so `SkillTrustState` doesn't pretend one exists:

- `review_required` (the default for every new install and every content-changed update): still composed into the system prompt (a skill's whole point is being usable), but wrapped with an explicit "(UNVERIFIED - not yet reviewed...)" label so both the model and the user (reading Settings) see it hasn't been vetted.
- `trusted`: composed without the label. Reachable only via an explicit `setTrustState(id, 'trusted')` - the service itself never sets this.
- `blocked`: never composed into any system prompt at all, and `setEnabled(id, true)` is a no-op against it. Reachable only via explicit `setTrustState(id, 'blocked')` (there's no automatic content heuristic that blocks a skill - false positives on a blanket "looks dangerous" scan would be worse than the risk it's guarding against, given this is defense-in-depth on top of the Policy Engine, not the only layer).

`requestedCapabilities` (`fs`/`terminal`/`network`/`mcp`) is a plain keyword heuristic over the instructions text (`detectRequestedCapabilities` in `skillService.ts`) shown in the Settings UI so a reviewer has a quick signal of a skill's likely footprint before reading the whole thing - it is explicitly not used to grant or deny anything itself.

## Routed through the Policy Engine - by not bypassing it

A skill's instructions are text in the system prompt, same tier as `.vaderrules` or an agent's own instructions - they can *suggest* a tool call, but every tool call a skill's advice leads to still goes through the exact same Policy Engine and agent-scope gates as any other (see `chatThreadService.ts`'s `_runToolCall`). A `blocked` skill's advice can't even reach the model in the first place, since it's never composed; a `review_required` skill's advice can reach the model, but nothing about `review_required` weakens the Policy Engine underneath it. This is the correct division of labor: skill trust controls what the model gets *told*; the Policy Engine controls what actually *executes*, regardless of what it was told.

## Wired into the Capability Bus

`installed-skill` is a new `CapabilitySource` in `common/capabilities/capabilityBusTypes.ts` - `listLocalCapabilities()` now includes every installed skill (with `trust`/`available` reflecting its real state), so the Capability Resolver's local-first resolution order sees "you already have something installed for this, even if it's not enabled yet" before it would otherwise suggest re-discovering or re-installing a duplicate from SkillNet.

## What's not built

- No sandboxed execution or static analysis of a skill's content - stated above, not hidden.
- No skill-authored MCP server auto-configuration - a skill that requests `mcp` capability is flagged for the reviewer, but installing a skill never touches `mcp.json` itself.
