// What the first run asks of the app's service layer (react/src/util/services), answered from objects the test page owns, so it can be driven in a plain
// browser: the settings, the model lists, the policy mode, the connected agents. Used by test/onboardingUiE2E.mjs.
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
