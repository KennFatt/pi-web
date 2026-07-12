# Pi Local Websearch

Pi extension package that adds bounded web search and page extraction tools using local system CLIs.

- `web_search` wraps [`ddgr`](https://github.com/jarun/ddgr).
- `web_fetch` wraps the [`web-fetch`](https://github.com/kennanfattahillah/core) shell command, which internally orchestrates trafilatura, shot-scraper, and curl with caching.

## Status

Implemented:

- `web_search` tool using `ddgr --json`
- `web_fetch` tool as a thin proxy to the `web-fetch` shell function
- default USA search region (`us-en`)
- downstream output truncation via `--max-lines` (default 500); full content cached at `~/.cache/web-fetch/<sha>.markdown`
- URL safety checks for fetches: only `http`/`https`, no embedded credentials, blocks localhost/private/link-local/reserved IP targets

## Installation

### Prerequisites

`ddgr` must be on `PATH`:

```bash
ddgr --version
```

The `web-fetch` shell function must be defined in your interactive shell configuration. The Pi tool probes it via `$SHELL -i -c "type web-fetch"`.

Verify it is available:

```bash
$SHELL -i -c "type web-fetch"
```

### Install the package

```bash
pi install npm:pi-local-websearch
```

Or from a local checkout:

```bash
git clone https://github.com/vihu/pi-web.git
cd pi-web
npm install
pi -e .
```

## Usage

After installation, Pi exposes two tools.

### `web_search`

Search the web with `ddgr` and return compact ranked results.

| Parameter | Default | Max | Description |
|---|---|---|---|
| `query` | (required) | — | Search query. Leading `!` bang queries are rejected |
| `maxResults` | 8 | 25 | Number of results |
| `site` | — | — | Domain restriction, e.g. `github.com` |
| `region` | `us-en` | — | DuckDuckGo region code |
| `timeRange` | — | — | `d`/`w`/`m`/`y` |
| `safeSearch` | `true` | — | Safe search toggle |
| `timeoutMs` | 10000 | 30000 | Subprocess timeout |

### `web_fetch`

Fetch and extract readable text from one HTTP(S) URL via the `web-fetch` shell command. Output is truncated to the first N lines by default; full content is cached downstream.

| Parameter | Default | Max | Description |
|---|---|---|---|
| `url` | (required) | — | HTTP(S) URL to fetch |
| `maxLines` | 500 | — | Lines of output; downstream caches full content |
| `timeoutMs` | 30000 | 60000 | Subprocess timeout |
| `renderWaitMs` | 2000 | 10000 | Browser wait before extraction |
| `xml` | `false` | — | Request raw XML instead of markdown |

When output is truncated, the downstream prints a footer like:

```
[truncated: full content at /Users/.../.cache/web-fetch/abc123.markdown]
```

The agent can use the `read` tool on that path to retrieve more content. The TUI summary shows `(truncated)` when this occurs.

## Safety notes

`web_fetch` blocks SSRF-style targets before invoking the shell command: localhost, private networks, link-local addresses, reserved documentation ranges, multicast, and IPv6 local ranges. It also resolves hostnames and rejects DNS results that point at blocked IP ranges.

Pi packages run with full system access. Review package source before installing third-party packages.

## Development

```bash
npm install
npm run typecheck
npm test
pi -e .
```
