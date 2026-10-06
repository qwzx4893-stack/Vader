/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// Upstream's first-run onboarding (contrib/welcomeOnboarding) is a GitHub Copilot sign-in wizard and
// refuses to load without `product.defaultChatAgent`, which Vader's product.json deliberately does not
// carry. The startup page still injects IOnboardingService, so Vader registers this inert one instead
// of upstream's: it never shows anything, which is what `chat.disableAIFeatures` already implies.

import { Emitter, Event } from '../../../../base/common/event.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IOnboardingService } from '../../welcomeOnboarding/common/onboardingService.js';

class VaderOnboardingService implements IOnboardingService {
	declare readonly _serviceBrand: undefined;
	private readonly _onDidDismiss = new Emitter<void>();
	readonly onDidDismiss: Event<void> = this._onDidDismiss.event;
	show(): void { /* intentionally empty */ }
}

registerSingleton(IOnboardingService, VaderOnboardingService, InstantiationType.Delayed);
