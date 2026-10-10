/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *  Rewritten by Vader (welcome screen and settings import replace the original provider wizard).
 *--------------------------------------------------------------------------------------*/

// First run: a welcome screen, then one screen to bring settings, keybindings and extensions over from another editor, then straight into the IDE.
// It uses the theme's own surface and text colours (grey on dark themes, light on light themes), like the rest of the editor. Model providers are
// configured later from Settings.

import { useEffect, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { useAccessor, useIsDark, useSettingsState } from '../util/services.js';
import { OneClickSwitchButton } from '../vader-settings-tsx/Settings.js';
import ErrorBoundary from '../sidebar-tsx/ErrorBoundary.js';
import { VaderLogo } from '../util/VaderLogo.js'
import { transferEditorTypes } from '../../../extensionTransferTypes.js'

const FadeIn = ({ children, delayMs = 0, durationMs = 1200, className }: { children: React.ReactNode, delayMs?: number, durationMs?: number, className?: string }) => {
	const [shown, setShown] = useState(false)
	useEffect(() => { const id = setTimeout(() => setShown(true), delayMs); return () => clearTimeout(id) }, [delayMs])
	return <div className={className} style={{ opacity: shown ? 1 : 0, transition: `opacity ${durationMs}ms ease-in-out` }}>{children}</div>
}

const PrimaryActionButton = ({ children, testId, onClick }: { children: React.ReactNode, testId: string, onClick: () => void }) => (
	<button
		type='button' data-testid={testId} onClick={onClick}
		className='flex items-center justify-center gap-1 px-4 py-2 rounded-lg group text-white dark:text-black bg-black/90 dark:bg-white/90 transition-all duration-300 ease-in-out'
	>
		{children}
		<ChevronRight className='transition-all duration-300 ease-in-out transform group-hover:translate-x-1 group-active:translate-x-1' />
	</button>
)

export const VaderOnboarding = () => {
	const vaderSettingsState = useSettingsState()
	const isOnboardingComplete = vaderSettingsState.globalSettings.isOnboardingComplete
	const isDark = useIsDark()

	return (
		<div className={`@@vader-scope ${isDark ? 'dark' : ''}`}>
			<div
				data-testid='vader-onboarding'
				className={`bg-vader-bg-3 fixed top-0 right-0 bottom-0 left-0 width-full z-[99999] transition-all duration-1000 ${isOnboardingComplete ? 'opacity-0 pointer-events-none' : 'opacity-100 pointer-events-auto'}`}
				style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
			>
				<ErrorBoundary>
					<OnboardingPages />
				</ErrorBoundary>
			</div>
		</div>
	)
}

const OnboardingPages = () => {
	const accessor = useAccessor()
	const vaderSettingsService = accessor.get('IVaderSettingsService')
	const vaderMetricsService = accessor.get('IMetricsService')
	const vaderSettingsState = useSettingsState()
	const [page, setPage] = useState<'welcome' | 'import'>('welcome')

	// a repeated onboarding (Settings > "See onboarding screen") starts from the welcome page again
	useEffect(() => { if (!vaderSettingsState.globalSettings.isOnboardingComplete) { setPage('welcome') } }, [vaderSettingsState.globalSettings.isOnboardingComplete])

	const finish = () => {
		vaderSettingsService.setGlobalSetting('isOnboardingComplete', true)
		vaderMetricsService.capture('Completed Onboarding', {})
	}

	if (page === 'welcome') {
		return (
			<div key='welcome' className='w-full h-[80vh] mx-auto flex flex-col items-center justify-center text-center'>
				<div className='flex flex-col items-center gap-8'>
					<div className='text-5xl font-light'>Welcome to Vader</div>
					<div className='max-w-md w-full h-[30vh] mx-auto flex items-center justify-center'>
						{/* the logo, drawn in the theme's text colour (light on dark themes, dark on light themes) */}
						<VaderLogo className='w-full' style={{ maxWidth: 260, opacity: 0.92 }} />
					</div>
					<FadeIn delayMs={1000}>
						<PrimaryActionButton testId='vader-welcome-continue' onClick={() => setPage('import')}>Get started</PrimaryActionButton>
					</FadeIn>
				</div>
			</div>
		)
	}

	return (
		<div key='import' className='w-full h-[80vh] mx-auto flex flex-col items-center justify-center text-center'>
			<div className='text-5xl font-light'>Bring your setup with you</div>
			<div className='mt-6 text-vader-fg-3 max-w-lg'>Copy your settings, keybindings and extensions from the editor you used before. Nothing is changed in the original editor, and you can skip this.</div>
			<div data-testid='vader-import-editors' className='mt-8 grid gap-3 w-full max-w-3xl px-6' style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))' }}>
				{transferEditorTypes.map(editor => <OneClickSwitchButton key={editor} className='w-full px-4 py-3' fromEditor={editor} />)}
			</div>
			<div className='mt-10 flex items-center gap-6'>
				<button type='button' data-testid='vader-import-skip' onClick={finish} className='text-vader-fg-3 underline hover:brightness-125'>Skip</button>
				<PrimaryActionButton testId='vader-import-done' onClick={finish}>Open Vader</PrimaryActionButton>
			</div>
		</div>
	)
}
