# Network privacy: what Vader contacts, and how that is checked

Vader talks to the network for exactly these reasons: the model provider the user configured (and its "list models" call), the extension
gallery (Open VSX), the public list of Vader releases on GitHub (`api.github.com/repos/qwzx4893-stack/Vader/releases/latest`; only when the user presses
"Check for Updates" or has switched on **Settings > About & Updates > Check for new releases automatically**, which is off by default), and pages the user or the agent opens.
The editor's own update and telemetry endpoints in `product.json` are not configured. The same list is shown to the user in **Settings > Privacy & Network**.
Chromium and Electron ship background services that contact Google on their own; Vader turns them off.

## Electron (main process, workbench windows) - `src/main.ts`
- `--disable-features=...` extended with the optimization-hints, model-download, media-router, autofill, CT-list, translate and feed features.
- `app.on('session-created')` disables the spell checker and points its dictionary download at a dead address (Electron otherwise
  fetches a dictionary from `redirector.gvt1.com` the first time a text field is used).
- Verified with Chromium's net-log: `e2e/scenarios/privacy.mjs` launches the packaged app, idles, and fails on any request to a host
  that is not local.

## The agent's browser (Playwright Chromium) - `electron-main/browserToolMainService.ts`
- `BROWSER_PRIVACY_ARGS`: Google service URLs (accounts, GCM, variations, component updater, autofill server) point at `127.0.0.1:9`;
  `--disable-features` is rebuilt as Playwright's list plus the privacy features. Chromium honours only the last such switch, so the list
  must repeat Playwright's: `test/browserPrivacyArgsE2E.mjs` (CI) fails when Playwright adds a feature the copy lacks.
- Measured with a net-log on Chromium 141: no Google host is contacted at start-up, on page load, or when typing in forms.

### Known residual contacts (cannot be switched off from the command line; each needs a user-profile preference)
| Contact | When | Why it is acceptable |
|---|---|---|
| `dns.google` (DNS-over-HTTPS probe of `www.gstatic.com`) | only when the machine's own DNS resolver is Google Public DNS | Chromium upgrades to DoH with the *same operator* that already answers this machine's DNS; no new party learns anything. |
| `redirector.gvt1.com` (`en-us-10-1.bdic`) | the first time text is typed into a spell-checked field in a page the agent opened | A one-off dictionary download from Google's CDN, no cookies, no identifiers, no page content. |

Closing these two completely needs a seeded Chromium profile (`Local State` / `Preferences`), i.e. launching the agent browser through
`launchPersistentContext` or a self-managed `connectOverCDP` process. That would also make every agent page share one cookie jar (today each
page is its own isolated context), which is a worse trade for an agent that browses untrusted sites, so it is not done.
