// What the Vader window asks of the app's service layer (react/src/util/services), answered from objects the test page owns, so the window can be
// driven in a plain browser: conversations in projects, their states, the shell service. Used by test/shellUiE2E.mjs.
import { useEffect, useState } from 'react'

const w = window as any

const listeners = new Set<() => void>()
export const notify = () => listeners.forEach(l => l())
const useTick = () => {
	const [, setN] = useState(0)
	useEffect(() => { const l = () => setN(n => n + 1); listeners.add(l); return () => { listeners.delete(l) } }, [])
}

export const useAccessor = () => w.__accessor
export const useIsDark = () => true
export const useSkillsState = () => w.__skills ?? []
export const useSettingsState = () => { useTick(); return w.__settings }
export const useShellState = () => { useTick(); return w.__shell.state }
export const useChatThreadsState = () => { useTick(); return w.__chat.state }
export const useFullChatThreadsStreamState = () => { useTick(); return w.__chat.streamState }
export const useChatThreadsStreamState = (id: string) => { useTick(); return w.__chat.streamState[id] }
export const useUsageTick = () => { useTick(); return 0 }
export const useCommandBarState = () => { useTick(); return { stateOfURI: w.__cb.stateOfURI, sortedURIs: w.__cb.sortedURIs } }
export const useOrchestrationRunsState = () => { useTick(); return w.__runs ?? [] }
