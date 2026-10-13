/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

// past values:
// 'vader.settingsServiceStorage'
// 'vader.settingsServiceStorageI' // 1.0.2

// 'vader.settingsServiceStorageII' // before the first public release: onboarding flag, keys and model lists written by pre-release builds

// first public release: starts clean, so a pre-release install never feeds its welcome state, model picks or stored model lists into this one
export const VADER_SETTINGS_STORAGE_KEY = 'vader.settingsServiceStorageIII'


// past values:
// 'vader.chatThreadStorage'
// 'vader.chatThreadStorageI' // 1.0.2

// 'vader.chatThreadStorageII' // before the first public release

// first public release (see above)
export const THREAD_STORAGE_KEY = 'vader.chatThreadStorageIII'

/** the keys the first public release replaced: deleted on startup so the old data (including encrypted API keys) does not stay on disk unread */
export const VADER_RETIRED_STORAGE_KEYS = ['vader.settingsServiceStorageII', 'vader.chatThreadStorageII'] as const



export const OPT_OUT_KEY = 'vader.app.optOutAll'


// Vader-added storage keys (new platform features layered on top of Vader)
export const VADER_POLICY_STORAGE_KEY = 'vader.policyServiceStorageI'
export const VADER_AGENTS_STORAGE_KEY = 'vader.agentsServiceStorageI'
export const VADER_PROJECT_MEMORY_STORAGE_KEY = 'vader.memoryServiceStorage.projectI'
export const VADER_AGENT_MEMORY_STORAGE_KEY = 'vader.memoryServiceStorage.agentI'
export const VADER_COMPACTION_ARCHIVE_STORAGE_KEY = 'vader.memoryServiceStorage.compactionArchiveI'
