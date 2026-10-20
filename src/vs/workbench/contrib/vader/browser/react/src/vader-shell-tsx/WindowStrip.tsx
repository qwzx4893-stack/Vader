/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import React from 'react'
import { VaderLogo } from '../util/VaderLogo.js'

// The strip across the top of every Vader page (boards R01, R08, R22): the mark, what belongs to the page, and room for the window's own controls. On Windows the
// system draws minimise, maximise and close over the right end of the page, and on macOS the traffic lights over the left end, so the strip leaves room for them
// and is the place the window is dragged by. Where the system draws no controls over the page (other systems) the editor's own title bar stays above the page,
// and there is no strip: two bars of the same job would only take room.

export type Platform = 'win' | 'mac' | 'other'

export const platformOf = (): Platform => {
	const forced = (window as unknown as { __vaderPlatform?: Platform }).__vaderPlatform
	if (forced) return forced
	const p = typeof navigator === 'undefined' ? '' : navigator.platform
	return /Mac/i.test(p) ? 'mac' : /Win/i.test(p) ? 'win' : 'other'
}

/** the width the system's own window controls take at the right end of the strip on Windows (three buttons of 46) */
export const WINDOW_CONTROLS_WIDTH = 138
/** the room the traffic lights take at the left end on macOS */
export const TRAFFIC_LIGHTS_WIDTH = 78

export const WindowStrip = ({ children, title }: { children?: React.ReactNode, /** the name of the page, in the middle of the strip */ title?: React.ReactNode }) => {
	const platform = platformOf()
	if (platform === 'other') return null
	return <div className='wc' data-testid='vader-window-strip' data-platform={platform} style={{ position: 'relative', paddingLeft: platform === 'mac' ? TRAFFIC_LIGHTS_WIDTH : 12, paddingRight: platform === 'win' ? WINDOW_CONTROLS_WIDTH : 12 }}>
		<VaderLogo style={{ width: 16, height: 16, marginRight: 8, flex: 'none' }} />
		{children}
		{title ? <span className='t2 tr' data-testid='vader-window-title' style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 38, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>{title}</span> : null}
	</div>
}
