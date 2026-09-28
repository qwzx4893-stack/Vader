/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/


// register inline diffs
import './editCodeService.js'

// register Sidebar pane, state, actions (keybinds, menus) (Ctrl+L)
import './sidebarActions.js'
import './sidebarPane.js'

// register quick edit (Ctrl+K)
import './quickEditActions.js'


// register Autocomplete
import './autocompleteService.js'

// register Context services
// import './contextGatheringService.js'
// import './contextUserChangesService.js'

// settings pane
import './voidSettingsPane.js'

// register css
import './media/void.css'

// update (frontend part, also see platform/)
import './voidUpdateActions.js'

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
import './voidSelectionHelperWidget.js'

// register tooltip service
import './tooltipService.js'

// register onboarding service
import './voidOnboardingService.js'

// register misc service
import './miscWokrbenchContrib.js'

// register file service (for explorer context menu)
import './fileService.js'

// register source control management
import './voidSCMService.js'

// ---------- common (unclear if these actually need to be imported, because they're already imported wherever they're used) ----------

// llmMessage
import '../common/sendLLMMessageService.js'

// voidSettings
import '../common/voidSettingsService.js'

// refreshModel
import '../common/refreshModelService.js'

// metrics
import '../common/metricsService.js'

// updates
import '../common/voidUpdateService.js'

// model service
import '../common/voidModelService.js'

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

// Vader agent platform: Main Agent Runtime health/selection (see docs/integrations/agent-runtime.md)
import './agentRuntime/agentRuntimeRegistryService.js'
