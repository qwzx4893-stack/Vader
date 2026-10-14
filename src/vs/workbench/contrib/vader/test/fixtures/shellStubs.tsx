// Stand-ins for the parts of the window that have their own tests: the chat and Add-ons.
import React from 'react'
export const SidebarChat = () => <div data-testid='stub-chat' style={{ padding: 24, color: '#b0b0b5' }}><textarea placeholder='@ to mention, Enter instructions...' style={{ width: '100%', height: 60, background: '#19191c', color: '#ededee', border: '1px solid #333', borderRadius: 8, padding: 8 }} /></div>
export const Addons = () => <div data-testid='stub-addons' style={{ padding: 24, color: '#b0b0b5' }}>Add-ons page</div>
const ErrorBoundary = ({ children }: { children: React.ReactNode }) => <>{children}</>
export default ErrorBoundary
