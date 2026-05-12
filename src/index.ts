import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { runWebFetch } from "./fetch.ts";
import { runWebSearch } from "./search.ts";
import {
  DEFAULT_FETCH_MAX_CHARS,
  DEFAULT_FETCH_TIMEOUT_MS,
  DEFAULT_SEARCH_MAX_RESULTS,
  DEFAULT_SEARCH_REGION,
  DEFAULT_SEARCH_TIMEOUT_MS,
  MAX_FETCH_MAX_CHARS,
  MAX_FETCH_TIMEOUT_MS,
  MAX_SEARCH_RESULTS,
  MAX_SEARCH_TIMEOUT_MS,
  type WebFetchDetails,
  type WebSearchDetails,
} from "./types.ts";

const WebSearchParams = Type.Object({
  query: Type.String({ description: "Search query. Leading DuckDuckGo bang queries (!example) are rejected." }),
  maxResults: Type.Optional(Type.Number({ description: `Maximum results to return (default ${DEFAULT_SEARCH_MAX_RESULTS}, max ${MAX_SEARCH_RESULTS})` })),
  site: Type.Optional(Type.String({ description: "Optional site/domain restriction passed to ddgr -w, e.g. example.com" })),
  region: Type.Optional(Type.String({ description: `DuckDuckGo region code (default ${DEFAULT_SEARCH_REGION} for USA)` })),
  timeRange: Type.Optional(StringEnum(["d", "w", "m", "y"] as const, { description: "Optional time range: d=day, w=week, m=month, y=year" })),
  safeSearch: Type.Optional(Type.Boolean({ description: "Keep safe search enabled unless explicitly false (default true)" })),
  timeoutMs: Type.Optional(Type.Number({ description: `Subprocess timeout in milliseconds (default ${DEFAULT_SEARCH_TIMEOUT_MS}, max ${MAX_SEARCH_TIMEOUT_MS})` })),
}, { additionalProperties: false });

const WebFetchParams = Type.Object({
  url: Type.String({ description: "HTTP(S) URL to fetch and extract with trafilatura" }),
  timeoutMs: Type.Optional(Type.Number({ description: `Subprocess timeout in milliseconds (default ${DEFAULT_FETCH_TIMEOUT_MS}, max ${MAX_FETCH_TIMEOUT_MS})` })),
  maxChars: Type.Optional(Type.Number({ description: `Maximum model-visible text bytes/chars (default ${DEFAULT_FETCH_MAX_CHARS}, max ${MAX_FETCH_MAX_CHARS}); full text/XML are saved to /tmp when capped` })),
  includeComments: Type.Optional(Type.Boolean({ description: "Include extracted comments (default false)" })),
  includeTables: Type.Optional(Type.Boolean({ description: "Include extracted tables (default true)" })),
  includeLinks: Type.Optional(Type.Boolean({ description: "Ask trafilatura to include links in XML output (default false)" })),
  includeImages: Type.Optional(Type.Boolean({ description: "Ask trafilatura to include images in XML output (default false)" })),
  fast: Type.Optional(Type.Boolean({ description: "Use trafilatura --fast extraction mode (default false)" })),
}, { additionalProperties: false });

function summarizeSearch(details: WebSearchDetails | undefined): string {
  if (!details) return "No details";
  if (details.results.length === 0) return "No results";
  const top = details.results.slice(0, 3).map((result) => result.url).join("\n");
  return `${details.results.length} result(s)\n${top}`;
}

function summarizeFetch(details: WebFetchDetails | undefined): string {
  if (!details) return "No details";
  const title = details.title ? `${details.title}\n` : "";
  const cap = details.truncated ? " (capped; full files saved)" : "";
  const host = details.hostname ?? new URL(details.finalUrl ?? details.url).hostname;
  return `${title}${host}${cap}`;
}

export default function piWebExtension(pi: ExtensionAPI) {
  pi.registerTool({
    name: "web_search",
    label: "Web Search",
    description:
      "Search the web with the installed ddgr CLI. Returns compact ranked results. Defaults to USA region (us-en), safe search on, 8 results, and a 10s timeout.",
    promptSnippet: "Search the web via ddgr for current/external information",
    promptGuidelines: [
      "Use web_search when the user asks about current or external information that is not available in the local workspace.",
      "Use web_fetch after web_search when source content, documentation, or article text is needed; do not rely only on snippets for important claims.",
    ],
    parameters: WebSearchParams,
    async execute(_toolCallId, params, signal) {
      const result = await runWebSearch(pi, params, signal);
      return {
        content: [{ type: "text" as const, text: result.contentText }],
        details: result.details,
      };
    },
    renderCall(args, theme, context) {
      const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
      const query = typeof args?.query === "string" ? args.query : "";
      text.setText(`${theme.fg("toolTitle", theme.bold("web_search"))} ${theme.fg("accent", query)}`);
      return text;
    },
    renderResult(result, _options, theme, context) {
      const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
      text.setText(theme.fg("toolOutput", summarizeSearch(result.details as WebSearchDetails | undefined)));
      return text;
    },
  });

  pi.registerTool({
    name: "web_fetch",
    label: "Web Fetch",
    description:
      "Fetch and extract one HTTP(S) URL using installed trafilatura with --xml. Model-visible text is capped; full XML and text are saved to /tmp when capped. Blocks localhost/private/reserved URL targets.",
    promptSnippet: "Fetch and extract readable page text via trafilatura --xml",
    promptGuidelines: [
      "Use web_fetch for specific HTTP(S) sources when the page content is needed, especially documentation, papers, and articles.",
      "web_fetch caps only the model-visible text; if fullTextPath or fullXmlPath is returned, use the read tool on those paths when more source text is needed.",
    ],
    parameters: WebFetchParams,
    async execute(_toolCallId, params, signal) {
      const result = await runWebFetch(pi, params, signal);
      return {
        content: [{ type: "text" as const, text: result.contentText }],
        details: result.details,
      };
    },
    renderCall(args, theme, context) {
      const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
      const url = typeof args?.url === "string" ? args.url : "";
      text.setText(`${theme.fg("toolTitle", theme.bold("web_fetch"))} ${theme.fg("accent", url)}`);
      return text;
    },
    renderResult(result, _options, theme, context) {
      const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
      text.setText(theme.fg("toolOutput", summarizeFetch(result.details as WebFetchDetails | undefined)));
      return text;
    },
  });
}
