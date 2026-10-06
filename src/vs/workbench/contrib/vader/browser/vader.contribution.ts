/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/


// Vader defaults (turns VS Code's built-in AI features off) - first, so it is in place before settings are read
import './vaderDefaults.js'

// register inline diffs
import './editCodeService.js'

// register Sidebar pane, state, actions (keybinds, menus) (Ctrl+L)
import './sidebarActions.js'
import './sidebarPane.js'

// register quick edit (Ctrl+K)
import './quickEditActions.js'


// register Autocomplete
import './autocompleteService.js'

// settings pane
import './vaderSettingsPane.js'

// register css
import './media/vader.css'

// update (frontend part, also see platform/)
import './vaderUpdateActions.js'

import './convertToLLMMessageWorkbenchContrib.js'

// tools
import './toolsService.js'
import './terminalToolService.js'

// register Thread History
import './chatThreadService.js'

// ping
import './metricsPollService.js'

// helper services
import './helperServices/consistentItemService.js'

// register selection helper
import './vaderSelectionHelperWidget.js'

// register tooltip service
import './tooltipService.js'

// register onboarding service
import './vaderSetupContribution.js'

// register misc service
import './miscWokrbenchContrib.js'

// register file service (for explorer context menu)
import './fileService.js'

// register source control management
import './vaderSCMService.js'

// ---------- common (unclear if these actually need to be imported, because they're already imported wherever they're used) ----------

// llmMessage
import '../common/sendLLMMessageService.js'

// vaderSettings
import '../common/vaderSettingsService.js'

// refreshModel
import '../common/refreshModelService.js'

// metrics
import '../common/metricsService.js'

// updates
import '../common/vaderUpdateService.js'

// model service
import '../common/vaderModelService.js'

// Vader agent platform: hard policy engine (see ARCHITECTURE.md)
import '../common/policy/policyService.js'

// Vader agent platform: layered instruction system
import '../common/instructions/instructionsService.js'

// Vader agent platform: permanent agents
import '../common/agents/agentsService.js'

// Vader agent platform: external discovery (MCP Registry, SkillNet)
import '../common/discovery/discoveryService.js'

// Vader agent platform: capability bus (unifies native tools, MCP tools, agents, discovery)
import '../common/capabilities/capabilityBusService.js'

// Vader agent platform: browser automation (Playwright-backed)
import '../common/browser/browserToolService.js'

// Vader agent platform: Agent Gateway seam (see ARCHITECTURE.md)
import './agentGatewayService.js'
// These two register services but are otherwise only reached through modules that now import their
// ids from the *Types files (to avoid import cycles), so they must be imported for their registration.
import './verificationService.js'
import './vaderCommandBarService.js'

// Vader agent platform: Main Agent Runtime health/selection (see docs/integrations/agent-runtime.md)
import './agentRuntime/agentRuntimeRegistryService.js'

// Vader agent platform: Unified Capability Marketplace (see docs/integrations/marketplace.md)
import './marketplace/unifiedMarketplaceService.js'
import './marketplace/providers/extensionGalleryProvider.js'
import './marketplace/providers/skillMarketplaceProvider.js'
import './marketplace/providers/mcpMarketplaceProvider.js'
import './marketplace/providers/acpAgentMarketplaceProvider.js'
// The reference external-agent adapter registers itself with the registry the ACP provider above lists from
// (docs/integrations/external-agent-adapter.md); without this import it was never registered.
import './vaderNativeExternalAgentAdapter.js'
import './marketplace/providers/languageAndDebugMarketplaceProviders.js'
import './marketplace/providers/localToolingMarketplaceProviders.js'
import './marketplace/marketplaceViewPane.js'
