// Normally you'd want to put these exports in the files that register them, but if you do that you'll get an import order error if you import them in certain cases.
// (importing them runs the whole file to get the ID, causing an import error). I guess it's best practice to separate out IDs, pretty annoying...

export const VADER_CTRL_L_ACTION_ID = 'vader.ctrlLAction'

export const VADER_CTRL_K_ACTION_ID = 'vader.ctrlKAction'

export const VADER_ACCEPT_DIFF_ACTION_ID = 'vader.acceptDiff'

export const VADER_REJECT_DIFF_ACTION_ID = 'vader.rejectDiff'

export const VADER_GOTO_NEXT_DIFF_ACTION_ID = 'vader.goToNextDiff'

export const VADER_GOTO_PREV_DIFF_ACTION_ID = 'vader.goToPrevDiff'

export const VADER_GOTO_NEXT_URI_ACTION_ID = 'vader.goToNextUri'

export const VADER_GOTO_PREV_URI_ACTION_ID = 'vader.goToPrevUri'

export const VADER_ACCEPT_FILE_ACTION_ID = 'vader.acceptFile'

export const VADER_REJECT_FILE_ACTION_ID = 'vader.rejectFile'

export const VADER_ACCEPT_ALL_DIFFS_ACTION_ID = 'vader.acceptAllDiffs'

export const VADER_REJECT_ALL_DIFFS_ACTION_ID = 'vader.rejectAllDiffs'

export const VADER_TOGGLE_SETTINGS_ACTION_ID = 'workbench.action.toggleVaderSettings'

export const VADER_OPEN_SETTINGS_ACTION_ID = 'workbench.action.openVaderSettings'
