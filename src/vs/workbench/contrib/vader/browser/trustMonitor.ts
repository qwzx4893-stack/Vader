/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { INotificationService, Severity } from '../../../../platform/notification/common/notification.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { IUnifiedMarketplaceService } from '../common/marketplace/marketplaceTypes.js';
import { labelsAgainst, parseTrustHistory, recordScore, TRUST_HISTORY_STORAGE_KEY, trustAlert } from '../common/marketplace/trustHistory.js';

// The score of what is installed is computed again from live data, not once. A minute after start and then every six hours this looks at each
// installed skill (and extension) again through its marketplace provider, which asks its sources for the repository's stars, last change,
// licence and so on, and computes the score from what they say now. If the score fell by ten points or fell into "risky", it says so, with the
// reason that is new. Nothing is changed for the person: a score is a guide, and they decide.
// The numbers it saw are kept (common/marketplace/trustHistory.ts) so Settings can show "was 87% when first seen".

const FIRST_LOOK_DELAY_MS = 60_000;
const EVERY_MS = 6 * 60 * 60_000;

class TrustMonitorContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.vader.trustMonitor';
	private _running = false;

	constructor(
		@IUnifiedMarketplaceService private readonly _marketplace: IUnifiedMarketplaceService,
		@IStorageService private readonly _storage: IStorageService,
		@INotificationService private readonly _notifications: INotificationService,
	) {
		super();
		const first = setTimeout(() => this._look(), FIRST_LOOK_DELAY_MS);
		const every = setInterval(() => this._look(), EVERY_MS);
		this._register({ dispose: () => { clearTimeout(first); clearInterval(every); } });
	}

	private async _look(): Promise<void> {
		if (this._running) return;
		this._running = true;
		try {
			const installed = (await this._marketplace.listInstalled()).filter(i => (i.type === 'SKILL' || i.type === 'EXTENSION') && !!i.trustScore);
			let history = parseTrustHistory(JSON.parse(this._storage.get(TRUST_HISTORY_STORAGE_KEY, StorageScope.APPLICATION) ?? 'null'));
			for (const item of installed) {
				const fresh = await this._marketplace.refine(item);
				const score = fresh.trustScore;
				if (!score) continue;
				const key = `${fresh.providerId}:${fresh.id}`;
				const against = labelsAgainst(score.factors);
				const alert = trustAlert(history[key], score.score, against);
				if (alert) {
					const why = alert.newReasons.length ? ` New: ${alert.newReasons.slice(0, 2).join('; ')}.` : '';
					this._notifications.notify({
						severity: Severity.Warning,
						message: alert.kind === 'now-risky'
							? `"${fresh.name}" is now rated risky: ${alert.to}% (it was ${alert.from}%).${why} Open Add-ons to read why.`
							: `"${fresh.name}" dropped from ${alert.from}% to ${alert.to}%.${why}`,
						source: 'Vader Add-ons',
					});
				}
				history = recordScore(history, key, score.score, against, Date.now());
			}
			this._storage.store(TRUST_HISTORY_STORAGE_KEY, JSON.stringify(history), StorageScope.APPLICATION, StorageTarget.MACHINE);
		} catch {
			// offline, or a source is down: the next look is in six hours, and nothing was changed
		} finally {
			this._running = false;
		}
	}
}

registerWorkbenchContribution2(TrustMonitorContribution.ID, TrustMonitorContribution, WorkbenchPhase.Eventually);
