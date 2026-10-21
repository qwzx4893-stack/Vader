/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import React from 'react'
import { Addons } from '../vader-addons-tsx/Addons.js'

// Add-ons inside the window (boards A01 to A10): the same page as ever, now beside the sidebar instead of over the whole editor.
export const AddonsPage = () => <div className='c fl' style={{ minHeight: 0 }} data-testid='vader-shell-addons-page'><Addons /></div>
