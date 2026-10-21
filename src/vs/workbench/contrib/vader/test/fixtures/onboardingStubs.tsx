// Stand-ins for the parts the first run uses that have their own tests: the editor-import buttons of Settings and the error boundary.
import React from 'react'
export const OneClickSwitchButton = ({ fromEditor }: { fromEditor: string }) => <button data-testid={`stub-import-${fromEditor}`}>{fromEditor}</button>
const ErrorBoundary = ({ children }: { children: React.ReactNode }) => <>{children}</>
export default ErrorBoundary
