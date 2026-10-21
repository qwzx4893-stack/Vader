// Stand-ins for the parts of the chat that need the editor itself (the markdown with its code editors, the apply buttons, the model picker). Everything else in the
// chat is the real component. Used by test/chatUiE2E.mjs.
import React from 'react'

export type ChatMessageLocation = { threadId: string, messageIdx: number }
export const getApplyBoxId = (o: { threadId: string, messageIdx: number, tokenIdx: string }) => `${o.threadId}-${o.messageIdx}-${o.tokenIdx}`
export const ChatMarkdownRender = ({ string, inPTag }: { string: string, inPTag?: boolean, chatMessageLocation?: any }) => inPTag
	? <span data-testid='md'>{string}</span>
	: <div data-testid='md' style={{ whiteSpace: 'pre-wrap' }}>{string}</div>

export const CopyButton = ({ codeStr }: { codeStr: string }) => <button aria-label='Copy' data-copy={codeStr.length}>Copy</button>
export const EditToolAcceptRejectButtonsHTML = () => null
export const IconShell1 = ({ children, onClick, Icon }: { children?: React.ReactNode, onClick?: () => void, Icon?: any }) => <button onClick={onClick}>{children}</button>
export const JumpToFileButton = () => null
export const JumpToTerminalButton = () => null
export const StatusIndicator = () => null
export const StatusIndicatorForApplyButton = () => null
export const useApplyStreamState = () => ({ currStreamStateRef: { current: undefined }, setApplying: () => { } })
export const useEditToolStreamState = () => ({ isStreaming: false })

export const ModelDropdown = ({ featureName }: { featureName: string, className?: string }) => <span data-testid='stub-model-dropdown' data-feature={featureName}>Sonnet 4.5</span>
export const ExternalAgentChatPicker = () => null
export const PastThreadsList = () => <div data-testid='stub-past-threads' />

export const BlockCode = ({ initValue }: { initValue: string, language?: string }) => <pre data-testid='stub-code' style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{initValue}</pre>
