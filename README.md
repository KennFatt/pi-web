# Pi Local Websearch

Pi extension package that adds bounded web search and page extraction tools using local system CLIs.

- `web_search` searches with a selectable provider: [`ddgr`](https://github.com/jarun/ddgr) by default, or the [DeepSeek Search API](https://api-docs.deepseek.com/guides/search/).
- `web_fetch` wraps the [`web-fetch`](https://github.com/kennanfattahillah/core) shell command, which internally orchestrates trafilatura, shot-scraper, and curl with caching.

## Status

Implemented:

- `web_search` tool with two providers: `ddgr --json` (default) and the DeepSeek Search API
- provider selection through `pi-web.json` and `PI_WEB_SEARCH_PROVIDER`, with ddgr as the default
- a warning after repeated searches produce no usable results, so a rate-limited or blocked provider is visible
- `web_fetch` tool as a thin proxy to the `web-fetch` shell function
- default USA search region (`us-en`)
- downstream output truncation via `--max-lines` (default 500); full content cached at `~/.cache/web-fetch/<sha>.markdown`
- URL safety checks for fetches: only `http`/`https`, no embedded credentials, blocks localhost/private/link-local/reserved IP targets

## Installation

### Prerequisites

`ddgr` must be on `PATH` when the `ddgr` provider is selected (the default):

```bash
ddgr --version
```

The DeepSeek provider needs `DEEPSEEK_API_KEY` instead; see [Search providers](#search-providers).

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

## Search providers

`web_search` uses `ddgr` unless you select the DeepSeek Search API. Selection is extension-owned configuration, not a Pi setting, and the environment takes precedence over the file:

| Source | Value |
|---|---|
| `PI_WEB_SEARCH_PROVIDER` | `ddgr` or `deepseek`; overrides the config file |
| `~/.pi/agent/pi-web.json` | `{"searchProvider": "deepseek", "notifyAfterEmptyResults": 3}` |
| default | `ddgr` |

`~/.pi/agent/pi-web.json` is read on every search, so an edit applies to the next call without restarting Pi. Malformed JSON or an unknown value fails the tool call with an error naming the file rather than silently falling back.

The DeepSeek provider reads its credential from `DEEPSEEK_API_KEY` and always calls `https://api.deepseek.com/v1/tools/search`; there is no endpoint setting. Searches are billed per successful request (see the DeepSeek guide), which is why `ddgr` stays the default.

### Empty-result advice

`notifyAfterEmptyResults` (default `3`, `0` disables) counts consecutive searches that produced nothing usable, including provider failures such as a ddgr rate limit. When the threshold is crossed, the tool result and a TUI warning tell you to consider another provider or a rephrased query. Nothing switches automatically, and a successful non-empty search resets the count.

### Parameter interoperability

Both providers accept the same tool parameters; the DeepSeek provider translates what it can.

| Parameter | ddgr | DeepSeek |
|---|---|---|
| `query` | positional argument | `query`, including `site:`/`lang:`/`after:`/`before:` operators |
| `maxResults` | `-n` | `count` |
| `site` | `-w <domain>` | `site:<domain>` appended to the query |
| `timeRange` | `-t d/w/m/y` | `after:<date>` with a rolling window of 1/7/30/365 days |
| `region` | `-r <region>`, default `us-en` | `lang:<code>` derived from the region suffix, for example `us-en` -> `lang:en` |
| `safeSearch` | `--unsafe` when false | unsupported, ignored |
| `timeoutMs` | subprocess timeout | HTTP request timeout |

## Usage

After installation, Pi exposes two tools.

### `web_search`

Search the web with the configured provider and return compact ranked results.

| Parameter | Default | Max | Description |
|---|---|---|---|
| `query` | (required) | — | Search query. Leading `!` bang queries are rejected |
| `maxResults` | 8 | 25 | Number of results |
| `site` | — | — | Domain restriction, e.g. `github.com` |
| `region` | `us-en` (ddgr) | — | ddgr region code; DeepSeek derives `lang:` from it |
| `timeRange` | — | — | `d`/`w`/`m`/`y` |
| `safeSearch` | `true` | — | ddgr safe search toggle; ignored by DeepSeek |
| `timeoutMs` | 10000 | 30000 | ddgr subprocess or DeepSeek HTTP request timeout |

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
