export function assess({ exitCode, spawnError, timedOut, resultError, orphans, metrics }) {
	return exitCode === 0 && !spawnError && !timedOut && !resultError && orphans.length === 0 &&
		metrics.rootObserved && metrics.samples >= 2 && metrics.errors.length === 0 && metrics.breaches.length === 0;
}

export function scenarioCounts(result, smoke = false, required = []) {
	if (!Array.isArray(result.results) || !result.results.length) { throw new Error('No scenario evidence'); }
	const keys = result.results.map(r => smoke ? r.name : `${r.group}\n${r.name}`);
	if (new Set(keys).size !== keys.length) { throw new Error('Duplicate scenario evidence'); }
	const missing = required.filter(key => !keys.includes(key));
	if (missing.length) { throw new Error(`Missing ${missing.length} required scenarios: ${missing.join('; ')}`); }
	if (smoke) {
		if (result.results.some(r => typeof r.ok !== 'boolean')) { throw new Error('Invalid smoke evidence'); }
		return { total: result.results.length, failed: result.results.filter(r => !r.ok).length, skipped: 0 };
	}
	if (result.results.some(r => !['pass', 'fail', 'skip'].includes(r.status) || !Array.isArray(r.checks))) { throw new Error('Invalid scenario evidence'); }
	if (result.results.some(r => r.status === 'pass' && r.checks.length === 0)) { throw new Error('Passing scenario has no assertions'); }
	// Recount actual rows; a misleading totals object cannot override failing checks.
	return { total: result.results.length,
		failed: result.results.filter(r => r.status === 'fail' || r.checks.some(c => c.ok !== true)).length,
		skipped: result.results.filter(r => r.status === 'skip').length };
}
