/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// Vader ships its own agent (Cline runtime, sidebar chat), so VS Code's built-in AI features - the
// GitHub Copilot chat, the Agents window, the agent-host utility process and its sign-in prompts - are
// switched off through VS Code's own supported master setting.
//
// This has to be registered in code. `configurationDefaults` in product.json is honoured by the web build
// and by extensions, but the desktop workbench never reads it (verified: with it in product.json the
// built-in chat UI and the agent host were both still active). Users can still override the setting.

import { Registry } from '../../../../platform/registry/common/platform.js';
import { Extensions, IConfigurationRegistry } from '../../../../platform/configuration/common/configurationRegistry.js';
import { ChatAIDisabledSettingId } from '../../../../platform/chat/common/chatSettings.js';

Registry.as<IConfigurationRegistry>(Extensions.Configuration).registerDefaultConfigurations([{
	overrides: { [ChatAIDisabledSettingId]: true }
}]);
