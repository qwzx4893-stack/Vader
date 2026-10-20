/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import { useEffect, useMemo, useState } from 'react'
import { useAccessor, useChatThreadsState, useFullChatThreadsStreamState, useUsageTick } from '../util/services.js'
import { projectDisplayNames } from '../../../../common/threadProjects.js'
import { branchLabel, hasCopyOnDisk } from '../../../../common/taskCopyModel.js'
import { agentGroupOf, AgentGroupId, ageLabel, changedFilePaths, isAgentTask, isListed, threadTitle } from '../../../../common/shellModel.js'
import type { ThreadStatus } from '../../../../common/threadStatus.js'
import type { ThreadUsage } from '../../../../common/usageAccounting.js'

// The conversations as the window lists them, read from the chat thread service. One hook so the sidebar and the "All agents" page agree.

export type ShellThread = {
	id: string
	title: string
	status: ThreadStatus
	group: AgentGroupId
	age: string
	/** the agent used tools (so it is an agent task and not just a chat) */
	isTask: boolean
	changedFiles: string[]
	usage: ThreadUsage | undefined
	projectKey: string | null
	lastModified: string
	/** the model that answered the last time it ran (undefined for a conversation that never ran since this was recorded) */
	model?: { providerName: string, modelName: string }
	/** how many messages the thread has that are shown to the person */
	messageCount: number
	/** its own copy of the project, while it has one or once merged (common/taskCopyModel.ts) */
	copy?: { branch: string, base: string, files: number, added?: number, removed?: number, worktreePath: string, merged: boolean }
}

export type ShellGroup = { key: string | null, name: string, threads: ShellThread[] }

export type ShellData = {
	groups: ShellGroup[]
	needsYou: ShellThread[]
	all: ShellThread[]
	tasks: ShellThread[]
	currentId: string | undefined
	currentProjectKey: string | null
	currentProjectName: string
}

/** a tick every 30 seconds, so "2m" in the sidebar becomes "3m" without anything else happening */
const useMinuteTick = () => {
	const [n, setN] = useState(0)
	useEffect(() => {
		const t = setInterval(() => setN(x => x + 1), 30_000)
		return () => clearInterval(t)
	}, [])
	return n
}

export const useShellData = (): ShellData => {
	const accessor = useAccessor()
	const chat = accessor.get('IChatThreadService')
	const state = useChatThreadsState()
	const stream = useFullChatThreadsStreamState()
	const usageTick = useUsageTick()
	const tick = useMinuteTick()
	const copies = accessor.get('ITaskCopyService')
	const [copyTick, setCopyTick] = useState(0)
	useEffect(() => { const d = copies?.onDidChange(() => setCopyTick(n => n + 1)); return () => d?.dispose() }, [copies])

	return useMemo(() => {
		const now = Date.now()
		const all: ShellThread[] = []
		const groups: ShellGroup[] = []
		const projectGroups = chat.listProjectGroups()
		const names = projectDisplayNames(projectGroups)
		for (const g of projectGroups) {
			const threads: ShellThread[] = []
			for (const id of g.threadIds) {
				const t = state.allThreads[id]
				if (!t || !isListed(t)) continue
				const status = chat.getThreadStatus(id)
				const th: ShellThread = {
					id, title: threadTitle(t), status, group: agentGroupOf(status), age: ageLabel(t.lastModified, now), isTask: isAgentTask(t),
					changedFiles: changedFilePaths(t.messages), usage: chat.getThreadUsage(id), projectKey: g.key, lastModified: t.lastModified, model: t.model,
					messageCount: t.messages.filter(m => m.role === 'user' || m.role === 'assistant').length,
				}
				const c = copies?.getState(id)
				if (c && (hasCopyOnDisk(c) || c.phase === 'merged')) th.copy = { branch: branchLabel(c.branchName), base: c.baseBranch, files: c.files, added: c.added, removed: c.removed, worktreePath: c.worktreePath, merged: c.phase === 'merged' }
				threads.push(th)
				all.push(th)
			}
			if (threads.length > 0) groups.push({ key: g.key, name: names.get(g.key) ?? g.name, threads })
		}
		const currentProjectKey = chat.getCurrentProjectKey()
		const current = groups.find(g => g.key === currentProjectKey)
		return {
			groups,
			needsYou: all.filter(t => t.status === 'needs_you'),
			all,
			tasks: all.filter(t => t.isTask),
			currentId: state.currentThreadId,
			currentProjectKey,
			currentProjectName: current?.name ?? (currentProjectKey ? currentProjectKey.split('/').filter(Boolean).pop() ?? 'Chats' : 'Chats'),
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [chat, state, stream, usageTick, tick, copies, copyTick])
}
