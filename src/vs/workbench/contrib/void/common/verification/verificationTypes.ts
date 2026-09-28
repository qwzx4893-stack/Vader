/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../../../platform/instantiation/common/instantiation.js';

export type VerificationCheck = {
	name: string;
	command: string;
	passed: boolean;
	exitCode: number | null;
	outputTail: string;
};

// Real, gathered evidence - never invented, never a claim by the implementer about its own
// work. See verificationService.ts's gatherEvidence for exactly what backs each field.
export type VerificationEvidence = {
	gitDiffStat: string; // '' if no git repo, or nothing to diff
	diagnosticsSummary: string; // current IMarkerService errors/warnings across changed files, '' if none
	checks: VerificationCheck[]; // build/typecheck/lint/test - reuses run_verification's own auto-detection, not a second implementation of it
	checksDetected: boolean; // false = no auto-detectable checks exist for this project - NEVER treated as "passing"
};

export type VerificationFindingSeverity = 'blocker' | 'warning' | 'info';

export type VerificationFinding = {
	severity: VerificationFindingSeverity;
	description: string;
	location?: string;
};

export type VerificationVerdict = {
	passed: boolean;
	findings: VerificationFinding[];
	summary: string;
};

export type VerifyRepairLoopResult = {
	finalVerdict: VerificationVerdict;
	iterations: number;
	repairConclusions: string[];
};

/**
 * The Verification Agent: independent of whatever implemented the change (it runs in its
 * own hidden thread, with no ability to edit anything - see chatThreadService.ts's
 * isVerificationThread, which hard-enforces this exactly like Plan/Gather mode does,
 * regardless of the user's current global chat mode), inspecting real evidence (git diff,
 * live diagnostics, build/lint/test results) rather than being asked "did you do a good
 * job?" of the same context that made the change. See docs/integrations/verification.md.
 */
export interface IVerificationService {
	readonly _serviceBrand: undefined;

	/** gathers real evidence about the current state of the workspace - no LLM judgment yet */
	gatherEvidence(): Promise<VerificationEvidence>;

	/** one independent verification pass: gathers evidence, then asks a fresh, read-only, separate-context agent thread to judge it against the stated objective */
	runIndependentVerification(opts: { objective: string }): Promise<{ evidence: VerificationEvidence; verdict: VerificationVerdict }>;

	/**
	 * Bounded verify -> repair -> re-verify loop: runs independent verification; if it
	 * finds a blocker, delegates a repair subagent task describing exactly what's wrong
	 * (via the Agent Gateway, same as any other delegation) and re-verifies - up to
	 * maxIterations (default 3). Never loops unboundedly, and a verdict with only
	 * warnings/info (no blockers) is accepted without spending a repair iteration on it.
	 */
	runVerifyRepairLoop(opts: { objective: string; maxIterations?: number }): Promise<VerifyRepairLoopResult>;
}

export const IVerificationService = createDecorator<IVerificationService>('vaderVerificationService');
