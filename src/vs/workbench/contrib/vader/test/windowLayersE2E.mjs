#!/usr/bin/env node
// Controlled Chromium DOM integration, not Electron/native-window verification.
// Uses production layer helper/CSS, upstream titlebar CSS and the actual MenuBar.
// Controlled host/markup only: no Electron workspace reload or native-window claims.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');
const esbuild = require('esbuild');
const here = path.dirname(fileURLToPath(import.meta.url));
const vader = path.resolve(here, '..');
const repo = path.resolve(vader, '../../../../..');
// Sensitivity check: use released HEAD CSS with the same runtime assertions.
const legacyCss = process.argv.includes('--baseline-css');
const bundle = await esbuild.build({ entryPoints: [path.join(vader, 'browser/vaderWindowLayers.ts')],
 bundle: true, format: 'iife', globalName: 'layers', write: false, logLevel: 'silent' });
// Exercise the real contribution/overlay methods with an isolated host/mount,
// including initial DOM absence and a mount that throws. React itself is tested
// by windowUiE2E; no fake markup here is production UI or Electron evidence.
const stubs = {
 'base/browser/dom.js': 'export const getActiveWindow=()=>window;',
 'platform/contextkey/common/contextkey.js': 'export const IContextKeyService=()=>{}; export const ContextKeyExpr={and(){},equals(){}}; export class RawContextKey { bindTo(s){return s.key} }',
 'platform/instantiation/common/instantiation.js': 'export const IInstantiationService=()=>{};',
 'platform/actions/common/actions.js': 'export class Action2{}; export const registerAction2=()=>{}; export const MenuId={};export const MenuRegistry={appendMenuItem(){}};',
 'platform/keybinding/common/keybindingsRegistry.js': 'export const KeybindingWeight={WorkbenchContrib:100};',
 'workbench/common/contributions.js': 'export const WorkbenchPhase={BlockRestore:"BlockRestore"}; export const registerWorkbenchContribution2=(id,ctor,phase)=>{window.__registeredPhase=phase};',
 'contrib/vader/browser/chatThreadService.js': 'export const IChatThreadService=()=>{};',
 'workbench/services/layout/browser/layoutService.js': 'export const IWorkbenchLayoutService=()=>{};',
 'contrib/vader/browser/vaderShellService.js': 'export const IVaderShellService=()=>{};',
 'react/out/vader-shell-tsx/index.js': 'export const mountVaderShell=root=>{window.__mounts=(window.__mounts??0)+1;if(window.__mountFails-- > 0)throw new Error("controlled mount failure");root.textContent="Mounted shell";return{dispose(){window.__unmounts=(window.__unmounts??0)+1}}};',
 'react/out/vader-settings-tsx/index.js': 'export const mountVaderSettings=root=>{if(window.__settingsMountFails-- > 0)throw new Error("controlled settings failure");root.textContent="Mounted Settings";return{dispose(){window.__settingsUnmounts=(window.__settingsUnmounts??0)+1}}};',
};
const contribution = await esbuild.build({ entryPoints: [path.join(vader, 'browser/vaderShellPane.ts')],
 bundle: true, format: 'iife', globalName: 'contribution', write: false, logLevel: 'silent',
 tsconfigRaw: { compilerOptions: { experimentalDecorators: true, useDefineForClassFields: false } },
 plugins: [{ name: 'controlled-window-host', setup(build) {
  build.onResolve({ filter: /.*/ }, args => {
   const full = path.resolve(args.resolveDir, args.path).replaceAll('\\', '/');
   const key = Object.keys(stubs).find(k => full.endsWith('/' + k));
   return key ? { path: key, namespace: 'host' } : undefined;
  });
  build.onLoad({ filter: /.*/, namespace: 'host' }, args => ({ contents: stubs[args.path], loader: 'js' }));
 } }],
});
const settingsBundle = await esbuild.build({ entryPoints: [path.join(vader, 'browser/vaderSettingsPane.ts')], bundle: true, format: 'iife', globalName: 'settingsPane', write: false, logLevel: 'silent',
 tsconfigRaw: { compilerOptions: { experimentalDecorators: true, useDefineForClassFields: false } },
 plugins: [{ name: 'settings-controlled-host', setup(build) {
  build.onResolve({ filter: /.*/ }, args => {
   const full = path.resolve(args.resolveDir, args.path).replaceAll('\\', '/');
   const key = Object.keys(stubs).find(k => full.endsWith('/' + k));
   return key ? { path: key, namespace: 'host' } : undefined;
  });
  build.onLoad({ filter: /.*/, namespace: 'host' }, args => ({ contents: stubs[args.path], loader: 'js' }));
 } }],
});
// No menu-layout stand-in: upstream overflow layout writes inline visibility:visible
// on its buttons. A hidden ancestor alone does not suppress those descendants.
const menubarBundle = await esbuild.build({ entryPoints: [path.resolve(vader, '../../../base/browser/ui/menu/menubar.ts')],
 bundle: true, format: 'iife', globalName: 'upstreamMenus', write: false, logLevel: 'silent', loader: { '.css': 'empty' } });
// Execute the actual early bootstrap function, before any contribution runs.
// Its preload zoom dependency is isolated; splash/layout and DOM behavior are real.
const ts = require('typescript');
const bootstrapPath = path.resolve(vader, '../../../code/electron-browser/workbench/workbench.ts');
const bootstrapSource = ts.createSourceFile(bootstrapPath, fs.readFileSync(bootstrapPath, 'utf8'), ts.ScriptTarget.Latest, true);
let splashFunction;
const findSplash = node => { if (ts.isFunctionDeclaration(node) && node.name?.text === 'showDefaultSplash') splashFunction = node; ts.forEachChild(node, findSplash); };
findSplash(bootstrapSource);
assert(splashFunction, 'production bootstrap function exists');
const bootstrap = await esbuild.transform(`const preloadGlobals={webFrame:{setZoomLevel(){}}};${splashFunction.getText(bootstrapSource)};window.__showVaderSplash=showDefaultSplash;`, { loader: 'ts' });
let executablePath = process.env.CHROME_PATH;
if (!executablePath && process.platform === 'win32') {
 const base = path.join(process.env.LOCALAPPDATA, 'ms-playwright');
 const dir = fs.readdirSync(base).filter(n => n.startsWith('chromium_headless_shell')).sort().pop();
 executablePath = path.join(base, dir, 'chrome-headless-shell-win64/chrome-headless-shell.exe');
}
const browser = await chromium.launch({ executablePath, args: ['--no-sandbox'] });
let passed = 0;
const check = (name, condition) => { assert(condition, name); passed++; console.log('PASS: ' + name); };
try {
 const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
 await page.emulateMedia({ reducedMotion: 'reduce' });
 const errors = []; page.on('pageerror', err => errors.push(String(err)));
 await page.setContent(`<!doctype html><title>Vader window layers regression</title><style>
 html,body{margin:0;background:#0b0b0c;color:#ededee;font:13px 'Segoe UI',sans-serif}
 .monaco-workbench{position:relative;width:100vw;height:100vh;--window-border-color:blue}
 .part.titlebar{height:35px}.titlebar-left{width:600px;flex-shrink:0!important}.titlebar-left>.menubar{width:600px}.part.editor{position:absolute;inset:35px 0 0;background:#202024}
 .vader-shell-overlay{padding:0 24px;box-sizing:border-box}
 .vader-settings-overlay{position:fixed;inset:0;z-index:800;background:#121214;padding:20px}
 .vader-shell-overlay:focus,.vader-settings-overlay:focus{outline:2px solid blue}
 button:focus-visible{outline:2px solid #6ea0ff}button{color:inherit;background:#202024;border:1px solid #555;padding:5px 12px}
 </style><body class="vader-window-starting"><div class="monaco-workbench windows">
 <div class="part titlebar"><div class="titlebar-container"><div class="titlebar-left"><div class="menubar" id="legacy"></div><button id="classic-title-action" style="visibility:visible">Classic toolbar</button></div>
 <div class="window-controls-container"><button id="window-control" class="window-icon">×</button></div></div></div>
 <div class="part editor">Classic editor<div id="editor-visible-child" style="visibility:visible;position:absolute;z-index:2600">Restored diff editor</div></div>
 <div id="shell" class="vader-shell-overlay vader-shell" tabindex="-1" style="display:none;top:0"><p>Vader — controlled window-layer fixture</p><button id="action" class="vader-tx">New chat</button><textarea data-testid="vader-input" id="composer" aria-label="Composer focus fixture"></textarea></div>
 <div id="settings" class="vader-settings-overlay" tabindex="-1" style="display:none">Settings <button>Back to chat</button></div>
 </div></body>`);
 await page.addStyleTag({ content: fs.readFileSync(path.resolve(vader, '../../../base/browser/ui/menu/menubar.css'), 'utf8') });
 await page.addStyleTag({ content: fs.readFileSync(path.resolve(vader, '../../browser/parts/titlebar/media/titlebarpart.css'), 'utf8') });
 await page.addStyleTag({ content: legacyCss ? execFileSync('git', ['show', 'HEAD:src/vs/workbench/contrib/vader/browser/media/vader.css'], { cwd: repo, encoding: 'utf8' }) : fs.readFileSync(path.join(vader, 'browser/media/vader.css'), 'utf8') });
 await page.addStyleTag({ content: fs.readFileSync(path.resolve(vader, '../../browser/media/style.css'), 'utf8') });
 await page.addStyleTag({ content: fs.readFileSync(path.join(vader, 'browser/react/src/vader-shell-tsx/shell.css'), 'utf8') });
 await page.addScriptTag({ content: bundle.outputFiles[0].text });
 const visible = selector => page.locator(selector).isVisible();
 await page.addScriptTag({ content: menubarBundle.outputFiles[0].text });
 await page.evaluate(() => {
  window.__menubar = new window.upstreamMenus.MenuBar(document.querySelector('#legacy'), { visibility: 'classic' }, {});
  window.__menubar.push(['File', 'Edit', 'Selection', 'View', 'Go', 'Run', 'Terminal', 'Help'].map(label => ({ label, actions: [] })));
  window.__menubar.update();
 });
 const inlineVisibleMenus = () => page.locator('#legacy > .menubar-menu-button').evaluateAll(nodes => nodes.filter(el => el.style.visibility === 'visible').length);
 const hiddenMenus = () => page.locator('#legacy > .menubar-menu-button').evaluateAll(nodes => nodes.length > 0 && nodes.every(el => getComputedStyle(el).visibility === 'hidden'));
 await page.waitForFunction(() => [...document.querySelectorAll('#legacy > .menubar-menu-button')].some(el => el.style.visibility === 'visible'));
 check('real upstream menu layout ran and wrote inline visibility', await inlineVisibleMenus() >= 2);
 check('bootstrap suppresses real menu buttons despite upstream inline visibility', await hiddenMenus());
 check('fixture has expected identity and meaningful content', await page.title() === 'Vader window layers regression' && await page.locator('#shell').textContent());
 check('bootstrap hides classic editor and inherited menus', !await visible('.part.editor') && !await visible('#legacy'));
 check('bootstrap also hides restored editor descendants with explicit visibility', !await visible('#editor-visible-child'));
 check('bootstrap hides all inherited titlebar actions while retaining real window controls', !await visible('#classic-title-action') && await visible('#window-control'));
 check('bootstrap window border is transparent before shell mount', await page.locator('.monaco-workbench').evaluate(el => getComputedStyle(el).getPropertyValue('--window-border-color').trim() === 'transparent'));
 await page.evaluate(() => {
  window.layers.setVaderWindowLayer(document.querySelector('.monaco-workbench'), 'shell', true);
  document.querySelector('#shell').style.display = 'flex';
  document.body.classList.remove('vader-window-starting');
  document.querySelector('#window-control').onclick = () => window.controlClicks = (window.controlClicks ?? 0) + 1;
 });
 check('shell stays visible after bootstrap is released, classic parts hidden', await visible('#shell') && !await visible('#legacy') && !await visible('.part.editor'));
 check('shell suppresses real menu buttons after the startup mask is released', await hiddenMenus());
 // Preserve the widget's layout dimensions rather than display:none: repeated
 // narrow/wide updates must still compute the same overflow state as classic mode.
 await page.evaluate(() => { document.querySelector('#legacy').style.width = '60px'; window.__menubar.update(); });
 await page.waitForFunction(() => document.querySelector('#legacy').classList.contains('overflow-menu-only'));
 check('upstream overflow relayout cannot expose a menu over the shell', await hiddenMenus() && await inlineVisibleMenus() === 1);
 await page.evaluate(() => { document.querySelector('#legacy').style.width = '600px'; window.__menubar.update(); });
 await page.waitForFunction(() => !document.querySelector('#legacy').classList.contains('overflow-menu-only'));
 check('upstream wide relayout still computes menu buttons while the shell hides them', await hiddenMenus() && await inlineVisibleMenus() >= 2);
 await page.locator('#window-control').click({ timeout: 3000 });
 check('window controls remain visible above the page and receive a real click', await page.evaluate(() => window.controlClicks === 1));
 await page.locator('#shell').focus();
 check('host focus does not draw a blue frame', await page.locator('#shell').evaluate(el => getComputedStyle(el).outlineStyle === 'none'));
 await page.keyboard.press('Tab');
 check('keyboard focus indicators on actual controls remain visible', await page.locator('#action').evaluate(el => document.activeElement === el && getComputedStyle(el).outlineStyle !== 'none'));
 await page.keyboard.press('Tab');
 check('composer does not acquire a second outline from the general focus rule', await page.locator('#composer').evaluate(el => document.activeElement === el && getComputedStyle(el).outlineStyle === 'none'));
 await page.locator('#action').blur();
 await page.mouse.click(1300, 850);
 await page.locator('#action').click();
 check('mouse focus is not outlined by inherited VS Code focus rules', await page.locator('#action').evaluate(el => getComputedStyle(el).outlineStyle === 'none'));
 await page.waitForFunction(() => getComputedStyle(document.querySelector('#action')).backgroundColor === 'rgba(255, 255, 255, 0.05)');
 const hover = await page.locator('#action').evaluate(el => ({ background: getComputedStyle(el).backgroundColor, hovered: el.matches(':hover'), transition: getComputedStyle(el).transitionDuration }));
 check('hover lightens the action with the shell action style: ' + JSON.stringify(hover), hover.hovered && hover.background === 'rgba(255, 255, 255, 0.05)');
 check('custom window border is transparent while a Vader page is active', await page.locator('.monaco-workbench').evaluate(el => getComputedStyle(el).getPropertyValue('--window-border-color').trim() === 'transparent'));
 await page.evaluate(() => {
  window.layers.setVaderWindowLayer(document.querySelector('.monaco-workbench'), 'settings', true);
  document.querySelector('#settings').style.display = 'block';
 });
 check('settings opens over the shell without inherited menu bleed', await visible('#settings') && !await visible('#legacy') && await hiddenMenus());
 await page.evaluate(() => {
  window.layers.setVaderWindowLayer(document.querySelector('.monaco-workbench'), 'settings', false);
  document.querySelector('#settings').style.display = 'none';
 });
 check('closing settings preserves the shell layer', await visible('#shell') && !await visible('.part.editor') && await hiddenMenus());
 check('closing settings never exposes explicitly visible editor widgets', !await visible('#editor-visible-child'));
 const shots = path.join(os.tmpdir(), 'vader-runtime-shots'); fs.mkdirSync(shots, { recursive: true });
 await page.screenshot({ path: path.join(shots, 'window-layers.png') });
 console.log('Screenshot (synthetic DOM fixture): ' + path.join(shots, 'window-layers.png'));
 await page.evaluate(() => {
  window.layers.setVaderWindowLayer(document.querySelector('.monaco-workbench'), 'shell', false);
  document.querySelector('#shell').style.display = 'none';
 });
 check('explicit classic mode restores editor, menus and original border', await visible('.part.editor') && await visible('#legacy') && await page.locator('.monaco-workbench').evaluate(el => getComputedStyle(el).getPropertyValue('--window-border-color').trim() === 'blue'));
 check('classic mode restores actual menu buttons, not only their container', await page.locator('#legacy > .menubar-menu-button').evaluateAll(nodes => nodes.some(el => el.style.visibility === 'visible' && getComputedStyle(el).visibility === 'visible')));
 for (const layer of ['onboarding', 'settings']) {
  await page.evaluate(layer => window.layers.setVaderWindowLayer(document.querySelector('.monaco-workbench'), layer, true), layer);
  check(layer + ' alone suppresses real inherited menu buttons', await hiddenMenus());
  await page.locator('#window-control').click({ timeout: 3000 });
  await page.evaluate(layer => window.layers.setVaderWindowLayer(document.querySelector('.monaco-workbench'), layer, false), layer);
 }
 for (const platform of ['mac', 'linux', 'web']) {
  await page.evaluate(platform => {
   const host = document.querySelector('.monaco-workbench');
   host.classList.remove('windows');
   host.classList.add(platform);
   if (platform === 'web') host.classList.add('windows'); // web on Windows must keep its host titlebar
   window.layers.setVaderWindowLayer(host, 'shell', true);
  }, platform);
  check(platform + ' titlebar visibility is preserved', await visible('.part.titlebar') === (platform !== 'mac'));
  check(platform + ' retains the expected menu visibility', await hiddenMenus() === (platform === 'mac'));
  await page.evaluate(platform => {
   const host = document.querySelector('.monaco-workbench');
   window.layers.setVaderWindowLayer(host, 'shell', false);
   host.classList.remove(platform); host.classList.add('windows');
  }, platform);
 }
 check('no browser runtime errors', errors.length === 0);
 await page.addScriptTag({ content: contribution.outputFiles[0].text });
 check('shell registers before editor restoration', await page.evaluate(() => window.__registeredPhase === 'BlockRestore'));
 const failedMount = await page.evaluate(() => {
  const workbench = document.querySelector('.monaco-workbench');
  workbench.remove();
  document.body.classList.add('vader-window-starting');
  window.__mountFails = 1;
  const shellChanges = [], layouts = [];
  const event = list => listener => { list.push(listener); return { dispose() { list.splice(list.indexOf(listener), 1); } }; };
  const shell = { state: { mode: 'window' }, onDidChange: event(shellChanges) };
  window.__shellHost = shell;
  window.__shellChanges = shellChanges;
  window.__layouts = layouts;
  window.__contribution = new window.contribution.VaderShellContribution(
   { invokeFunction: fn => fn({}) }, shell, { key: { set() {} } }, { onDidLayoutMainContainer: event(layouts) });
  const deferredUntilLayout = !document.querySelector('[data-testid="vader-shell-overlay"]');
  document.body.append(workbench);
  let error;
  try { layouts[0](); } catch (e) { error = e.message; }
  return { deferredUntilLayout, error, roots: workbench.querySelectorAll('[data-testid="vader-shell-overlay"]').length,
   masked: document.body.classList.contains('vader-window-starting') || workbench.classList.contains('vader-window-layer') };
 });
 check('contribution tolerates construction before workbench DOM exists', failedMount.deferredUntilLayout);
 check('mount failure propagates and removes partial DOM while preserving modern screen ownership', failedMount.error === 'controlled mount failure' && failedMount.roots === 0 && failedMount.masked);
 check('failed mount retains the shell layer even after the bootstrap mask is removed', await page.evaluate(() => { document.body.classList.remove('vader-window-starting'); return document.querySelector('.monaco-workbench').classList.contains('vader-window-shell'); }));
 check('mount failure never falls back to classic editor or menu descendants', !await visible('#editor-visible-child') && await hiddenMenus());
 await page.evaluate(() => window.__layouts[0]());
 check('next layout retries the actual mount successfully', await visible('[data-testid="vader-shell-overlay"]') && await page.evaluate(() => window.__mounts === 2));
 await page.evaluate(() => window.__layouts[0]());
 check('later layouts reuse the mounted shell', await page.evaluate(() => window.__mounts === 2));
 await page.evaluate(() => { window.__shellHost.state.mode = 'editor'; window.__shellChanges[0](); });
 check('actual contribution returns to classic mode only when explicitly requested', !await visible('[data-testid="vader-shell-overlay"]') && await visible('.part.editor'));
 await page.evaluate(() => window.__contribution.dispose());
 check('contribution disposal unmounts the shell and removes its layer', await page.locator('[data-testid="vader-shell-overlay"]').count() === 0 && await page.evaluate(() => window.__unmounts === 1 && !document.querySelector('.monaco-workbench').classList.contains('vader-window-layer')));
 await page.addScriptTag({ content: settingsBundle.outputFiles[0].text });
 const paneResult = await page.evaluate(() => {
  const host = document.querySelector('.monaco-workbench');
  window.layers.setVaderWindowLayer(host, 'shell', true);
  window.__settingsMountFails = 1;
  window.__settingsPane = new window.settingsPane.VaderSettingsOverlay({ invokeFunction: fn => fn({}) });
  let failure;
  try { window.__settingsPane.open(); } catch(e) { failure = e.message; }
  return { failure, roots: host.querySelectorAll('[data-testid="vader-settings-overlay"]').length };
 });
 check('Settings mount failure removes partial DOM and can be retried', paneResult.failure === 'controlled settings failure' && paneResult.roots === 0);
 await page.evaluate(() => {
  const onboarding = document.createElement('div'); onboarding.className = 'vader-onboarding-container'; onboarding.id = 'first-run';
  const input = document.createElement('input'); input.value = 'preserved setup draft'; onboarding.append(input);
  document.querySelector('.monaco-workbench').append(onboarding);
 });
 await page.evaluate(() => window.__settingsPane.open('agents'));
 check('Settings opens the requested page on retry', await visible('[data-testid="vader-settings-overlay"]') && await page.evaluate(() => window.vaderSettingsPendingPage === 'agents'));
 check('Settings takes precedence over unfinished onboarding', !await visible('#first-run'));
 await page.evaluate(() => window.__settingsPane.close());
 check('actual Settings close preserves the shell mask without exposing legacy parts', !await visible('.part.editor') && !await visible('#legacy') && await page.evaluate(() => document.querySelector('.monaco-workbench').classList.contains('vader-window-shell')));
 check('closing Settings restores the same onboarding draft', await visible('#first-run') && await page.locator('#first-run input').inputValue() === 'preserved setup draft');
 const frames = await page.evaluate(async () => {
  let leaked = 0;
  for (let i = 0; i < 36; i++) {
   window.__settingsPane.open();
   window.__menubar.update();
   await new Promise(requestAnimationFrame);
   const nodes = [...document.querySelectorAll('.part.editor, .part.editor *, .part.titlebar .menubar *')];
   if (nodes.some(el => getComputedStyle(el).visibility === 'visible' && el.getBoundingClientRect().width > 0)) leaked++;
   window.__settingsPane.close();
   await new Promise(requestAnimationFrame);
   if (nodes.some(el => getComputedStyle(el).visibility === 'visible' && el.getBoundingClientRect().width > 0)) leaked++;
  }
  return { samples: 72, leaked };
 });
 check('frame sampling across Settings transitions and upstream menu relayout finds zero classic frames', frames.samples === 72 && frames.leaked === 0);
 await page.evaluate(() => { window.__settingsPane.open(); window.__settingsPane.dispose(); window.__menubar.dispose(); });
 check('Settings disposal unmounts its root and releases only its own layer', await page.locator('[data-testid="vader-settings-overlay"]').count() === 0 && await page.evaluate(() => window.__settingsUnmounts === 1 && document.querySelector('.monaco-workbench').classList.contains('vader-window-shell')));
 // Run bootstrap in separate fresh documents so saved layouts and mode flags
 // cannot accidentally inherit a passing state from the mounted shell above.
 for (const windowFirst of [true, false]) {
  const boot = await browser.newPage();
  await boot.setContent('<!doctype html><html><head></head><body></body></html>');
  await boot.addScriptTag({ content: bootstrap.code });
  const result = await boot.evaluate(windowFirst => {
   const partsSplash = { baseTheme: 'vs-dark', colorInfo: { editorBackground: '#19191c', foreground: '#ededee' }, layoutInfo: { titleBarHeight: 35, activityBarWidth: 48, sideBarWidth: 240, sideBarSide: 'left', statusBarHeight: 22, windowBorder: false } };
   window.__showVaderSplash({ vaderWindowFirst: windowFirst, partsSplash, colorScheme: { dark: true, highContrast: false } });
   return { mask: document.body.classList.contains('vader-window-starting'), skeleton: !!document.getElementById('monaco-parts-splash'), originalLayoutPreserved: !!partsSplash.layoutInfo };
  }, windowFirst);
  check(windowFirst ? 'actual bootstrap never restores classic splash geometry in window mode' : 'explicit editor mode still restores its saved splash geometry', result.mask === windowFirst && result.skeleton !== windowFirst && result.originalLayoutPreserved);
  await boot.close();
 }
} finally { await browser.close(); }
console.log(`${passed} passed, 0 failed`);
