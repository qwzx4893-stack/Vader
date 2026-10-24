/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import React, { useEffect, useId, useRef, useState } from 'react';
import { useAccessor, useChatThreadsState, useShellState } from '../util/services.js';
import { projectNameOf } from '../../../../common/threadProjects.js';
import type { ProjectChoice } from '../../../../common/projectPickerModel.js';

/** One compact choice above the composer: a public project folder, or a chat with no project. */
export const ComposerProjectPicker = () => {
	const accessor = useAccessor();
	const shell = accessor.get('IVaderShellService');
	const chat = accessor.get('IChatThreadService');
	const state = useChatThreadsState();
	useShellState(); // workspace changes can leave the selected conversation unchanged
	const [open, setOpen] = useState(false);
	const [projects, setProjects] = useState<ProjectChoice[]>([]);
	const [loading, setLoading] = useState(false);
	const [busy, setBusy] = useState(false);
	const [historyUnavailable, setHistoryUnavailable] = useState(false);
	const [error, setError] = useState<string>();
	const box = useRef<HTMLDivElement>(null);
	const trigger = useRef<HTMLButtonElement>(null);
	const live = useRef(true);
	const menuId = useId();
	const key = chat.getCurrentProjectKey();
	const name = projects.find(p => p.key === key)?.name ?? (key ? projectNameOf(key) : 'Chat (no project)');
	useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
	useEffect(() => { setOpen(false); setError(undefined); }, [state.currentThreadId]);
	useEffect(() => {
		if (!open) return;
		let active = true;
		setLoading(true);
		void shell.listProjects().then(result => {
			if (active) { setProjects(result.projects); setHistoryUnavailable(result.historyUnavailable); }
		}, () => { if (active) setError('Projects could not be loaded. Try again or choose a folder.'); })
			.finally(() => { if (active) setLoading(false); });
		const away = (event: MouseEvent) => { if (!box.current?.contains(event.target as Node)) setOpen(false); };
		document.addEventListener('mousedown', away);
		return () => { active = false; document.removeEventListener('mousedown', away); };
	}, [open, shell]);
	const run = async (action: () => Promise<void>) => {
		if (busy) return;
		setBusy(true); setError(undefined);
		try { await action(); if (live.current) { setOpen(false); trigger.current?.focus(); } }
		catch (e) { if (live.current) setError(e instanceof Error ? e.message : 'The project did not open. Try again or choose another folder.'); }
		finally { if (live.current) setBusy(false); }
	};
	const focusItem = (index: number) => {
		const items = box.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"], [role="menuitem"]');
		if (items?.length) items[(index + items.length) % items.length].focus();
	};
	useEffect(() => { if (open && !loading) focusItem(0); }, [open, loading]);
	const onKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === 'Escape' && open) { e.preventDefault(); e.stopPropagation(); setOpen(false); trigger.current?.focus(); }
		if (e.key === 'Tab') setOpen(false);
		if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Home' || e.key === 'End') {
			e.preventDefault(); e.stopPropagation();
			if (!open) { setOpen(true); return; }
			const items = Array.from(box.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"], [role="menuitem"]') ?? []);
			const index = items.indexOf(document.activeElement as HTMLButtonElement);
			focusItem(e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : index + (e.key === 'ArrowDown' ? 1 : -1));
		}
	};
	return <div ref={box} className='relative min-w-0' onClick={e => e.stopPropagation()} onKeyDown={onKeyDown}>
		<button ref={trigger} type='button' data-testid='vader-project-picker' aria-label='Choose project' aria-haspopup='menu' aria-expanded={open} aria-controls={open ? menuId : undefined}
			title={key ?? 'Chat (no project)'} className='flex items-center gap-1.5 max-w-full h-7 px-1.5 rounded-md text-[13px] text-vader-fg-2 hover:bg-vader-bg-2-hover'
			onClick={() => { setError(undefined); setOpen(v => !v); }}>
			<span aria-hidden='true'>⌂</span><span className='truncate' data-i18n-skip={key ? true : undefined}>{name}</span><span aria-hidden='true'>⌄</span>
		</button>
		{open ? <div id={menuId} role='menu' aria-label='Choose project' aria-busy={loading || busy} data-testid='vader-project-picker-menu'
			className='absolute bottom-full left-0 mb-1 z-50 rounded-lg border border-vader-border-2 bg-vader-bg-1 shadow-lg p-1 overflow-y-auto'
			style={{ width: 360, maxWidth: 'calc(100vw - 32px)', maxHeight: 'min(360px, 55vh)' }}>
			{loading ? <div role='status' className='px-2 py-2 text-xs text-vader-fg-3'>Loading projects…</div> : null}
			{projects.map(p => <button key={p.key} type='button' role='menuitemradio' aria-checked={key === p.key} aria-disabled={busy} data-testid='vader-project-picker-option' data-project-key={p.key}
				className='flex flex-col w-full min-w-0 text-left px-2 py-2 rounded-md hover:bg-vader-bg-2-hover focus:bg-vader-bg-2-hover' title={p.folders.join('\n')}
				onClick={() => { void run(() => shell.selectProject(p.folders)); }}>
				<span className='truncate max-w-full text-[13px]' data-i18n-skip>{p.name}{key === p.key ? ' ✓' : ''}</span>
				<span className='truncate max-w-full text-xs text-vader-fg-3' dir='ltr' data-i18n-skip>{p.folders.join(', ')}</span>
			</button>)}
			{!loading && projects.length === 0 ? <div data-testid='vader-project-picker-empty' className='px-2 py-2 text-xs text-vader-fg-3'>No recent projects. Choose a folder to get started.</div> : null}
			{historyUnavailable ? <div role='status' data-testid='vader-project-history-error' className='px-2 py-2 text-xs text-vader-fg-3'>Recent folders are unavailable. You can still choose a folder.</div> : null}
			<button type='button' role='menuitemradio' aria-checked={key === null} aria-disabled={busy} data-testid='vader-project-chat-only' className='w-full text-left px-2 py-2 rounded-md hover:bg-vader-bg-2-hover focus:bg-vader-bg-2-hover'
				onClick={() => { void run(() => shell.selectProject([])); }}>Chat (no project)</button>
			<button type='button' role='menuitem' aria-disabled={busy} data-testid='vader-project-new' className='w-full text-left px-2 py-2 border-t border-vader-border-2 rounded-md hover:bg-vader-bg-2-hover focus:bg-vader-bg-2-hover'
				onClick={() => { void run(() => shell.newProject()); }}>New project…</button>
		</div> : null}
		{error ? <div role='alert' data-testid='vader-project-picker-error' className='text-xs text-vader-fg-2 px-1.5 py-1'>{error}</div> : null}
	</div>;
};
