/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IMainProcessService } from '../../../../platform/ipc/common/mainProcessService.js';
import { ProxyChannel } from '../../../../base/parts/ipc/common/ipc.js';
import { IMarkerService, MarkerSeverity } from '../../../../platform/markers/common/markers.js';
import { IVoidSCMService } from '../common/voidSCMTypes.js';
import { IToolsService } from './toolsService.js';
import { IAgentGatewayService } from './agentGatewayService.js';
import { IVerificationService, VerificationEvidence, VerifyRepairLoopResult, VerificationVerdict } from '../common/verification/verificationTypes.js';

export * from '../common/verification/verificationTypes.js';

const DEFAULT_MAX_ITERATIONS = 3;

class VerificationService extends Disposable implements IVerificationService {
	readonly _serviceBrand: undefined;

	private readonly _scmService: IVoidSCMService;

	constructor(
		@IWorkspaceContextService private readonly _workspaceContextService: IWorkspaceContextService,
		@IMarkerService private readonly _markerService: IMarkerService,
		@IToolsService private readonly _toolsService: IToolsService,
		@IAgentGatewayService private readonly _agentGatewayService: IAgentGatewayService,
		mainProcessService: IMainProcessService,
	) {
		super();
		// same proxy pattern contextEngineService.ts and voidSCMService.ts's commit-message
		// generator use - real git commands stay in electron-main
		this._scmService = ProxyChannel.toService<IVoidSCMService>(mainProcessService.getChannel('void-channel-scm'));
	}

	async gatherEvidence(): Promise<VerificationEvidence> {
		const repoPath = this._workspaceContextService.getWorkspace().folders[0]?.uri.fsPath;

		const gitDiffStat = repoPath ? await this._scmService.gitStat(repoPath).catch(() => '') : '';

		const markers = this._markerService.read({ severities: MarkerSeverity.Warning | MarkerSeverity.Error });
		const diagnosticsSummary = markers.length === 0 ? '' : markers
			.slice(0, 50)
			.map(m => `${m.resource.fsPath}:${m.startLineNumber}: [${MarkerSeverity.toString(m.severity)}] ${m.message}`)
			.join('\n');

		// reuses run_verification's own project-command auto-detection rather than
		// re-implementing it - see toolsService.ts's callTool.run_verification
		const { result } = await this._toolsService.callTool['run_verification']({});
		const { checks, detected } = await result;

		return { gitDiffStat, diagnosticsSummary, checks, checksDetected: detected };
	}

	private _renderEvidence(evidence: VerificationEvidence): string {
		const parts: string[] = [];
		parts.push(evidence.gitDiffStat ? `## Uncommitted changes (git diff --stat)\n${evidence.gitDiffStat}` : `## Uncommitted changes\n(no git repository, or nothing uncommitted)`);
		parts.push(evidence.diagnosticsSummary ? `## Current diagnostics (errors/warnings)\n${evidence.diagnosticsSummary}` : `## Current diagnostics\n(none)`);
		if (!evidence.checksDetected) {
			parts.push(`## Build/typecheck/lint/test results\nNo auto-detectable checks exist for this project (no readable package.json, or no build/typecheck/lint/test scripts). This is NOT evidence of correctness - it means nothing was actually run. Treat the objective as unverified by automated checks and rely more heavily on diff/diagnostic inspection and your own read-only investigation.`);
		} else if (evidence.checks.length === 0) {
			parts.push(`## Build/typecheck/lint/test results\npackage.json exists but defines no recognized scripts to run. Same caveat as above: absence of checks is not evidence of correctness.`);
		} else {
			const lines = evidence.checks.map(c => `${c.passed ? 'PASS' : 'FAIL'} ${c.name} (\`${c.command}\`, exit ${c.exitCode ?? 'timeout'})${c.passed ? '' : `\n  tail: ${c.outputTail.slice(-1000)}`}`);
			parts.push(`## Build/typecheck/lint/test results\n${lines.join('\n')}`);
		}
		return parts.join('\n\n');
	}

	async runIndependentVerification(opts: { objective: string }): Promise<{ evidence: VerificationEvidence; verdict: VerificationVerdict }> {
		const evidence = await this.gatherEvidence();
		const evidenceText = this._renderEvidence(evidence);
		const verdict = await this._agentGatewayService.runVerificationTask({ objective: opts.objective, evidenceText });
		return { evidence, verdict };
	}

	async runVerifyRepairLoop(opts: { objective: string; maxIterations?: number }): Promise<VerifyRepairLoopResult> {
		const maxIterations = opts.maxIterations ?? DEFAULT_MAX_ITERATIONS;
		const repairConclusions: string[] = [];
		let iterations = 0;
		let verdict: VerificationVerdict;

		while (true) {
			iterations += 1;
			const round = await this.runIndependentVerification({ objective: opts.objective });
			verdict = round.verdict;

			const blockers = verdict.findings.filter(f => f.severity === 'blocker');
			if (blockers.length === 0) break; // passed, or only warnings/info - never spend a repair iteration on those
			if (iterations >= maxIterations) break; // bounded - never loops unboundedly

			const repairTask = `A verification pass found the following problem(s) with work meant to accomplish this objective:

Objective: ${opts.objective}

Blockers found:
${blockers.map(f => `- ${f.description}${f.location ? ` (${f.location})` : ''}`).join('\n')}

Fix these specific problems. Do not make unrelated changes.`;

			const repairResult = await this._agentGatewayService.runIsolatedTask({ task: repairTask });
			repairConclusions.push(repairResult.conclusion);
		}

		return { finalVerdict: verdict!, iterations, repairConclusions };
	}
}

registerSingleton(IVerificationService, VerificationService, InstantiationType.Delayed);
