// A look at the words and the boxes of a page as drawn, run after each photograph of the UI tests when VADER_AUDIT names a file to append to (one JSON line per finding).
// It finds what a person sees at once and a test of behaviour does not: a button whose label is not in the middle of it, two pieces of text that touch, a text cut off
// without an ellipsis, a wrong plural ("1 files"), a doubled word, a space missing after a full stop. Used by the UI tests; nothing runs without VADER_AUDIT.
import fs from 'node:fs';

/** runs in the page */
function inPage() {
	const out = [];
	const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 1 && r.height > 1 && cs.visibility !== 'hidden' && cs.display !== 'none' && cs.opacity !== '0'; };
	const parse = (c) => { const m = /rgba?\(([^)]+)\)/.exec(c); if (!m) return null; const p = m[1].split(/[ ,\/]+/).filter(Boolean).map(Number); return { a: p[3] === undefined ? 1 : p[3] }; };
	const label = (el) => (el.getAttribute('data-testid') || el.getAttribute('aria-label') || el.className?.toString().split(' ')[0] || el.tagName.toLowerCase());
	const textOf = (el) => (el.innerText || '').replace(/\s+/g, ' ').trim();
	const textRect = (el) => { const rg = document.createRange(); rg.selectNodeContents(el); const rs = [...rg.getClientRects()].filter(r => r.width > 0 && r.height > 0); if (!rs.length) return null; return { left: Math.min(...rs.map(r => r.left)), right: Math.max(...rs.map(r => r.right)), top: Math.min(...rs.map(r => r.top)), bottom: Math.max(...rs.map(r => r.bottom)) }; };

	// 1. the label of a button that has a frame or a fill sits in the middle of it
	for (const b of document.querySelectorAll('button, [role=button]')) {
		if (!vis(b)) continue;
		const cs = getComputedStyle(b); const r = b.getBoundingClientRect();
		const fill = parse(cs.backgroundColor); const border = parseFloat(cs.borderTopWidth) > 0 && (parse(cs.borderTopColor)?.a ?? 0) > 0.05;
		const framed = (fill && fill.a > 0.25) || border;
		const t = textOf(b); if (!framed || !t || r.width < 60 || r.height < 18 || r.height > 60) continue;
		if ([...b.children].some(c => !['svg', 'IMG', 'I', 'SPAN'].includes(c.tagName)) ) continue;
		const tr = textRect(b); if (!tr) continue;
		const l = tr.left - r.left, rr = r.right - tr.right;
		if (l >= 0 && rr >= 0 && Math.abs(l - rr) > 8 && l + rr > 28) out.push({ kind: 'label-off-centre', text: t.slice(0, 50), detail: `${Math.round(l)}px left, ${Math.round(rr)}px right in a ${Math.round(r.width)}px button`, where: label(b) });
	}

	// 2. text cut off with no ellipsis
	for (const el of document.querySelectorAll('body *')) {
		if (!vis(el) || !el.childNodes.length) continue;
		const own = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim().length > 2);
		if (!own) continue;
		const cs = getComputedStyle(el);
		if (el.scrollWidth > el.clientWidth + 2 && /hidden|clip/.test(cs.overflowX) && cs.textOverflow !== 'ellipsis' && cs.whiteSpace !== 'pre' && !el.closest('pre, code, [data-testid=vader-diff]')) {
			out.push({ kind: 'text-cut-off', text: textOf(el).slice(0, 60), detail: `${el.scrollWidth} wide in ${el.clientWidth}`, where: label(el) });
		}
	}

	// 3. two pieces of text on one line that touch
	for (const p of document.querySelectorAll('body *')) {
		const kids = [...p.children].filter(c => vis(c) && [...c.childNodes].some(n => n.nodeType === 3 && n.textContent.trim().length > 0) && c.children.length === 0);
		if (kids.length < 2) continue;
		const cs = getComputedStyle(p); if (!/flex|grid/.test(cs.display) || parseFloat(cs.columnGap) > 2) continue;
		for (let i = 0; i < kids.length - 1; i++) {
			const a = kids[i].getBoundingClientRect(), b = kids[i + 1].getBoundingClientRect();
			if (Math.abs((a.top + a.bottom) / 2 - (b.top + b.bottom) / 2) < 5 && b.left - a.right >= -1 && b.left - a.right < 3 && !/^[,.;:)\]]/.test(textOf(kids[i + 1])) && !/[(\[]$/.test(textOf(kids[i]))) {
				out.push({ kind: 'text-touches', text: `${textOf(kids[i]).slice(0, 30)} | ${textOf(kids[i + 1]).slice(0, 30)}`, detail: `${Math.round(b.left - a.right)}px apart`, where: label(p) });
			}
		}
	}

	// 4. the words themselves
	const seen = new Set();
	for (const el of document.querySelectorAll('body *')) {
		if (!vis(el) || el.closest('pre, code, [data-testid=vader-diff], textarea, input, svg, [class*=mo]')) continue;
		if (![...el.childNodes].some(n => n.nodeType === 3)) continue;
		const t = [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join(' ').replace(/\s+/g, ' ').trim();
		if (t.length < 4 || seen.has(t)) continue; seen.add(t);
		const hit = (kind, m) => out.push({ kind, text: t.slice(0, 80), detail: m, where: label(el) });
		let m;
		if ((m = /\b1 (files|changes|diffs|results|tasks|models|steps|lines|rows|items|patterns|commands|chats|terminals|pages|tools|servers|helpers)\b/.exec(t))) hit('wrong-plural', m[0]);
		if ((m = /\b([A-Za-z]{2,}) \1\b/.exec(t)) && !/^(had|that|very)$/.test(m[1])) hit('doubled-word', m[0]);
		if ((m = /[a-z]{3}[.!?][A-Z][a-z]{2}/.exec(t)) && !/\w\.\w+\.\w/.test(t) && !/[.][A-Za-z]{2,4}\b/.test(m[0])) hit('no-space-after-stop', m[0]);
		if ((m = /\s[,;:]\s/.exec(t))) hit('space-before-punctuation', m[0]);
		if ((m = /[a-z]{2}[A-Z][a-z]{3,}/.exec(t)) && !/^[a-z]+[A-Z]/.test(t.split(' ')[0]) && !/[A-Za-z]+\.[a-z]|[A-Z][a-z]+[A-Z][a-z]+/.test(m[0] + 'x') ) hit('run-together-words', m[0]);
		if ((m = /  +/.exec(el.textContent)) && getComputedStyle(el).whiteSpace === 'normal' && false) hit('double-space', '');
		if ((m = /^[a-z][a-z ]{12,}[.]$/.exec(t)) && el.tagName !== 'BUTTON') hit('sentence-starts-lowercase', t.slice(0, 20));
	}
	return out;
}

export async function auditShot(page, name) {
	const file = process.env.VADER_AUDIT;
	if (!file) return;
	let found;
	try { found = await page.evaluate(inPage); } catch { return; }
	if (!found.length) return;
	fs.appendFileSync(file, found.map(f => JSON.stringify({ shot: name, ...f })).join('\n') + '\n');
}
