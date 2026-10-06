/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import React from 'react'
import { providerLogos, LogoNode, ProviderLogoData } from '../../../../common/providerLogoData.js'
import { ProviderName } from '../../../../common/voidSettingsTypes.js'

const build = (node: LogoNode, i: number): React.ReactNode => {
	const [tag, attrs, children] = node
	return React.createElement(tag, { key: i, ...attrs }, ...children.map(build))
}

/** The provider's real logo in one colour (the current text colour), so it follows the theme. Built with createElement, no innerHTML. */
export const ProviderLogo = ({ providerName, size = 16, className }: { providerName: ProviderName, size?: number, className?: string }) => {
	const logo: ProviderLogoData | undefined = (providerLogos as { readonly [k: string]: ProviderLogoData })[providerName]
	if (!logo) { return null }
	return (
		<svg className={`inline-block flex-none ${className ?? ''}`} xmlns="http://www.w3.org/2000/svg" viewBox={logo.vb} width={size} height={size} fill="currentColor" aria-hidden="true" data-provider-logo={providerName}>
			{logo.els.map(build)}
		</svg>
	)
}
