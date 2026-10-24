/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import React from 'react'

// The marks of the interface boards, drawn on a 24 grid with a 1.4 stroke (the "i" class in shell.css gives them size and stroke).

const PATHS = {
	plus: <path d='M12 5v14M5 12h14' />,
	info: <><circle cx='12' cy='12' r='9' /><path d='M12 11v5M12 8v.5' /></>,
	check: <path d='m5 12.5 4.5 4.5L19 7.5' />,
	x: <path d='M6 6l12 12M18 6 6 18' />,
	search: <><circle cx='11' cy='11' r='7' /><path d='m20 20-3.5-3.5' /></>,
	down: <path d='m7 10 5 5 5-5' />,
	right: <path d='m10 7 5 5-5 5' />,
	left: <path d='m15 6-6 6 6 6' />,
	folder: <path d='M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z' />,
	term: <path d='m5 8 4 4-4 4M12 17h7' />,
	globe: <><circle cx='12' cy='12' r='9' /><path d='M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18' /></>,
	file: <><path d='M6 4h9l3 3v13H6z' /><path d='M9 11h6M9 15h6' /></>,
	plug: <path d='M9 3v5M15 3v5M7 8h10v4a5 5 0 0 1-10 0zM12 17v4' />,
	key: <><circle cx='8' cy='15' r='4' /><path d='m11 12 8-8M16 7l3 3' /></>,
	lock: <><rect x='5' y='11' width='14' height='9' rx='2' /><path d='M8 11V8a4 4 0 0 1 8 0v3' /></>,
	gear: <><path d='M9.6 3.4h4.8l.6 2.2 1.6.9 2.2-.6 2.4 4.2-1.6 1.6v1.8l1.6 1.6-2.4 4.2-2.2-.6-1.6.9-.6 2.2H9.6L9 19.6l-1.6-.9-2.2.6-2.4-4.2 1.6-1.6v-1.8l-1.6-1.6 2.4-4.2 2.2.6L9 5.6z' /><circle cx='12' cy='12.6' r='3.1' /></>,
	grid: <><rect x='3.5' y='3.5' width='7' height='7' rx='1.7' /><rect x='3.5' y='13.5' width='7' height='7' rx='1.7' /><rect x='13.5' y='13.5' width='7' height='7' rx='1.7' /><path d='M17 3.2v7.6M13.2 7h7.6' /></>,
	dl: <path d='M12 4v11M7 11l5 5 5-5M5 20h14' />,
	refresh: <path d='M20 12a8 8 0 1 1-2.4-5.7M20 4v5h-5' />,
	up: <path d='M12 19V5M5 12l7-7 7 7' />,
	more: <><circle cx='5' cy='12' r='1' /><circle cx='12' cy='12' r='1' /><circle cx='19' cy='12' r='1' /></>,
	branch: <><circle cx='6' cy='5' r='2' /><circle cx='6' cy='19' r='2' /><circle cx='18' cy='8' r='2' /><path d='M6 7v10M18 10c0 4-6 3-12 7' /></>,
	clock: <><circle cx='12' cy='12' r='9' /><path d='M12 7v5l3 2' /></>,
	trash: <path d='M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13' />,
	copy: <><rect x='8' y='8' width='12' height='12' rx='2' /><path d='M4 16V6a2 2 0 0 1 2-2h10' /></>,
	image: <><rect x='3' y='4' width='18' height='16' rx='2' /><circle cx='9' cy='10' r='1.5' /><path d='m4 18 5-5 4 4 3-3 4 4' /></>,
	shield: <path d='M12 3 5 6v6c0 4 3 7 7 9 4-2 7-5 7-9V6z' />,
	link: <path d='M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1' />,
	pause: <path d='M8 5v14M16 5v14' />,
	play: <path d='M7 5v14l11-7z' />,
	stop: <rect x='6' y='6' width='12' height='12' rx='1.5' />,
	cloud: <path d='M7 18a4 4 0 0 1-.5-8A5.5 5.5 0 0 1 17 8.5 4 4 0 0 1 17 18z' />,
	eye: <><path d='M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z' /><circle cx='12' cy='12' r='3' /></>,
	bolt: <path d='M13 3 5 13h6l-1 8 8-10h-6z' />,
	user: <><circle cx='12' cy='8' r='4' /><path d='M4 21a8 8 0 0 1 16 0' /></>,
	menu: <path d='M4 5h16M4 12h16M4 19h16' />,
	panel: <><rect x='3' y='4' width='18' height='16' rx='2' /><path d='M9 4v16' /></>,
} as const

export type IconName = keyof typeof PATHS

export const Icon = ({ k, small }: { k: IconName, small?: boolean }) =>
	<svg className={small ? 'i i12' : 'i'} viewBox='0 0 24 24' aria-hidden='true'>{PATHS[k]}</svg>

/** a conversation that is working */
export const Spinner = () => <svg className='spin' width='14' height='14' viewBox='0 0 14 14' aria-label='Running' style={{ flex: 'none' }}>
	<circle cx='7' cy='7' r='5' fill='none' stroke='rgba(255,255,255,.16)' strokeWidth='1.6' />
	<path d='M7 2a5 5 0 0 1 5 5' fill='none' stroke='#6ea0ff' strokeWidth='1.6' strokeLinecap='round' />
</svg>

/** a conversation that waits for the person */
export const WaitDot = () => <svg width='14' height='14' viewBox='0 0 14 14' aria-label='Waiting for you' style={{ flex: 'none' }}><circle cx='7' cy='7' r='3.2' fill='#e2a93f' /></svg>

/** a conversation whose changes are ready to read */
export const ReviewRing = () => <svg width='14' height='14' viewBox='0 0 14 14' aria-label='Ready to review' style={{ flex: 'none' }}><circle cx='7' cy='7' r='4.4' fill='none' stroke='#8a8a91' strokeWidth='1.4' /></svg>

export const WarnTri = ({ color = '#e2a93f' }: { color?: string }) => <svg width='14' height='14' viewBox='0 0 15 15' aria-hidden='true' style={{ flex: 'none' }}><path d='M7.5 2.2 13.3 12.6H1.7z' fill='none' stroke={color} strokeWidth='1.3' strokeLinejoin='round' /></svg>

export const Gap = () => <span style={{ width: 14, flex: 'none' }} />
