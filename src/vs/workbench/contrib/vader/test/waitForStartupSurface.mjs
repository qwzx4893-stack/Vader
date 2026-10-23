import { inspectStartupSurface } from './smokeReadiness.mjs';

// Playwright waitForFunction constructs a Function in-page, rejected by the real
// workbench's Trusted Types CSP. Poll CDP evaluate directly; do not relax the CSP.
export async function waitForStartupSurface(page, options, timeoutMs = 60000) {
	const deadline = Date.now() + timeoutMs;
	do {
		const surface = await page.evaluate(inspectStartupSurface, options);
		if (surface && (!options?.expectedSurface || surface.surface === options.expectedSurface)) return surface;
		await new Promise(resolve => setTimeout(resolve, 250));
	} while (Date.now() < deadline);
	return false;
}
