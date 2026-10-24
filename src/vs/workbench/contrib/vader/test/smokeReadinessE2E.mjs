#!/usr/bin/env node
// Controlled Chromium fixtures verify the packaged smoke predicate, not the product itself.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { inspectStartupSurface } from './smokeReadiness.mjs';
import { waitForStartupSurface } from './waitForStartupSurface.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');
let executablePath = process.env.CHROME_PATH;
if (!executablePath && process.platform === 'win32') {
	const base = path.join(process.env.LOCALAPPDATA ?? '', 'ms-playwright');
	const folder = fs.readdirSync(base).filter(name => name.startsWith('chromium_headless_shell')).sort().pop();
	if (folder) executablePath = path.join(base, folder, 'chrome-headless-shell-win64', 'chrome-headless-shell.exe');
}
const browser = await chromium.launch({ executablePath, args: ['--no-sandbox'] });
let count = 0;
try {
	const page = await browser.newPage();
	const inspect = async (html, options) => { await page.setContent(html); return page.evaluate(inspectStartupSurface, options); };
	const check = (name, actual, expected) => { assert.deepEqual(actual, expected, name); count++; console.log('PASS: ' + name); };
	const classicOptions = { expectedMode: 'classic' };
	check('a blank page fails', await inspect('<body></body>'), false);
	const classic = '<main class="monaco-workbench"><div class="part">a</div><div class="part">b</div><div class="part"><button>Editor action</button></div></main>';
	check('default readiness rejects inadvertent classic fallback', await inspect(classic), false);
	check('explicit modern readiness rejects classic fallback', await inspect(classic, { expectedMode: 'modern' }), false);
	check('a populated visible classic workbench is supported when explicitly requested', (await inspect(classic, classicOptions)).surface, 'classic');
	check('hidden classic parts cannot make a blank window pass', await inspect('<style>.monaco-workbench{visibility:hidden}</style>' + classic, classicOptions), false);
	check('an inert classic workbench cannot establish readiness', await inspect('<div inert>' + classic + '</div>', classicOptions), false);
	check('empty shell markup fails', await inspect('<main data-testid="vader-shell"><div data-testid="vader-shell-main"></div></main>'), false);
	const shell = '<main data-testid="vader-shell"><div data-testid="vader-shell-main"><button>Settings</button></div></main>';
	check('a hidden modern shell cannot fall back to a usable classic workbench', await inspect('<div hidden>' + shell + '</div>' + classic), false);
	check('explicit classic readiness requires a classic workbench', await inspect(shell, classicOptions), false);
	check('explicit classic mode selects classic when both layouts are present', (await inspect(classic + shell, classicOptions)).surface, 'classic');
	await assert.rejects(() => inspect(shell, { expectedMode: 'automatic' }), /Unsupported startup mode: automatic/);
	count++; console.log('PASS: an invalid expected mode is rejected');
	check('the modern shell needs no visible classic editor', (await inspect('<style>.monaco-workbench{display:none}</style>' + classic + shell)).surface, 'shell');
	check('an invisible ancestor cannot make a shell pass', await inspect('<div style="opacity:0">' + shell + '</div>'), false);
	check('disabled controls alone cannot make a shell pass', await inspect(shell.replace('<button>', '<button disabled>')), false);
	check('an inert ancestor cannot make a shell pass', await inspect('<div inert>' + shell + '</div>'), false);
	check('an inert control alone cannot make a shell pass', await inspect(shell.replace('<button>', '<button inert>')), false);
	check('inert controls do not inflate the usable control count', (await inspect(shell.replace('</button>', '</button><div inert><button>Blocked action</button></div>'))).interactive, 1);
	check('inert classic controls do not inflate the usable control count', (await inspect(classic.replace('</button>', '</button><button inert>Blocked action</button>'), classicOptions)).interactive, 1);
	const onboarding = '<div data-testid="vader-onboarding"><button>Skip for now</button></div>';
	check('interactive onboarding is supported', (await inspect(onboarding)).surface, 'onboarding');
	check('inert onboarding controls cannot establish readiness', await inspect('<div inert>' + onboarding + '</div>'), false);
	check('hidden onboarding does not mask the shell', (await inspect('<div style="display:none">' + onboarding + '</div>' + shell)).surface, 'shell');
	const overlap = '<div class="monaco-workbench"><div class="menubar">File Edit</div></div>' + shell;
	check('an overlapping classic menu is observable by the smoke gate', (await inspect(overlap)).classicMenuVisible, true);
	check('an inert menubar is still painted overlap', (await inspect(overlap.replace('class="menubar"', 'class="menubar" inert'))).classicMenuVisible, true);
	check('a hidden classic menu is not reported as overlap', (await inspect('<style>.menubar{visibility:hidden}</style>' + overlap)).classicMenuVisible, false);
	// MenuBar.updateOverflowAction() explicitly makes fitting buttons visible, overriding inherited visibility.
	const upstreamMenu = '<div class="monaco-workbench" style="visibility:hidden"><div class="menubar" style="visibility:hidden"><div class="menubar-menu-button" role="menuitem" tabindex="-1" aria-label="File" aria-haspopup="true">File</div></div></div>' + shell;
	check('a menu button inheriting hidden visibility is not overlap', (await inspect(upstreamMenu)).classicMenuVisible, false);
	await page.evaluate(() => { document.querySelector('.menubar-menu-button').style.visibility = 'visible'; });
	check('the upstream fixture has hidden ancestors and a rendered visible button', await page.evaluate(() => {
		const button = document.querySelector('.menubar-menu-button');
		const rect = button.getBoundingClientRect();
		return {
			workbench: getComputedStyle(document.querySelector('.monaco-workbench')).visibility,
			menubar: getComputedStyle(button.parentElement).visibility,
			button: getComputedStyle(button).visibility,
			rendered: rect.width > 0 && rect.height > 0,
		};
	}), { workbench: 'hidden', menubar: 'hidden', button: 'visible', rendered: true });
	check('an explicitly visible MenuBar button under hidden ancestors is overlap', (await page.evaluate(inspectStartupSurface)).classicMenuVisible, true);
	await page.evaluate(() => { document.querySelector('.monaco-workbench').style.display = 'none'; });
	check('display none on an ancestor suppresses even an explicitly visible menu button', (await page.evaluate(inspectStartupSurface)).classicMenuVisible, false);
	await page.evaluate(() => {
		const workbench = document.querySelector('.monaco-workbench');
		workbench.style.display = '';
		workbench.style.opacity = '0';
	});
	check('zero opacity on an ancestor suppresses an explicitly visible menu button', (await page.evaluate(inspectStartupSurface)).classicMenuVisible, false);
	await page.evaluate(() => {
		const workbench = document.querySelector('.monaco-workbench');
		workbench.style.opacity = '';
		workbench.inert = true;
	});
	check('an inert ancestor does not hide an explicitly visible menu button', (await page.evaluate(inspectStartupSurface)).classicMenuVisible, true);
	await page.evaluate(() => {
		const button = document.querySelector('.menubar-menu-button');
		button.dataset.clicks = '0';
		button.addEventListener('click', () => { button.dataset.clicks = String(Number(button.dataset.clicks) + 1); });
	});
	const menuBounds = await page.locator('.menubar-menu-button').boundingBox();
	check('the inert menu button still has painted dimensions', !!menuBounds && menuBounds.width > 0 && menuBounds.height > 0, true);
	await page.mouse.click(menuBounds.x + menuBounds.width / 2, menuBounds.y + menuBounds.height / 2);
	check('the inert menu button ignores mouse input', await page.locator('.menubar-menu-button').getAttribute('data-clicks'), '0');
	await page.evaluate(() => { document.querySelector('.monaco-workbench').inert = false; });
	await page.mouse.click(menuBounds.x + menuBounds.width / 2, menuBounds.y + menuBounds.height / 2);
	check('the same painted menu button accepts mouse input once inert is removed', await page.locator('.menubar-menu-button').getAttribute('data-clicks'), '1');
	await page.evaluate(() => {
		document.querySelector('.menubar-menu-button').style.visibility = 'hidden';
	});
	check('a MenuBar button hidden again is no longer overlap', (await page.evaluate(inspectStartupSurface)).classicMenuVisible, false);
	const overriddenControl = shell.replace('<button>', '<div style="visibility:hidden"><button style="visibility:visible">').replace('</button>', '</button></div>');
	check('a visible control can override a hidden ancestor in a ready shell', (await inspect(overriddenControl)).surface, 'shell');
	check('display none still suppresses an overridden visible shell control', await inspect(overriddenControl.replace('visibility:hidden', 'display:none')), false);
	check('inert still suppresses an overridden visible shell control', await inspect(overriddenControl.replace('style="visibility:hidden"', 'inert style="visibility:hidden"')), false);
	const overlay = '<section data-testid="vader-onboarding" style="position:fixed;inset:0;background:black;z-index:99"><select><option>English</option></select></section>';
	check('an onboarding select over a shell establishes the actual interactive surface', (await inspect(shell + overlay)).surface, 'onboarding');
	check('a shell behind an unrelated overlay is not usable', await inspect(shell + overlay.replace('data-testid="vader-onboarding"', 'id="unrelated"')), false);
	await page.setContent('<meta http-equiv="Content-Security-Policy" content="script-src \'nonce-vader-smoke\'; require-trusted-types-for \'script\'">' + overlay +
		'<script nonce="vader-smoke">try { new Function("return true")(); window.__vaderEvalBlocked = false; } catch { window.__vaderEvalBlocked = true; }</script>');
	check('the fixture actually blocks string-based evaluation under CSP', await page.evaluate(() => window.__vaderEvalBlocked), true);
	check('startup polling works under the actual Trusted Types constraint', (await waitForStartupSurface(page, { expectedMode: 'modern' }, 2000)).surface, 'onboarding');
} finally { await browser.close(); }
console.log(`${count} passed, 0 failed`);
