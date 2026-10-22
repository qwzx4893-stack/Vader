#!/usr/bin/env node
// Controlled Chromium DOM integration, not Electron/native-window verification.
// Uses production layer helper + production chrome CSS and upstream titlebar CSS.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');
const esbuild = require('esbuild');
const here = path.dirname(fileURLToPath(import.meta.url));
const vader = path.resolve(here, '..');
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
 .part.titlebar{height:35px}.part.editor{position:absolute;inset:35px 0 0;background:#202024}
 .vader-shell-overlay{padding:0 24px;box-sizing:border-box}
 .vader-settings-overlay{position:fixed;inset:0;z-index:800;background:#121214;padding:20px}
 .vader-shell-overlay:focus,.vader-settings-overlay:focus{outline:2px solid blue}
 button:focus-visible{outline:2px solid #6ea0ff}button{color:inherit;background:#202024;border:1px solid #555;padding:5px 12px}
 </style><body class="vader-window-starting"><div class="monaco-workbench windows">
 <div class="part titlebar"><div class="titlebar-container"><div class="titlebar-left"><div class="menubar"><button id="legacy">File Edit Selection View</button></div></div>
 <div class="window-controls-container"><button id="window-control" class="window-icon">×</button></div></div></div>
 <div class="part editor">Classic editor</div>
 <div id="shell" class="vader-shell-overlay vader-shell" tabindex="-1" style="display:none;top:0"><p>Vader — controlled window-layer fixture</p><button id="action" class="vader-tx">New chat</button><textarea data-testid="vader-input" id="composer" aria-label="Composer focus fixture"></textarea></div>
 <div id="settings" class="vader-settings-overlay" tabindex="-1" style="display:none">Settings <button>Back to chat</button></div>
 </div></body>`);
 await page.addStyleTag({ content: fs.readFileSync(path.resolve(vader, '../../browser/parts/titlebar/media/titlebarpart.css'), 'utf8') });
 await page.addStyleTag({ content: fs.readFileSync(path.join(vader, 'browser/media/vader.css'), 'utf8') });
 await page.addStyleTag({ content: fs.readFileSync(path.resolve(vader, '../../browser/media/style.css'), 'utf8') });
 await page.addStyleTag({ content: fs.readFileSync(path.join(vader, 'browser/react/src/vader-shell-tsx/shell.css'), 'utf8') });
 await page.addScriptTag({ content: bundle.outputFiles[0].text });
 const visible = selector => page.locator(selector).isVisible();
 check('fixture has expected identity and meaningful content', await page.title() === 'Vader window layers regression' && await page.locator('#shell').textContent());
 check('bootstrap hides classic editor and inherited menus', !await visible('.part.editor') && !await visible('#legacy'));
 check('bootstrap window border is transparent before shell mount', await page.locator('.monaco-workbench').evaluate(el => getComputedStyle(el).getPropertyValue('--window-border-color').trim() === 'transparent'));
 await page.evaluate(() => {
  window.layers.setVaderWindowLayer(document.querySelector('.monaco-workbench'), 'shell', true);
  document.querySelector('#shell').style.display = 'flex';
  document.body.classList.remove('vader-window-starting');
  document.querySelector('#window-control').onclick = () => window.controlClicks = (window.controlClicks ?? 0) + 1;
 });
 check('shell stays visible after bootstrap is released, classic parts hidden', await visible('#shell') && !await visible('#legacy') && !await visible('.part.editor'));
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
 check('settings opens over the shell without inherited menu bleed', await visible('#settings') && !await visible('#legacy'));
 await page.evaluate(() => {
  window.layers.setVaderWindowLayer(document.querySelector('.monaco-workbench'), 'settings', false);
  document.querySelector('#settings').style.display = 'none';
 });
 check('closing settings preserves the shell layer', await visible('#shell') && !await visible('.part.editor'));
 const shots = path.join(os.tmpdir(), 'vader-runtime-shots'); fs.mkdirSync(shots, { recursive: true });
 await page.screenshot({ path: path.join(shots, 'window-layers.png') });
 console.log('Screenshot (synthetic DOM fixture): ' + path.join(shots, 'window-layers.png'));
 await page.evaluate(() => {
  window.layers.setVaderWindowLayer(document.querySelector('.monaco-workbench'), 'shell', false);
  document.querySelector('#shell').style.display = 'none';
 });
 check('explicit classic mode restores editor, menus and original border', await visible('.part.editor') && await visible('#legacy') && await page.locator('.monaco-workbench').evaluate(el => getComputedStyle(el).getPropertyValue('--window-border-color').trim() === 'blue'));
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
 check('mount failure propagates, removes partial DOM and releases bootstrap mask', failedMount.error === 'controlled mount failure' && failedMount.roots === 0 && !failedMount.masked);
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
 await page.evaluate(() => { window.__settingsPane.open(); window.__settingsPane.dispose(); });
 check('Settings disposal unmounts its root and releases only its own layer', await page.locator('[data-testid="vader-settings-overlay"]').count() === 0 && await page.evaluate(() => window.__settingsUnmounts === 1 && document.querySelector('.monaco-workbench').classList.contains('vader-window-shell')));
} finally { await browser.close(); }
console.log(`${passed} passed, 0 failed`);
