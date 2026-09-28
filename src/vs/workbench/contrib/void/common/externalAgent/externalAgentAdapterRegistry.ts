/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import { Disposable, IDisposable, toDisposable } from '../../../../../base/common/lifecycle.js';
import { registerSingleton, InstantiationType } from '../../../../../platform/instantiation/common/extensions.js';
import { IExternalAgentAdapter, IExternalAgentAdapterRegistry } from './externalAgentAdapterTypes.js';

export * from './externalAgentAdapterTypes.js';

class ExternalAgentAdapterRegistry extends Disposable implements IExternalAgentAdapterRegistry {
	readonly _serviceBrand: undefined;

	private readonly _adapters = new Map<string, IExternalAgentAdapter>();

	register(adapter: IExternalAgentAdapter): IDisposable {
		this._adapters.set(adapter.id, adapter);
		return toDisposable(() => this._adapters.delete(adapter.id));
	}

	list(): IExternalAgentAdapter[] {
		return [...this._adapters.values()];
	}

	get(id: string): IExternalAgentAdapter | undefined {
		return this._adapters.get(id);
	}
}

registerSingleton(IExternalAgentAdapterRegistry, ExternalAgentAdapterRegistry, InstantiationType.Delayed);
