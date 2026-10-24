/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import React, { useRef, useState } from 'react';
import { useAccessor } from '../util/services.js';
import { checkDrop, dropNote, looksBinary, MAX_FILE_BYTES } from '../../../../common/attachmentRules.js';
import type { StagingSelectionItem } from '../../../../common/chatThreadServiceTypes.js';

/** Native file choices use the same persisted selection and request-context path as @file. */
export const ComposerFiles = ({ compact = false }: { compact?: boolean }) => {
	const accessor = useAccessor();
	const [busy, setBusy] = useState(false);
	const [note, setNote] = useState<string>();
	const selecting = useRef(false);
	const attach = async () => {
		if (selecting.current) return;
		selecting.current = true; setBusy(true); setNote(undefined);
		const chat = accessor.get('IChatThreadService');
		const threadId = chat.state.currentThreadId;
		try {
			const uris = await accessor.get('IVaderShellService').pickContextFiles();
			if (!uris?.length) return;
			const additions: StagingSelectionItem[] = [];
			const refused: { name: string; why: string }[] = [];
			const fileService = accessor.get('IFileService');
			for (const uri of uris) {
				const name = uri.path.split('/').pop() ?? uri.fsPath;
				try {
					const selections = chat.state.allThreads[threadId]?.state.stagingSelections;
					if (!selections) return; // the originating conversation was deleted
					if ([...selections, ...additions].some(s => s.type === 'File' && s.uri.toString() === uri.toString())) continue;
					const stat = await fileService.stat(uri);
					if (stat.isDirectory) { refused.push({ name, why: 'choose a file instead of a folder' }); continue; }
					const verdict = checkDrop([{ name, size: stat.size ?? 0 }], selections.length + additions.length);
					if (verdict.refused.length) { refused.push(...verdict.refused); continue; }
					const content = await fileService.readFile(uri, { limits: { size: MAX_FILE_BYTES } });
					if (looksBinary(content.value.toString())) { refused.push({ name, why: 'it is not a text file' }); continue; }
					additions.push({ type: 'File', uri, language: 'plaintext', state: { wasAddedAsCurrentFile: false } });
				} catch { refused.push({ name, why: 'it could not be read' }); }
			}
			const thread = chat.state.allThreads[threadId];
			if (thread && additions.length) chat.setThreadComposerState(threadId, { stagingSelections: [...thread.state.stagingSelections, ...additions] });
			setNote(dropNote({ accepted: additions.map(s => ({ name: s.uri.path.split('/').pop() ?? '', size: 0 })), refused }));
		} catch { setNote('Files could not be attached. Try choosing them again.'); }
		finally { selecting.current = false; setBusy(false); }
	};
	return <span className='inline-flex flex-col min-w-0'>
		<button type='button' data-testid='vader-add-files' disabled={busy} aria-busy={busy} aria-label='Add files' title='Add files to this message'
			className='flex items-center gap-1.5 h-7 px-1.5 text-[13px] text-vader-fg-2 hover:text-vader-fg-1 hover:bg-vader-bg-2-hover rounded-md'
			onClick={e => { e.stopPropagation(); void attach(); }}><span aria-hidden='true'>+</span>{compact ? null : 'Add files'}</button>
		{note ? <span role='status' data-testid='vader-add-files-note' className='text-xs text-vader-fg-3 whitespace-normal' style={{ maxWidth: 300 }}>{note}</span> : null}
	</span>;
};
