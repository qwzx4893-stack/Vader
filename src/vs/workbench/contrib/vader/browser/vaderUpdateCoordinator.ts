/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IChatThreadService } from './chatThreadService.js';
import { IVaderUpdateService } from '../common/vaderUpdateService.js';

// "Restart when tasks finish" (board S11): once an update is downloaded, the person can have Vader restart as soon as no task is working. It lives here, and not in the
// page that shows the choice, so that it still happens when Settings is closed.

export interface IVaderUpdateCoordinator {
	readonly _serviceBrand: undefined;
	readonly onDidChange: Event<void>;
	/** a restart is waiting for the tasks to finish */
	readonly waiting: boolean;
	/** tasks that are working (or paused) now: a restart would stop them */
	runningTasks(): number;
	installWhenIdle(): void;
	stopWaiting(): void;
	installNow(): Promise<{ ok: true } | { ok: false; reason: string }>;
}

export const IVaderUpdateCoordinator = createDecorator<IVaderUpdateCoordinator>('vaderUpdateCoordinator');

class VaderUpdateCoordinator extends Disposable implements IVaderUpdateCoordinator {
	declare readonly _serviceBrand: undefined;
	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange = this._onDidChange.event;
	private _waiting = false;
	get waiting(): boolean { return this._waiting; }

	constructor(
		@IChatThreadService private readonly _chat: IChatThreadService,
		@IVaderUpdateService private readonly _update: IVaderUpdateService,
	) {
		super();
		this._register(this._chat.onDidChangeStreamState(() => { void this._maybeInstall(); }));
	}

	runningTasks(): number {
		let n = 0;
		for (const id of Object.keys(this._chat.state.allThreads)) {
			const s = this._chat.getThreadStatus(id);
			if (s === 'running' || s === 'paused') n++;
		}
		return n;
	}

	installWhenIdle(): void {
		this._waiting = true;
		this._onDidChange.fire();
		void this._maybeInstall();
	}

	stopWaiting(): void {
		if (!this._waiting) return;
		this._waiting = false;
		this._onDidChange.fire();
	}

	private async _maybeInstall(): Promise<void> {
		if (!this._waiting || this.runningTasks() > 0) return;
		this._waiting = false;
		this._onDidChange.fire();
		await this._update.installUpdate();
	}

	installNow(): Promise<{ ok: true } | { ok: false; reason: string }> {
		this._waiting = false;
		this._onDidChange.fire();
		return this._update.installUpdate();
	}
}

registerSingleton(IVaderUpdateCoordinator, VaderUpdateCoordinator, InstantiationType.Delayed);
