/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import { Event } from '../../../../../base/common/event.js';
import { ProxyChannel } from '../../../../../base/parts/ipc/common/ipc.js';
import { registerSingleton, InstantiationType } from '../../../../../platform/instantiation/common/extensions.js';
import { IMainProcessService } from '../../../../../platform/ipc/common/mainProcessService.js';
import { ExternalAgentEvent, IExternalAgentMainService } from './externalAgentTypes.js';

// The renderer's handle on the main-process service (see electron-main/externalAgentMainService.ts), through the same kind of channel as the other
// Vader main-process services. Everything that touches the network, starts a program or holds a login stays in the main process.
export class ExternalAgentService implements IExternalAgentMainService {
	readonly _serviceBrand: undefined;
	private readonly _main: IExternalAgentMainService;
	readonly onEvent: Event<ExternalAgentEvent>;

	constructor(@IMainProcessService mainProcessService: IMainProcessService) {
		this._main = ProxyChannel.toService<IExternalAgentMainService>(mainProcessService.getChannel('vader-channel-externalAgent'));
		this.onEvent = this._main.onEvent;
	}

	getStatuses: IExternalAgentMainService['getStatuses'] = (custom) => this._main.getStatuses(custom);
	install: IExternalAgentMainService['install'] = (id, fingerprint) => this._main.install(id, fingerprint);
	getInstallPlan: IExternalAgentMainService['getInstallPlan'] = (id) => this._main.getInstallPlan(id);
	uninstall: IExternalAgentMainService['uninstall'] = (id) => this._main.uninstall(id);
	checkSignIn: IExternalAgentMainService['checkSignIn'] = (id, c) => this._main.checkSignIn(id, c);
	connect: IExternalAgentMainService['connect'] = (id, c) => this._main.connect(id, c);
	signOut: IExternalAgentMainService['signOut'] = (id, c) => this._main.signOut(id, c);
	probe: IExternalAgentMainService['probe'] = (id, c) => this._main.probe(id, c);
	setConfigOption: IExternalAgentMainService['setConfigOption'] = (k, o, v) => this._main.setConfigOption(k, o, v);
	checkRegistry: IExternalAgentMainService['checkRegistry'] = (force) => this._main.checkRegistry(force);
	runTurn: IExternalAgentMainService['runTurn'] = (p) => this._main.runTurn(p);
	answerPermission: IExternalAgentMainService['answerPermission'] = (r, o) => this._main.answerPermission(r, o);
	cancel: IExternalAgentMainService['cancel'] = (k) => this._main.cancel(k);
	closeSession: IExternalAgentMainService['closeSession'] = (k) => this._main.closeSession(k);
	resolveProgram: IExternalAgentMainService['resolveProgram'] = (p, d) => this._main.resolveProgram(p, d);
	hasNode: IExternalAgentMainService['hasNode'] = () => this._main.hasNode();
}

registerSingleton(IExternalAgentMainService, ExternalAgentService, InstantiationType.Delayed);
