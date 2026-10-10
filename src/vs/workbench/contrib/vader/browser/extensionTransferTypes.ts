/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js'

export const transferEditorTypes = ['VS Code', 'VS Code Insiders', 'VSCodium', 'Cursor', 'Windsurf', 'Antigravity', 'Trae'] as const
export type TransferEditorType = typeof transferEditorTypes[number]
// https://github.com/VSCodium/vscodium/blob/master/docs/index.md#migrating-from-visual-studio-code-to-vscodium
// https://code.visualstudio.com/docs/editor/extension-marketplace#_where-are-extensions-installed
export type TransferFilesInfo = { from: URI, to: URI, isExtensions?: boolean }[]
