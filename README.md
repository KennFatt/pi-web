# Pi Local Websearch

Pi extension package that adds bounded web search and page extraction tools using local system CLIs.

- `web_search` searches with a selectable provider: [`ddgr`](https://github.com/jarun/ddgr) by default, the [DeepSeek Search API](https://api-docs.deepseek.com/guides/search/), or Google Gemini Search Grounding on whitelisted `*gemini*` models.
- `web_fetch` wraps the [`web-fetch`](https://github.com/kennanfattahillah/core) shell command, which internally orchestrates trafilatura, shot-scraper, and curl with caching.

## Status

Implemented:

- `web_search` tool with three backends: `ddgr --json` (default), the DeepSeek Search API, and Gemini Search Grounding (automatic on whitelisted `*gemini*` models)
- provider selection through `PI_WEB_SEARCH_PROVIDER`, the active model, and `pi-web.json`, with ddgr as the default
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

The DeepSeek provider needs `DEEPSEEK_API_KEY` instead; the Gemini backend uses the active model's Pi credentials and needs no extra setup. See [Search providers](#search-providers).

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

`web_search` uses `ddgr` unless you select the DeepSeek Search API or run a whitelisted `*gemini*` model. Selection is extension-owned configuration, not a Pi setting. Precedence, highest first:

| Source | Value |
|---|---|
| `PI_WEB_SEARCH_PROVIDER` | `ddgr` or `deepseek`; overrides everything |
| active model | `gemini` when the model matches the Gemini whitelist below |
| `~/.pi/agent/pi-web.json` | `{"searchProvider": "deepseek", "notifyAfterEmptyResults": 3}` |
| default | `ddgr` |

When `PI_WEB_SEARCH_PROVIDER` is unset and a whitelisted `*gemini*` model is active, Gemini wins over `pi-web.json` (for example, a `deepseek` file value is bypassed); any other model keeps the file/default routing.

`~/.pi/agent/pi-web.json` is read on every search, so an edit applies to the next call without restarting Pi. Malformed JSON or an unknown value fails the tool call with an error naming the file rather than silently falling back.

The DeepSeek provider reads its credential from `DEEPSEEK_API_KEY` and always calls `https://api.deepseek.com/v1/tools/search`; there is no endpoint setting. Searches are billed per successful request (see the DeepSeek guide), which is why `ddgr` stays the default.

#### Gemini Search Grounding (automatic)

On a whitelisted `*gemini*` model, `web_search` calls Google's `generateContent` with Search Grounding and returns the synthesized answer with inline `[1]` citations above the ranked source list. The whitelist requires both: the model ID contains `gemini` (case-insensitive) and the provider/API is `google-oauth-v2` (`google-code-assist`) or `google` (`google-generative-ai`). Third-party `*gemini*` proxies (`openrouter`, `github-copilot`, `vercel-ai-gateway`, `opencode`, `radius`) and `google-vertex` ADC are not supported.

Credentials come from the active model's Pi auth (`ctx.modelRegistry.getApiKeyAndHeaders`): run `/login` for `google-oauth-v2`, or set `GEMINI_API_KEY` for `google`. There is no new env var or config key. The search model is pinned to `gemini-3.8-flash-low` on Code Assist and `gemini-3.8-flash` on the Gemini Developer API with `LOW` thinking, rather than using the active model ID. Source URLs are kept as returned (often `vertexaisearch.cloud.google.com/...` redirects); use `web_fetch` to follow them. On the Gemini Developer API Paid Tier, Search Grounding includes 5,000 free search requests/month across Gemini 3+ models, then $14 per 1,000 search queries plus token rates; it is unavailable on the Free Tier for Gemini 3+ models. If Gemini answers without searching, `groundingChunks` is empty and the call counts as an empty result with a Gemini-specific notice.

### Empty-result advice

`notifyAfterEmptyResults` (default `3`, `0` disables) counts consecutive searches that produced nothing usable, including provider failures such as a ddgr rate limit. When the threshold is crossed, the tool result and a TUI warning tell you to consider another provider or a rephrased query. Nothing switches automatically, and a successful non-empty search resets the count.

### Parameter interoperability

All three backends accept the same tool parameters; DeepSeek translates what it can, and Gemini ignores unsupported filters.

| Parameter | ddgr | DeepSeek | Gemini |
|---|---|---|---|
| `query` | positional argument | `query`, including `site:`/`lang:`/`after:`/`before:` operators | `contents` text |
| `maxResults` | `-n` | `count` | sliced client-side to `maxResults` |
| `site` | `-w <domain>` | `site:<domain>` appended to the query | unsupported, ignored |
| `timeRange` | `-t d/w/m/y` | `after:<date>` with a rolling window of 1/7/30/365 days | unsupported, ignored |
| `region` | `-r <region>`, default `us-en` | `lang:<code>` derived from the region suffix, for example `us-en` -> `lang:en` | unsupported, ignored |
| `safeSearch` | `--unsafe` when false | unsupported, ignored | unsupported, ignored |
| `timeoutMs` | subprocess timeout | HTTP request timeout | HTTP request timeout (shared 10s default, 30s max) |

## Usage

After installation, Pi exposes two tools.

### `web_search`

Search the web with the configured provider and return compact ranked results.

| Parameter | Default | Max | Description |
|---|---|---|---|
| `query` | (required) | — | Search query. Leading `!` bang queries are rejected |
| `maxResults` | 8 | 25 | Number of results |
| `site` | — | — | Domain restriction, e.g. `github.com`; ignored by Gemini |
| `region` | `us-en` (ddgr) | — | ddgr region code; DeepSeek derives `lang:` from it; ignored by Gemini |
| `timeRange` | — | — | `d`/`w`/`m`/`y`; ignored by Gemini |
| `safeSearch` | `true` | — | ddgr safe search toggle; ignored by DeepSeek and Gemini |
| `timeoutMs` | 10000 | 30000 | ddgr subprocess, DeepSeek HTTP request, or Gemini HTTP request timeout |

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
