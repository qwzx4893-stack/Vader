// What the chat asks of the app's service layer (react/src/util/services), answered from objects the test page owns, so the real chat component (react/src2) can be
// driven in a plain browser. Used by test/chatUiE2E.mjs.
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
export const useShellState = () => { useTick(); return w.__shell?.state }
export const useUsageTick = () => { useTick(); return 0 }
export const useSettingsState = () => { useTick(); return w.__settings }
export const useChatThreadsState = () => { useTick(); return w.__chat.state }
export const useChatThreadsStreamState = (id: string) => { useTick(); return w.__chat.streamState[id] }
export const useFullChatThreadsStreamState = () => { useTick(); return w.__chat.streamState }
export const useCloudModelListState = () => { useTick(); return w.__cloud ?? {} }
export const useRefreshModelState = () => { useTick(); return w.__local ?? {} }
export const useRefreshModelListener = () => { }
export const useCtrlKZoneStreamingState = () => ({})
export const useCommandBarURIListener = () => { }
export const useCommandBarState = () => { useTick(); return { stateOfURI: {}, sortedURIs: [] } }
export const useActiveURI = () => ({ uri: undefined })
export const useMCPServiceState = () => { useTick(); return { mcpServerOfName: {} } }
export const useAgentsServiceState = () => { useTick(); return { agents: [] } }
export const usePolicyServiceState = () => { useTick(); return w.__policy.state }
export const useModelRouterServiceState = () => { useTick(); return { mode: 'manual', categoryOverrides: {} } }
export const useSkillsState = () => { useTick(); return [] }
export const useMemoryState = () => { useTick(); return { project: [], agent: [] } }
export const useExternalAgentsState = () => { useTick(); return { statuses: {}, busy: {}, errors: {}, probes: {}, signIn: {}, opened: {}, configOfThread: {} } }
export const useOrchestrationRunsState = () => { useTick(); return { runs: [] } }
export const useIsOptedOut = () => false
