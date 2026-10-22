/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

/** Shared by overlapping pages: closing Settings must not reveal the editor under the shell. */
export const setVaderWindowLayer = (workbench: HTMLElement, layer: 'shell' | 'settings' | 'onboarding', shown: boolean): void => {
	workbench.classList.toggle(`vader-window-${layer}`, shown)
	workbench.classList.toggle('vader-window-layer', ['shell', 'settings', 'onboarding'].some(name => workbench.classList.contains(`vader-window-${name}`)))
}
