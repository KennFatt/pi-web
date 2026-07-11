# Pi Local Websearch

Pi extension package that adds bounded web search and page extraction tools.

`pi-local-websearch` uses local system CLIs instead of hosted API keys:

- `web_search` wraps [`ddgr`](https://github.com/jarun/ddgr).
- `web_fetch` wraps [`trafilatura`](https://github.com/adbar/trafilatura) with XML output and falls back to raw text-like HTTP responses.

## Status

Early MVP.

Implemented now:

- `web_search` tool using `ddgr --json`
- `web_fetch` tool using `trafilatura --xml --with-metadata`, with raw text-like response fallback
- default USA search region (`us-en`)
- model-visible output caps
- full XML artifacts for Trafilatura results and text artifacts for extracted or raw results in `/tmp/pi-web-*` when fetch output is capped
- URL safety checks for fetches: only `http`/`https`, no embedded credentials, blocks localhost/private/link-local/reserved IP targets

## Installation

Install the runtime CLIs first and make sure they are available on the same `PATH` used by Pi:

```bash
ddgr --version
trafilatura --version
```

Install from npm with Pi:

```bash
pi install npm:pi-local-websearch
```

Alternatively, install directly from GitHub:

```bash
pi install git:github.com/vihu/pi-web
```

Then restart Pi, or run `/reload` in an existing session if your Pi version supports extension reloads.

For project-local installation instead of global installation:

```bash
pi install -l npm:pi-local-websearch
```

For local development from a checkout:

```bash
git clone https://github.com/vihu/pi-web.git
cd pi-web
npm install
pi -e .
```

To use a local checkout globally without installing from GitHub, add its absolute path to Pi settings or run:

```bash
pi install /absolute/path/to/pi-web
```

## Usage

After installation, Pi exposes two tools to the agent.

### `web_search`

Search the web with `ddgr` and return compact ranked results.

Important defaults and limits:

- default results: `8`
- max results: `25`
- default region: `us-en` (USA)
- default safe search: enabled
- default timeout: `10000ms`
- DuckDuckGo bang queries beginning with `!` are rejected

Common parameters:

```jsonc
{
  "query": "Pi coding agent packages",
  "maxResults": 8,
  "site": "github.com",
  "region": "us-en",
  "timeRange": "m",
  "safeSearch": true,
  "timeoutMs": 10000,
}
```

### `web_fetch`

Fetch and extract readable text from one HTTP(S) URL with `trafilatura --xml`; raw text-like resources are returned unchanged when extraction is unavailable.

Important defaults and limits:

- default timeout: `20000ms`
- default model-visible cap: `12000`
- max model-visible cap: `50000`
- comments excluded by default
- tables included by default
- if output is capped, full artifacts are written to:
  - `/tmp/pi-web-*/document.xml` for Trafilatura extraction
  - `/tmp/pi-web-*/document.txt` for extracted or raw text

Common parameters:

```jsonc
{
  "url": "https://example.com/article",
  "maxChars": 12000,
  "timeoutMs": 20000,
  "includeComments": false,
  "includeTables": true,
  "includeLinks": false,
  "includeImages": false,
  "fast": false,
}
```

## Safety notes

`pi-local-websearch` is intended for public web access. It does not add a first-use confirmation gate.

`web_fetch` blocks obvious SSRF-style targets before invoking `trafilatura`, including localhost, private networks, link-local addresses, reserved documentation ranges, multicast, and IPv6 local ranges. It also resolves hostnames and rejects DNS results that point at blocked IP ranges.

Pi packages run with full system access. Review package source before installing third-party packages.

## Development

```bash
npm install
npm run typecheck
npm test
pi -e .
```
