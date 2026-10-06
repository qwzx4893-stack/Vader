/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../../base/common/event.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { hash } from '../../../../../base/common/hash.js';
import { generateUuid } from '../../../../../base/common/uuid.js';
import { registerSingleton, InstantiationType } from '../../../../../platform/instantiation/common/extensions.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../../platform/storage/common/storage.js';
import { RequestedCapabilities, SkillCategory, SkillRecord, SkillTrustState, ISkillService } from './skillServiceTypes.js';

export * from './skillServiceTypes.js';

const VADER_SKILLS_STORAGE_KEY = 'vader.skillServiceStorageI';

// Heuristic, not a claim of real static analysis - see docs/integrations/skills.md. This
// only informs what's SHOWN to the user/model about a skill's likely footprint; it never by
// itself grants or denies anything (that stays with trustState + the Policy Engine).
function detectRequestedCapabilities(instructions: string): RequestedCapabilities {
	const text = instructions.toLowerCase();
	return {
		fs: /\b(read|write|edit|create|delete)\s+(a\s+)?file|\.md\b|file system|filesystem/.test(text),
		terminal: /\bterminal|\bshell|\brun\s+(the\s+)?command|```(bash|sh|shell)|npm (install|run)|pip install|curl /.test(text),
		network: /https?:\/\/|\bapi\b|\bfetch\(|\bwebhook/.test(text),
		mcp: /\bmcp\b|model context protocol/.test(text),
	};
}

class SkillService extends Disposable implements ISkillService {
	readonly _serviceBrand: undefined;

	private readonly _onDidChangeSkills = this._register(new Emitter<void>());
	readonly onDidChangeSkills: Event<void> = this._onDidChangeSkills.event;

	private _skills: SkillRecord[];

	constructor(
		@IStorageService private readonly _storageService: IStorageService,
	) {
		super();
		this._skills = this._readState();
	}

	private _readState(): SkillRecord[] {
		try {
			const raw = this._storageService.get(VADER_SKILLS_STORAGE_KEY, StorageScope.APPLICATION);
			if (!raw) return [];
			const parsed = JSON.parse(raw);
			return Array.isArray(parsed) ? parsed : [];
		} catch {
			return [];
		}
	}

	private _writeState() {
		this._storageService.store(VADER_SKILLS_STORAGE_KEY, JSON.stringify(this._skills), StorageScope.APPLICATION, StorageTarget.USER);
		this._onDidChangeSkills.fire();
	}

	list(): SkillRecord[] { return this._skills.slice(); }
	get(id: string): SkillRecord | undefined { return this._skills.find(s => s.id === id); }
	listActive(): SkillRecord[] { return this._skills.filter(s => s.enabled && s.trustState !== 'blocked'); }

	install(opts: { name: string; description: string; category: SkillCategory; instructions: string; repositoryUrl?: string; version?: string }): SkillRecord {
		// re-installing the same repository is treated as an update, not a duplicate entry -
		// otherwise re-running discovery on something already installed would silently pile
		// up copies of the same skill
		const existing = opts.repositoryUrl ? this._skills.find(s => s.source.repositoryUrl === opts.repositoryUrl) : undefined;
		if (existing) {
			const updated = this.update(existing.id, opts.instructions);
			if (updated) return updated;
		}

		const now = Date.now();
		const record: SkillRecord = {
			id: generateUuid(),
			name: opts.name,
			description: opts.description,
			category: opts.category,
			source: { repositoryUrl: opts.repositoryUrl, version: opts.version },
			instructions: opts.instructions,
			instructionsHash: String(hash(opts.instructions)),
			requestedCapabilities: detectRequestedCapabilities(opts.instructions),
			// never auto-trusted - see ISkillService's doc comment. 'builtin' skills (shipped
			// with Vader itself, none exist yet - this category is here for when they do)
			// are the one legitimate exception, since they ship as part of the product itself.
			trustState: opts.category === 'builtin' ? 'trusted' : 'review_required',
			pinned: false,
			enabled: false, // installing is not the same as turning it on - see setEnabled
			installedAt: now,
			updatedAt: now,
		};
		this._skills = [...this._skills, record];
		this._writeState();
		return record;
	}

	update(id: string, newInstructions: string): SkillRecord | undefined {
		const idx = this._skills.findIndex(s => s.id === id);
		if (idx === -1) return undefined;
		const existing = this._skills[idx];
		const newHash = String(hash(newInstructions));
		const contentChanged = newHash !== existing.instructionsHash;

		const updated: SkillRecord = {
			...existing,
			instructions: newInstructions,
			instructionsHash: newHash,
			requestedCapabilities: detectRequestedCapabilities(newInstructions),
			updatedAt: Date.now(),
			// the one automatic trust-state transition this service ever makes: a
			// content-changed update to a previously-trusted skill is downgraded back to
			// review_required. Promotion back to 'trusted' is always a fresh, explicit user
			// decision - an external update can silently GAIN trust, only ever silently LOSE it.
			trustState: contentChanged && existing.trustState === 'trusted' ? 'review_required' : existing.trustState,
		};
		this._skills = this._skills.map((s, i) => i === idx ? updated : s);
		this._writeState();
		return updated;
	}

	setEnabled(id: string, enabled: boolean): void {
		const skill = this.get(id);
		if (!skill) return;
		if (enabled && skill.trustState === 'blocked') return; // a blocked skill cannot be enabled, full stop
		this._skills = this._skills.map(s => s.id === id ? { ...s, enabled, updatedAt: Date.now() } : s);
		this._writeState();
	}

	setPinned(id: string, pinned: boolean): void {
		this._skills = this._skills.map(s => s.id === id ? { ...s, pinned } : s);
		this._writeState();
	}

	setTrustState(id: string, trustState: SkillTrustState): void {
		const skill = this.get(id);
		if (!skill) return;
		// moving TO blocked also disables the skill - a blocked-but-enabled state would be
		// contradictory, and listActive() already excludes blocked skills regardless, but
		// keeping `enabled` honest avoids a confusing "enabled" toggle on something that can
		// never actually run
		const enabled = trustState === 'blocked' ? false : skill.enabled;
		this._skills = this._skills.map(s => s.id === id ? { ...s, trustState, enabled, updatedAt: Date.now() } : s);
		this._writeState();
	}

	remove(id: string): void {
		this._skills = this._skills.filter(s => s.id !== id);
		this._writeState();
	}
}

registerSingleton(ISkillService, SkillService, InstantiationType.Delayed);
