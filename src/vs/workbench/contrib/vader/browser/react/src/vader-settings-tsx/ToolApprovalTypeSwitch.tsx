/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import React, { useCallback } from 'react'
import { useAccessor, useSettingsState } from '../util/services.js'
import { VaderSwitch } from '../util/inputs.js'
import { ToolApprovalType } from '../../../../common/toolsServiceTypes.js'

/** The switch that lets a kind of tool (edits, commands, MCP tools) run without asking: the chat's own tool-approval row uses it. The Permissions page has the same setting in its own shape. */
export const ToolApprovalTypeSwitch = ({ approvalType, size, desc }: { approvalType: ToolApprovalType, size: "xxs" | "xs" | "sm" | "sm+" | "md", desc: string }) => {
	const accessor = useAccessor()
	const vaderSettingsService = accessor.get('IVaderSettingsService')
	const vaderSettingsState = useSettingsState()
	const metricsService = accessor.get('IMetricsService')

	const onToggleAutoApprove = useCallback((approvalType: ToolApprovalType, newValue: boolean) => {
		vaderSettingsService.setGlobalSetting('autoApprove', {
			...vaderSettingsService.state.globalSettings.autoApprove,
			[approvalType]: newValue
		})
		metricsService.capture('Tool Auto-Accept Toggle', { enabled: newValue })
	}, [vaderSettingsService, metricsService])

	return <>
		<VaderSwitch
			size={size}
			value={vaderSettingsState.globalSettings.autoApprove[approvalType] ?? false}
			onChange={(newVal) => onToggleAutoApprove(approvalType, newVal)}
		/>
		<span className="text-vader-fg-3 text-xs">{desc}</span>
	</>
}
