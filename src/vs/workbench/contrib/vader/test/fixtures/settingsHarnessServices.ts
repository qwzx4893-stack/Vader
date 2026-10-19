// What the Settings pages ask of the app's service layer (react/src/util/services), answered from objects the test page owns. Used by test/settingsUiE2E.mjs.
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
export const useSettingsState = () => { useTick(); return w.__settings }
export const usePolicyServiceState = () => { useTick(); return w.__policy.state }
export const useCloudModelListState = () => { useTick(); return w.__cloud }
export const useRefreshModelState = () => { useTick(); return w.__local }
export const useExternalAgentsState = () => { useTick(); return w.__agents }
export const useModelRouterServiceState = () => { useTick(); return w.__router.state }
export const useAgentsServiceState = () => { useTick(); return w.__agentsSvc.state }
export const useSkillsState = () => { useTick(); return w.__skills ?? [] }
export const useMCPServiceState = () => { useTick(); return w.__mcp.state }
export const useMemoryState = () => { useTick(); return w.__memory.state }
export const useRefreshModelListener = () => { }
