// What the page asks of the app's service layer (react/src/util/services), answered from the test page's own objects.
export const useAccessor = () => (window as any).__accessor
export const useIsDark = () => true
export const useSkillsState = () => (window as any).__skills ?? []
export const useSettingsState = () => (window as any).__settings ?? { globalSettings: {} }
