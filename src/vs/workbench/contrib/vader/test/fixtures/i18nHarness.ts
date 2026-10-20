// The language of the screens in a test page: the same translator the app mounts (util/i18n), asked for a language by the test (window.__setLang('ar')).
import { auditMissingTexts, missingTexts, startPageTranslator } from '../../browser/react/src2/util/i18n/translator'

export const installLanguage = (root: HTMLElement) => {
	const w = window as unknown as { __lang?: string, __setLang?: (l: string) => void, __i18nMissing?: Set<string> }
	// the language the test run asks for (VADER_LANG=ar|zh), so every picture of a test can be taken in it and the texts still in English listed
	// the preview (test/uiPreview.mjs) is three pages: the language chosen on one is kept for the others
	const kept = process.env.VADER_PREVIEW ? (() => { try { return localStorage.getItem('vaderPreviewLanguage') ?? undefined } catch { return undefined } })() : undefined
	w.__lang = w.__lang ?? kept ?? (process.env.VADER_LANG || 'en')
	w.__i18nMissing = missingTexts
	auditMissingTexts(true)
	const listeners = new Set<() => void>()
	w.__setLang = (l: string) => { w.__lang = l; if (process.env.VADER_PREVIEW) { try { localStorage.setItem('vaderPreviewLanguage', l) } catch { /* private window */ } } listeners.forEach(f => f()) }
	startPageTranslator(root, { language: () => (w.__lang ?? 'en') as 'en' | 'ar' | 'zh', onDidChange: f => { listeners.add(f); return { dispose: () => { listeners.delete(f) } } } })
}
