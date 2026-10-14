/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import React from 'react'

// The marks of Add-ons and Settings (board L01): three blocks and a plus, and a cog with square teeth. Drawn on a 24 grid, round joins, no fill.
const Mark = ({ children, size = 16, strokeWidth = 1.6, className }: { children: React.ReactNode, size?: number, strokeWidth?: number, className?: string }) =>
	<svg width={size} height={size} viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth={strokeWidth} strokeLinecap='round' strokeLinejoin='round' aria-hidden='true' className={className}>{children}</svg>

export const AddonsMark = (p: { size?: number, strokeWidth?: number, className?: string }) => <Mark {...p}><rect x="3.5" y="3.5" width="7" height="7" rx="1.7"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.7"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.7"/><path d="M17 3.2v7.6M13.2 7h7.6"/></Mark>
export const SettingsMark = (p: { size?: number, strokeWidth?: number, className?: string }) => <Mark {...p}><path d="M10.4 3h3.2l.5 2.3 1.7.7 2-1.3 2.3 2.3-1.3 2 .7 1.7 2.3.5v3.2l-2.3.5-.7 1.7 1.3 2-2.3 2.3-2-1.3-1.7.7-.5 2.3h-3.2l-.5-2.3-1.7-.7-2 1.3-2.3-2.3 1.3-2-.7-1.7L3 13.6v-3.2l2.3-.5.7-1.7-1.3-2L7 3.9l2 1.3 1.7-.7z"/><circle cx="12" cy="12" r="3"/></Mark>
