/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import type { UiLanguage } from '../../../../../common/vaderSettingsTypes.js'
import { ar } from './ar.js'
import { zh } from './zh.js'

// The language of Vader's own screens. The screens are written in English; a language is a table from the English text to the text of that language, applied to what is on
// the screen: the words of the page, and the placeholder, title and label of what has one. Text that is not in the table (a file name, a model's name, what a person or the
// agent wrote) stays as it is, so a missing entry shows English and never breaks anything. A text with a number or a name in it is a template: "{0} files" is written once.
// Arabic is laid out right to left: the root of each screen gets dir="rtl" (the editor around it is not touched).

export const LANGUAGE_NAMES: Record<UiLanguage, string> = { en: 'English', ar: 'العربية', zh: '中文' }

type Table = { exact: Map<string, string>, templates: { re: RegExp, out: string, literal: number }[] }

const compile = (dict: Record<string, string>): Table => {
	const exact = new Map<string, string>()
	const templates: Table['templates'] = []
	for (const [key, value] of Object.entries(dict)) {
		if (/\{\d+\}/.test(key)) {
			const parts = key.split(/\{\d+\}/)
			const re = new RegExp('^' + parts.map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('([\\s\\S]*?)') + '$')
			templates.push({ re, out: value, literal: parts.join('').length })
		} else {
			exact.set(key, value)
		}
	}
	templates.sort((a, b) => b.literal - a.literal) // the most specific template first
	return { exact, templates }
}

const tables: Partial<Record<UiLanguage, Table>> = {}
const tableOf = (lang: UiLanguage): Table | undefined => {
	if (lang === 'en') { return undefined }
	return tables[lang] ??= compile(lang === 'ar' ? ar : zh)
}

const normalise = (s: string) => s.replace(/\s+/g, ' ').trim()

/** the text in the language, or undefined when the table has nothing for it */
export const translateText = (english: string, lang: UiLanguage, depth = 0): string | undefined => {
	const table = tableOf(lang)
	if (!table) { return undefined }
	const key = normalise(english)
	if (!key) { return undefined }
	const hit = table.exact.get(key)
	if (hit !== undefined) { return hit }
	for (const t of table.templates) {
		const m = t.re.exec(key)
		if (m) {
			return t.out.replace(/\{(\d+)\}/g, (_, i: string) => {
				const inner = m[Number(i) + 1] ?? ''
				return (depth < 2 ? translateText(inner, lang, depth + 1) : undefined) ?? inner
			})
		}
	}
	// a short list of words each of which has an entry ("Files, Terminal, Network") is a list in the language
	if (depth === 0 && key.includes(', ') && key.length < 80) {
		const parts = key.split(', ').map(p => translateText(p, lang, depth + 1))
		if (parts.every(p => p !== undefined)) { return parts.join(lang === 'ar' ? '، ' : '、') }
	}
	return undefined
}

const ATTRIBUTES = ['placeholder', 'title', 'aria-label', 'alt']
// what is a person's or the agent's own words, code or a path: never translated
const SKIP = 'pre, code, textarea, script, style, svg, [data-i18n-skip], .mo, .vader-mo, .md, .vader-md, .monaco-editor, .xterm'

type TextState = { orig: string, set: string }

/** the texts that had no entry in the language of the page: filled only where a test asks for it (the audit that lists what is still in English) */
export const missingTexts = new Set<string>()
let auditMissing = false
export const auditMissingTexts = (on: boolean) => { auditMissing = on }
const noteMissing = (english: string) => { if (auditMissing && /[A-Za-z]{3}/.test(english)) { missingTexts.add(normalise(english)) } }

/** Keeps the page of one root in the chosen language: translates what is there and what is added or changed later. */
export class PageTranslator {
	private _lang: UiLanguage = 'en'
	private readonly _text = new WeakMap<Text, TextState>()
	private readonly _attr = new WeakMap<Element, Record<string, TextState>>()
	private readonly _observer: MutationObserver
	private _queued = new Set<Node>()
	private _scheduled = false

	constructor(private readonly _root: HTMLElement) {
		this._observer = new MutationObserver(records => {
			for (const r of records) {
				if (r.type === 'characterData') { if (r.target.parentNode) { this._queued.add(r.target.parentNode) } }
				else if (r.type === 'attributes') { this._queued.add(r.target) }
				else { r.addedNodes.forEach(n => this._queued.add(n)); this._queued.add(r.target) }
			}
			this._schedule()
		})
		this._observer.observe(_root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRIBUTES })
	}

	get language() { return this._lang }

	setLanguage(lang: UiLanguage) {
		this._lang = lang
		if (lang === 'ar') { this._root.setAttribute('dir', 'rtl') } else { this._root.removeAttribute('dir') }
		if (lang === 'en') { this._root.removeAttribute('lang') } else { this._root.setAttribute('lang', lang === 'zh' ? 'zh-CN' : lang) }
		this._root.setAttribute('data-vader-language', lang)
		this._walk(this._root)
	}

	dispose() { this._observer.disconnect(); this._queued.clear() }

	private _schedule() {
		if (this._scheduled) { return }
		this._scheduled = true
		queueMicrotask(() => {
			this._scheduled = false
			const nodes = [...this._queued]
			this._queued = new Set()
			for (const n of nodes) { if (this._root.contains(n)) { this._walk(n) } }
		})
	}

	private _skipped(el: Element | null): boolean { return !!el && !!el.closest(SKIP) }

	private _walk(node: Node) {
		if (node.nodeType === 3) { const p = node.parentElement; if (p) { this._text_run(p) } return }
		if (node.nodeType !== 1) { return }
		const el = node as Element
		if (this._skipped(el)) { return }
		this._attributes(el)
		this._text_run(el)
		for (const child of Array.from(el.children)) { this._walk(child) }
	}

	/** the text of an element is its runs of text nodes next to each other (React writes "{n} files" as two nodes): each run is one sentence */
	private _text_run(el: Element) {
		if (this._skipped(el)) { return }
		let run: Text[] = []
		const flush = () => { if (run.length) { this._run(run); run = [] } }
		for (const n of Array.from(el.childNodes)) {
			if (n.nodeType === 3) { run.push(n as Text) } else { flush() }
		}
		flush()
	}

	private _run(nodes: Text[]) {
		const originals = nodes.map(n => { const st = this._text.get(n); return st && n.nodeValue === st.set ? st.orig : (n.nodeValue ?? '') })
		const english = originals.join('')
		const translated = this._lang === 'en' || !/[A-Za-z]/.test(english) ? undefined : translateText(english, this._lang)
		if (translated === undefined) {
			// a sentence made of several pieces (a text, a number, a text) that has no entry as a whole: each piece that has an entry is translated by itself
			const pieces = this._lang !== 'en' && nodes.length > 1 ? originals.map(o => /[A-Za-z]/.test(o) ? translateText(o, this._lang) : undefined) : []
			if (pieces.some(p => p !== undefined)) {
				nodes.forEach((n, i) => {
					const p = pieces[i]
					const value = p === undefined ? originals[i] : /^\s*/.exec(originals[i])![0] + p + /\s*$/.exec(originals[i])![0]
					if (p === undefined && /[A-Za-z]{3}/.test(originals[i])) { noteMissing(originals[i]) }
					if (n.nodeValue !== value) { n.nodeValue = value }
					if (p === undefined) { this._text.delete(n) } else { this._text.set(n, { orig: originals[i], set: value }) }
				})
				return
			}
			if (this._lang !== 'en') { noteMissing(english) }
			nodes.forEach((n, i) => { if (n.nodeValue !== originals[i]) { n.nodeValue = originals[i] } this._text.delete(n) })
			return
		}
		const lead = /^\s*/.exec(english)![0], trail = /\s*$/.exec(english)![0]
		const whole = lead + translated + trail
		nodes.forEach((n, i) => {
			const value = i === 0 ? whole : ''
			if (n.nodeValue !== value) { n.nodeValue = value }
			this._text.set(n, { orig: originals[i], set: value })
		})
	}

	private _attributes(el: Element) {
		let states = this._attr.get(el)
		for (const name of ATTRIBUTES) {
			const current = el.getAttribute(name)
			if (current === null) { continue }
			const st = states?.[name]
			const english = st && current === st.set ? st.orig : current
			const translated = this._lang === 'en' ? undefined : translateText(english, this._lang)
			if (translated === undefined) {
				if (this._lang !== 'en') { noteMissing(english) }
				if (current !== english) { el.setAttribute(name, english) }
				if (states) { delete states[name] }
				continue
			}
			if (current !== translated) { el.setAttribute(name, translated) }
			states ??= {}
			states[name] = { orig: english, set: translated }
			this._attr.set(el, states)
		}
	}
}

/** one translator for a root, following the language chosen in Settings; returns what stops it */
export const startPageTranslator = (root: HTMLElement, source: { language(): UiLanguage, onDidChange(listener: () => void): { dispose(): void } }): { dispose(): void } => {
	const t = new PageTranslator(root)
	t.setLanguage(source.language())
	const sub = source.onDidChange(() => { const lang = source.language(); if (lang !== t.language) { t.setLanguage(lang) } })
	return { dispose() { sub.dispose(); t.dispose() } }
}
