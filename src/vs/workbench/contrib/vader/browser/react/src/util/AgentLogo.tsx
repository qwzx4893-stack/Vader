/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import React from 'react'
import { agentLogos } from '../../../../common/externalAgents/agentLogoData.js'
import { LogoNode } from '../../../../common/providerLogoData.js'
import { ExternalAgentLogoName } from '../../../../common/externalAgents/externalAgentCatalog.js'

const build = (node: LogoNode, i: number): React.ReactNode => {
	const [tag, attrs, children] = node
	return React.createElement(tag, { key: i, ...attrs }, ...children.map(build))
}

/** The agent's mark in the text colour, built with createElement (no innerHTML), like the provider logos. */
export const AgentLogo = ({ logo, size = 20 }: { logo: ExternalAgentLogoName, size?: number }) => {
	const data = agentLogos[logo]
	return (
		<svg className='inline-block flex-none' xmlns='http://www.w3.org/2000/svg' viewBox={data.vb} width={size} height={size} fill='currentColor' aria-hidden='true' data-agent-logo={logo}>
			{data.els.map(build)}
		</svg>
	)
}
