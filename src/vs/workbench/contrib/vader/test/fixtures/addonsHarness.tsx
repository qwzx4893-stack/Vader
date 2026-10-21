// The page of Add-ons as it is built for the app (react/src2), mounted in a plain browser page with the real providers and the real federating service
// behind it; only the sources' answers (saved responses) and the editor's services are stand-ins. Used by test/addonsUiE2E.mjs.
import React from 'react'
import { createRoot } from 'react-dom/client'
import { installLanguage } from './i18nHarness'
import { Addons } from '../../browser/react/src2/vader-addons-tsx/Addons'
import { addonsServices } from './addonsHarnessSetup'

const w = window as any
const { service, skillSvc, installedSkills, commands, opener } = addonsServices

w.__accessor = {
	get: (name: string) => ({ IUnifiedMarketplaceService: service, ICommandService: commands, IOpenerService: opener, ISkillService: skillSvc } as any)[name],
}
w.__skills = installedSkills

installLanguage(document.getElementById('root')!)
createRoot(document.getElementById('root')!).render(<Addons />)
w.__mounted = true
