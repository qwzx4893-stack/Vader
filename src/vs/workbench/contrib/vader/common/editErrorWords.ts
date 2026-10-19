/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// What the chat says when an edit could not be applied (board S08, "The edit could not be applied"): which part did not match. The words are made from the messages
// browser/editCodeService.ts really raises (_errContentOfInvalidStr); an error that is not one of them gets no words. Nothing was written in any of these cases. Pure.

export type EditWords = { readonly title: string, readonly text: string, readonly kind: 'not-found' | 'not-unique' | 'overlap' };

export function explainEditError(message: string): EditWords | null {
	if (!/The edit was not applied\./.test(message)) return null;
	if (/there was no match for/.test(message)) return { kind: 'not-found', title: 'The change did not fit', text: 'The lines the model wanted to replace are no longer in the file. Nothing was written.' };
	if (/appears multiple times in the file/.test(message)) return { kind: 'not-unique', title: 'The change fits in more than one place', text: 'The lines the model wanted to replace appear more than once in the file, so it could not tell which to change. Nothing was written.' };
	if (/had overlap with another ORIGINAL string/.test(message)) return { kind: 'overlap', title: 'Two of the changes touch the same lines', text: 'The model asked for two changes that overlap, so none was written.' };
	return null;
}

/** what is sent to the agent for each way out */
export const TRY_AGAIN_MESSAGE = 'The last edit was not applied. Read the file again as it is now, then make the change once more.';
export const rewriteMessage = (fileName: string): string => `The last edit to ${fileName} was not applied. Rewrite the whole file with the change instead of editing parts of it.`;
