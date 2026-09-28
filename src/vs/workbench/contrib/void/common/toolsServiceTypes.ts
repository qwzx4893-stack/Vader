import { URI } from '../../../../base/common/uri.js'
import { RawMCPToolCall } from './mcpServiceTypes.js';
import { builtinTools } from './prompt/prompts.js';
import { RawToolParamsObj } from './sendLLMMessageTypes.js';



export type TerminalResolveReason = { type: 'timeout' } | { type: 'done', exitCode: number }

export type LintErrorItem = { code: string, message: string, startLineNumber: number, endLineNumber: number }

// Partial of IFileStat
export type ShallowDirectoryItem = {
	uri: URI;
	name: string;
	isDirectory: boolean;
	isSymbolicLink: boolean;
}


export const approvalTypeOfBuiltinToolName: Partial<{ [T in BuiltinToolName]?: 'edits' | 'terminal' | 'MCP tools' }> = {
	'create_file_or_folder': 'edits',
	'delete_file_or_folder': 'edits',
	'rewrite_file': 'edits',
	'edit_file': 'edits',
	'run_command': 'terminal',
	'run_persistent_command': 'terminal',
	'open_persistent_terminal': 'terminal',
	'kill_persistent_terminal': 'terminal',
	// Vader addition: creating a persistent agent is a mutating, persistent action, so it
	// reuses the 'edits' approval bucket rather than introducing a new one.
	'create_persistent_agent': 'edits',
	// Vader addition: writing persistent memory (project or agent-scoped) outlives this
	// turn and silently shapes every future turn's context, so it reuses the 'edits' bucket
	// rather than being auto-approved like a read-only lookup.
	'remember': 'edits',
	// Vader addition: installing a skill persists it and (once the user reviews/enables it)
	// feeds its instructions into every future system prompt - a persistent, trust-relevant
	// action, same tier as remember/create_persistent_agent.
	'install_skill': 'edits',
	// Vader addition: delegating a task can itself cause file edits/terminal commands
	// (via the subagent's own thread, which auto-approves those on itself - see
	// chatThreadService.ts), so starting a delegation at all goes through 'edits' approval.
	'delegate_subagent_task': 'edits',
	// Vader addition: same reasoning as delegate_subagent_task, but for several tasks at
	// once (see common/orchestration/) - worktree-isolated tasks can commit real changes.
	'delegate_parallel_tasks': 'edits',
	'run_verification': 'terminal',
	// Vader addition: this can run build/lint/test commands (via run_verification) and
	// delegate repair subagent tasks that edit files - same 'terminal' tier as
	// run_verification itself, since that's the actual side-effecting part.
	'run_verification_agent': 'terminal',
	'browser_new_page': 'terminal',
	'browser_switch_page': 'terminal',
	'browser_close_page': 'terminal',
	'browser_navigate': 'terminal',
	'browser_reload': 'terminal',
	'browser_click': 'terminal',
	'browser_type': 'terminal',
}


export type ToolApprovalType = NonNullable<(typeof approvalTypeOfBuiltinToolName)[keyof typeof approvalTypeOfBuiltinToolName]>;


export const toolApprovalTypes = new Set<ToolApprovalType>([
	...Object.values(approvalTypeOfBuiltinToolName),
	'MCP tools',
])




// PARAMS OF TOOL CALL
export type BuiltinToolCallParams = {
	'read_file': { uri: URI, startLine: number | null, endLine: number | null, pageNumber: number },
	'ls_dir': { uri: URI, pageNumber: number },
	'get_dir_tree': { uri: URI },
	'search_pathnames_only': { query: string, includePattern: string | null, pageNumber: number },
	'search_for_files': { query: string, isRegex: boolean, searchInFolder: URI | null, pageNumber: number },
	'search_in_file': { uri: URI, query: string, isRegex: boolean },
	'read_lint_errors': { uri: URI },
	// Vader addition: external capability/skill discovery (read-only, no approval needed -
	// same trust tier as search_for_files. See common/discovery/.)
	'search_mcp_registry': { query: string },
	'search_skillnet': { query: string },
	'fetch_skill_instructions': { repositoryUrl: string },
	// Vader addition: verification pipeline. Read-only in the sense that it only *runs*
	// whatever build/lint/test scripts the project already defines - it's classified as a
	// 'terminal' action (same approval bucket as run_command) because that's exactly what
	// it does under the hood.
	'run_verification': {},
	// Vader addition: independent verification with a bounded verify->repair->re-verify
	// loop - see common/verification/. Distinct from run_verification (which is just the
	// deterministic build/lint/test step this also uses as part of its evidence).
	'run_verification_agent': { objective: string, maxIterations: number | null },
	'find_capability': { query: string },
	// Vader addition: browser automation, multi-tab. Snapshot/screenshot/console/page-errors/
	// network-log/list-pages are read-only; navigate/click/type/new-page/switch/close can
	// cause real page side effects (submitting a form, following a link) or manage real OS
	// resources (a browser tab) and go through the 'terminal' approval bucket, the same tier
	// as running a shell command against the outside world. Every action takes an optional
	// page_id (targets the active page, auto-created if none exists, when omitted) - see
	// docs/integrations/browser-backend.md.
	'browser_new_page': {},
	'browser_list_pages': {},
	'browser_switch_page': { pageId: string },
	'browser_close_page': { pageId: string },
	'browser_navigate': { url: string, pageId: string | null },
	'browser_reload': { pageId: string | null },
	'browser_snapshot': { pageId: string | null },
	'browser_click': { ref: string, pageId: string | null },
	'browser_type': { ref: string, text: string, submit: boolean, pageId: string | null },
	'browser_screenshot': { pageId: string | null },
	'browser_console_logs': { pageId: string | null },
	'browser_page_errors': { pageId: string | null },
	'browser_network_log': { pageId: string | null },
	// ---
	'rewrite_file': { uri: URI, newContent: string },
	'edit_file': { uri: URI, searchReplaceBlocks: string },
	'create_file_or_folder': { uri: URI, isFolder: boolean },
	'delete_file_or_folder': { uri: URI, isRecursive: boolean, isFolder: boolean },
	// ---
	'run_command': { command: string; cwd: string | null, terminalId: string },
	'open_persistent_terminal': { cwd: string | null },
	'run_persistent_command': { command: string; persistentTerminalId: string },
	'kill_persistent_terminal': { persistentTerminalId: string },
	// ---
	'create_persistent_agent': { name: string, description: string, instructions: string, allowedApprovalTypes: ToolApprovalType[] | null, filesystemScopeGlobs: string[] | null },
	'delegate_subagent_task': { task: string, agentName: string | null },
	// Vader addition: run several subagent tasks with real bounded concurrency - see
	// common/orchestration/. tasksJson is a JSON array of
	// {task: string, agent_name?: string, uses_worktree?: boolean}.
	'delegate_parallel_tasks': { specs: import('./orchestration/orchestrationTypes.js').ParallelTaskSpec[] },
	// Vader addition: write to persistent memory (common/memory/). 'project' memory is
	// visible to every future thread in this workspace; 'agent' memory requires agentName
	// and is visible only to threads running as that permanent agent.
	'remember': { content: string, label: string, scope: 'project' | 'agent', agentName: string | null },
	// Vader addition: install a skill you already have the instructions text for (via
	// fetch_skill_instructions, or your own distilled instructions) - see common/skills/.
	// Installed skills start disabled and 'review_required'; the user enables/trusts them.
	'install_skill': { name: string, description: string, instructions: string, repositoryUrl: string | null },
}

// RESULT OF TOOL CALL
export type BuiltinToolResultType = {
	'read_file': { fileContents: string, totalFileLen: number, totalNumLines: number, hasNextPage: boolean },
	'ls_dir': { children: ShallowDirectoryItem[] | null, hasNextPage: boolean, hasPrevPage: boolean, itemsRemaining: number },
	'get_dir_tree': { str: string, },
	'search_pathnames_only': { uris: URI[], hasNextPage: boolean },
	'search_for_files': { uris: URI[], hasNextPage: boolean },
	'search_in_file': { lines: number[]; },
	'read_lint_errors': { lintErrors: LintErrorItem[] | null },
	'search_mcp_registry': { results: import('./discovery/discoveryServiceTypes.js').McpRegistrySearchResult[] },
	'search_skillnet': { results: import('./discovery/discoveryServiceTypes.js').SkillNetSearchResult[] },
	'fetch_skill_instructions': { content: string | null },
	'run_verification': { checks: { name: string, command: string, passed: boolean, exitCode: number | null, outputTail: string }[], detected: boolean },
	'run_verification_agent': import('./verification/verificationTypes.js').VerifyRepairLoopResult,
	'find_capability': { results: import('./capabilities/capabilityBusTypes.js').CapabilityDescriptor[] },
	'browser_new_page': import('./browser/browserToolServiceTypes.js').BrowserSnapshot,
	'browser_list_pages': { pages: import('./browser/browserToolServiceTypes.js').PageSummary[] },
	'browser_switch_page': import('./browser/browserToolServiceTypes.js').BrowserSnapshot,
	'browser_close_page': {},
	'browser_navigate': import('./browser/browserToolServiceTypes.js').BrowserSnapshot,
	'browser_reload': import('./browser/browserToolServiceTypes.js').BrowserSnapshot,
	'browser_snapshot': import('./browser/browserToolServiceTypes.js').BrowserSnapshot,
	'browser_click': import('./browser/browserToolServiceTypes.js').BrowserSnapshot,
	'browser_type': import('./browser/browserToolServiceTypes.js').BrowserSnapshot,
	'browser_screenshot': { filePath: string },
	'browser_console_logs': { logs: import('./browser/browserToolServiceTypes.js').ConsoleLogEntry[] },
	'browser_page_errors': { errors: import('./browser/browserToolServiceTypes.js').PageErrorEntry[] },
	'browser_network_log': { entries: import('./browser/browserToolServiceTypes.js').NetworkEntry[] },
	// ---
	'rewrite_file': Promise<{ lintErrors: LintErrorItem[] | null }>,
	'edit_file': Promise<{ lintErrors: LintErrorItem[] | null }>,
	'create_file_or_folder': {},
	'delete_file_or_folder': {},
	// ---
	'run_command': { result: string; resolveReason: TerminalResolveReason; },
	'run_persistent_command': { result: string; resolveReason: TerminalResolveReason; },
	'open_persistent_terminal': { persistentTerminalId: string },
	'kill_persistent_terminal': {},
	// ---
	'create_persistent_agent': { agentId: string },
	'delegate_subagent_task': { threadId: string, conclusion: string, changedFilePaths: string[], stalledAwaitingApproval: boolean, hadError: boolean },
	'delegate_parallel_tasks': {
		runId: string,
		tasks: { task: string, status: string, conclusion: string | null, changedFilePaths: string[], mergeOutcome: string | null, errorMessage: string | null }[],
	},
	'remember': { memoryId: string, scope: 'project' | 'agent' },
	'install_skill': { skillId: string },
}


export type ToolCallParams<T extends BuiltinToolName | (string & {})> = T extends BuiltinToolName ? BuiltinToolCallParams[T] : RawToolParamsObj
export type ToolResult<T extends BuiltinToolName | (string & {})> = T extends BuiltinToolName ? BuiltinToolResultType[T] : RawMCPToolCall

export type BuiltinToolName = keyof BuiltinToolResultType

type BuiltinToolParamNameOfTool<T extends BuiltinToolName> = keyof (typeof builtinTools)[T]['params']
export type BuiltinToolParamName = { [T in BuiltinToolName]: BuiltinToolParamNameOfTool<T> }[BuiltinToolName]


export type ToolName = BuiltinToolName | (string & {})
export type ToolParamName<T extends ToolName> = T extends BuiltinToolName ? BuiltinToolParamNameOfTool<T> : string
