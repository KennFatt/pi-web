# pi-web

Pi extension package that adds bounded web search and page extraction tools.

## Tools

- `web_search` wraps the installed `ddgr` CLI.
- `web_fetch` wraps the installed `trafilatura` CLI using XML output.

Runtime requirements must be available on `PATH`:

```bash
ddgr --version
trafilatura --version
```

Defaults:

- Search region: USA (`us-en`)
- Search results: 8, max 25
- Fetch output: model-visible text is capped, full XML/text are saved to `/tmp/pi-web-*` when capped
- Fetch safety: only `http`/`https`, blocks localhost/private/link-local/reserved IP targets
