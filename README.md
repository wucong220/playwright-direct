# playwright-direct

Drive your **already-signed-in** Chrome or Edge from **Playwright over CDP**, through a companion browser extension.

No `--remote-debugging-port`, no relaunching the browser, no re-login.

## Why

Chrome 136+ ignores `--remote-debugging-port` when it is paired with the default
user-data directory, so the usual "attach to my real browser" trick stopped
working. This plugin exposes a CDP endpoint from inside the browser instead,
using a companion extension that holds the `debugger` permission.

## How it works

```
Playwright  --connectOverCDP-->  ws://127.0.0.1:43187/cdp/direct
                                        |
                                   playwright-direct host
                                        |
                                  companion extension
                                        |
                            chrome.debugger on the real tab
```

## Install

```powershell
dsh plugin --profile web add github:wucong220/playwright-direct
```

Then load the companion extension once:

1. Open `chrome://extensions` in the browser you want to drive.
2. Enable **Developer mode**.
3. **Load unpacked** and pick `extension/` from this package
   (usually under `~/.dsh/profiles/web/node_modules/playwright-direct/extension`).
4. Open `http://127.0.0.1:43187/setup` and approve the four-digit pairing code.

Restart DSH after the plugin is installed.

## Use it from Playwright

```js
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';

const token = JSON.parse(
  readFileSync(process.env.USERPROFILE + '\\.dsh\\browser-tabs\\pairing.json', 'utf8')
).token;

const browser = await chromium.connectOverCDP('ws://127.0.0.1:43187/cdp/direct', {
  headers: { Authorization: `Bearer ${token}` }
});

const page = browser.contexts()[0].pages()[0];
console.log(await page.title());
console.log(await page.evaluate(() => document.body.innerText));
await page.click('text=Submit');
await page.screenshot({ fullPage: true });
```

`/cdp/direct` follows the current tab. To target a specific one, connect to
`ws://127.0.0.1:43187/cdp/tab/<tabId>`.

## Endpoints

| Endpoint | Purpose |
|---|---|
| `ws://127.0.0.1:43187/cdp/direct` | CDP WebSocket for the current tab |
| `ws://127.0.0.1:43187/cdp/tab/<tabId>` | CDP WebSocket for one tab |
| `GET /cdp/info` | List ready CDP paths |
| `GET /tabs` | List tabs the extension reports |
| `POST /cdp/api` | Run a single CDP command |

All of them require `Authorization: Bearer <token>`, read from
`~/.dsh/browser-tabs/pairing.json` (also returned by `/cdp/info`).

## Configuration

Set in your profile's `cordis.patch.yml`:

```yaml
- id: browser-tabs
  name: playwright-direct
  config:
    port: 43187
    exposeCdp: true
    cdpAuthRequired: false
    allowedTools:
      - browser_open
```

| Key | Default | Meaning |
|---|---|---|
| `port` | `43187` | Local bridge port |
| `exposeCdp` | `false` | Enable the raw CDP endpoints |
| `cdpAuthRequired` | `true` | Require the tab to be `@`-authorized first |
| `allowedTools` | all | Register only these DSH tools |

## Differences from upstream

This is a fork of [dsh-doyourweb](https://github.com/SheepofSheep/dsh-doyourweb)
with the CDP bridging rebuilt so an external Playwright client can attach:

- `Schema.getDomains` and `Target.getBrowserContexts` are answered locally
  (Chrome rejects them on a page-level debugger session, which aborted
  Playwright's `connectOverCDP` handshake).
- `Target.attachToTarget` now emits `Target.attachedToTarget`, which is what
  Playwright uses to materialise a `Page`.
- The internal Playwright self-connection was removed, so the relay is driven
  directly by the external client instead of competing with it.
- External and internal CDP sessions can coexist; an external disconnect no
  longer tears the relay down.
- New `GET /cdp/info`, `GET /tabs` and on-demand relay creation, so a tab can be
  attached without any DSH tool touching it first.
- `crypto.randomUUID` falls back when the UI is served over plain HTTP on a LAN
  address (insecure context), which previously made the whole client entry fail
  to activate.
- `browser_act` gained `upload` (file inputs), `offset`-based pagination on
  `extract`, an unbounded row cap, a `getText` action, and `press` without a ref.
- `exposeCdp` / `cdpAuthRequired` / `allowedTools` are configurable.

## License

MIT. The extension and the bridge derive from dsh-doyourweb; see `LICENSE`.
