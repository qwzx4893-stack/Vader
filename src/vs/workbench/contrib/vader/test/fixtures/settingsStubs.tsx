// Stand-ins for the parts of Settings that are not rebuilt yet or have their own tests.
import React from 'react'
export const LegacySettings = ({ tabs }: { tabs: string[] }) => <div data-testid='stub-legacy' data-tabs={tabs.join(',')} style={{ color: '#b0b0b5' }}>Earlier content: {tabs.join(', ')}</div>
const ErrorBoundary = ({ children }: { children: React.ReactNode }) => <>{children}</>
export default ErrorBoundary
// the per-feature filters of the settings service (common/vaderSettingsService.ts needs the editor's services): every model is offered, except for suggestions, which need one that fills in the middle
export const modelFilterOfFeatureName: any = {
	Chat: { filter: () => true, emptyMessage: null },
	Apply: { filter: () => true, emptyMessage: null },
	SCM: { filter: () => true, emptyMessage: null },
	Autocomplete: { filter: (s: any) => s.modelName.includes('codestral'), emptyMessage: { message: 'Suggestions need a model that can fill in the middle, such as codestral or qwen2.5-coder.', priority: 'fallback' } },
}
