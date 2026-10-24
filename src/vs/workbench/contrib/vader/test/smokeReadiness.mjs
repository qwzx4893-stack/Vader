/* Vader addition. Licensed under the Apache License, Version 2.0. */

// Self-contained so Playwright can serialize the same predicate into the real page.
// A hidden classic workbench is not a readiness signal for the modern window.
export function inspectStartupSurface({ expectedMode = 'modern' } = {}) {
	if (expectedMode !== 'modern' && expectedMode !== 'classic') {
		throw new Error(`Unsupported startup mode: ${expectedMode}`);
	}
	const visible = element => {
		if (!element?.isConnected) return false;
		// Visibility is inherited but descendants can override it (as upstream MenuBar does).
		const visibility = getComputedStyle(element).visibility;
		if (visibility === 'hidden' || visibility === 'collapse') return false;
		const rect = element.getBoundingClientRect();
		if (rect.width <= 0 || rect.height <= 0) return false;
		for (let parent = element; parent; parent = parent.parentElement) {
			const style = getComputedStyle(parent);
			if (style.display === 'none' || Number(style.opacity) === 0) return false;
		}
		return true;
	};
	const usable = element => {
		if (!visible(element) || element.disabled || element.getAttribute('aria-disabled') === 'true') return false;
		// Inert blocks interaction throughout the subtree, but does not hide painted menus.
		for (let parent = element; parent; parent = parent.parentElement) {
			if (parent.inert) return false;
		}
		const rect = element.getBoundingClientRect();
		const left = Math.max(0, rect.left), right = Math.min(innerWidth, rect.right);
		const top = Math.max(0, rect.top), bottom = Math.min(innerHeight, rect.bottom);
		if (left >= right || top >= bottom) return false;
		const hit = document.elementFromPoint((left + right) / 2, (top + bottom) / 2);
		return !!hit && (hit === element || element.contains(hit));
	};
	const controls = 'button,[role="button"],input,textarea,select,a[href],[contenteditable="true"],[role="textbox"]';
	const surfaces = expectedMode === 'classic' ? [['classic', '.monaco-workbench']] : [
		['onboarding', '[data-testid="vader-onboarding"]'],
		['shell', '[data-testid="vader-shell"]'],
	];
	for (const [surface, selector] of surfaces) {
		for (const root of document.querySelectorAll(selector)) {
			// A root can have no box or inherited hidden visibility while a descendant
			// explicitly paints. Usable controls establish actual on-screen readiness.
			if (!root.isConnected) continue;
			const interactive = [...root.querySelectorAll(controls)].filter(usable).length;
			if (!interactive) continue;
			if (surface === 'shell' && !root.querySelector('[data-testid="vader-shell-main"]')) continue;
			if (surface === 'classic' && [...root.querySelectorAll('.part')].filter(visible).length < 3) continue;
			return { surface, interactive, classicMenuVisible: [...document.querySelectorAll('.monaco-workbench .menubar, .monaco-workbench .menubar .menubar-menu-button')].some(visible) };
		}
	}
	return false;
}
