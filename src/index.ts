import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { StringEnum } from '@earendil-works/pi-ai';
import { Text } from '@earendil-works/pi-tui';
import { Type } from 'typebox';
import { runWebFetch } from './fetch.ts';
import { DEFAULT_SEARCH_REGION } from './providers/ddgr/types.ts';
import { runWebSearch } from './search.ts';
import { createEmptyStreak } from './search-provider.ts';
import {
  DEFAULT_FETCH_MAX_LINES,
  DEFAULT_FETCH_RENDER_WAIT_MS,
  DEFAULT_FETCH_TIMEOUT_MS,
  DEFAULT_SEARCH_MAX_RESULTS,
  DEFAULT_SEARCH_TIMEOUT_MS,
  MAX_FETCH_RENDER_WAIT_MS,
  MAX_FETCH_TIMEOUT_MS,
  MAX_SEARCH_RESULTS,
  MAX_SEARCH_TIMEOUT_MS,
  type WebFetchDetails,
  type WebSearchDetails,
} from './types.ts';

const WebSearchParams = Type.Object(
  {
    query: Type.String({ description: 'Search query. Leading DuckDuckGo bang queries (!example) are rejected.' }),
    maxResults: Type.Optional(
      Type.Number({
        description: `Maximum results to return (default ${DEFAULT_SEARCH_MAX_RESULTS}, max ${MAX_SEARCH_RESULTS})`,
      }),
    ),
    site: Type.Optional(
      Type.String({ description: 'Optional site/domain restriction, e.g. example.com (ddgr -w, DeepSeek site: operator)' }),
    ),
    region: Type.Optional(
      Type.String({
        description: `Optional region code (ddgr default ${DEFAULT_SEARCH_REGION}; DeepSeek derives a lang: clause from it)`,
      }),
    ),
    timeRange: Type.Optional(
      StringEnum(['d', 'w', 'm', 'y'] as const, {
        description: 'Optional time range: d=day, w=week, m=month, y=year (DeepSeek maps it to after:)',
      }),
    ),
    safeSearch: Type.Optional(
      Type.Boolean({ description: 'Keep safe search enabled unless explicitly false (default true; ddgr only, ignored by DeepSeek)' }),
    ),
    timeoutMs: Type.Optional(
      Type.Number({
        description: `Request timeout in milliseconds (default ${DEFAULT_SEARCH_TIMEOUT_MS}, max ${MAX_SEARCH_TIMEOUT_MS}); bounds the ddgr subprocess or the DeepSeek HTTP request`,
      }),
    ),
  },
  { additionalProperties: false },
);

const WebFetchParams = Type.Object(
  {
    url: Type.Union([Type.String(), Type.Array(Type.String(), { minItems: 1 })], {
      description: 'One HTTP(S) URL or an array of HTTP(S) URLs to fetch via the web-fetch shell command',
    }),
    timeoutMs: Type.Optional(
      Type.Number({
        description: `Subprocess timeout in milliseconds (default ${DEFAULT_FETCH_TIMEOUT_MS}, max ${MAX_FETCH_TIMEOUT_MS})`,
      }),
    ),
    maxLines: Type.Optional(
      Type.Number({
        description: `Maximum lines of output (default ${DEFAULT_FETCH_MAX_LINES}); full content is cached downstream and can be read with the read tool`,
      }),
    ),
    renderWaitMs: Type.Optional(
      Type.Number({
        description: `Additional browser wait in milliseconds (default ${DEFAULT_FETCH_RENDER_WAIT_MS}, max ${MAX_FETCH_RENDER_WAIT_MS})`,
      }),
    ),
    xml: Type.Optional(Type.Boolean({ description: 'Request raw XML output instead of markdown (default false)' })),
  },
  { additionalProperties: false },
);

function summarizeSearch(details: WebSearchDetails | undefined): string {
  if (!details) return 'No details';
  if (details.results.length === 0) return `${details.provider}: no results`;
  const top = details.results
    .slice(0, 3)
    .map((result) => result.url)
    .join('\n');
  return `${details.provider}: ${details.results.length} result(s)\n${top}`;
}

function summarizeFetch(details: WebFetchDetails | undefined): string {
  if (!details) return 'No details';
  const hosts = details.urls.map((url) => new URL(url).hostname);
  const truncated = details.truncated ? ' (truncated)' : '';
  return `web-fetch ${hosts.join(', ')}${truncated}`;
}

export default function piWebExtension(pi: ExtensionAPI) {
  const emptyStreak = createEmptyStreak();
  pi.on('session_start', () => {
    emptyStreak.reset();
  });

  pi.registerTool({
    name: 'web_search',
    label: 'Web Search',
    description:
      'Search the web with the configured provider: the local ddgr CLI by default, or the DeepSeek Search API. Returns compact ranked results. Defaults to USA region (us-en) for ddgr, safe search on, 8 results, and a 10s timeout.',
    promptSnippet: 'Search the web via the configured provider (ddgr by default) for current/external information',
    promptGuidelines: [
      'Use web_search when the user asks about current or external information that is not available in the local workspace.',
      'Use web_fetch after web_search when source content, documentation, or article text is needed; do not rely only on snippets for important claims.',
    ],
    parameters: WebSearchParams,
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const result = await runWebSearch(pi, params, signal, { streak: emptyStreak });
      const notice = result.details.notice;
      if (notice && ctx.hasUI) {
        ctx.ui.notify(notice, 'warning');
      }
      return {
        content: [{ type: 'text' as const, text: result.contentText }],
        details: result.details,
      };
    },
    renderCall(args, theme, context) {
      const text = (context.lastComponent as Text | undefined) ?? new Text('', 0, 0);
      const query = typeof args?.query === 'string' ? args.query : '';
      text.setText(`${theme.fg('toolTitle', theme.bold('web_search'))} ${theme.fg('accent', query)}`);
      return text;
    },
    renderResult(result, _options, theme, context) {
      const text = (context.lastComponent as Text | undefined) ?? new Text('', 0, 0);
      text.setText(theme.fg('toolOutput', summarizeSearch(result.details as WebSearchDetails | undefined)));
      return text;
    },
  });

  pi.registerTool({
    name: 'web_fetch',
    label: 'Web Fetch',
    description:
      'Fetch one or more HTTP(S) URLs with the installed web-fetch shell command. Blocks localhost/private/reserved URL targets.',
    promptSnippet: 'Fetch readable page text via the web-fetch shell command (requires web-fetch to be installed)',
    promptGuidelines: [
      'Use web_fetch for specific HTTP(S) sources when the page content is needed, including documentation, source files, data, papers, and articles.',
      'If the output ends with a "truncated: full content at" message, use the read tool on that cache path to retrieve more or all of the content.',
    ],
    parameters: WebFetchParams,
    async execute(_toolCallId, params, signal) {
      const result = await runWebFetch(pi, params, signal);
      return {
        content: [{ type: 'text' as const, text: result.contentText }],
        details: result.details,
      };
    },
    renderCall(args, theme, context) {
      const text = (context.lastComponent as Text | undefined) ?? new Text('', 0, 0);
      const urls = Array.isArray(args?.url)
        ? args.url.filter((url): url is string => typeof url === 'string')
        : typeof args?.url === 'string'
          ? [args.url]
          : [];
      text.setText(`${theme.fg('toolTitle', theme.bold('web_fetch'))} ${theme.fg('accent', urls.join(', '))}`);
      return text;
    },
    renderResult(result, _options, theme, context) {
      const text = (context.lastComponent as Text | undefined) ?? new Text('', 0, 0);
      text.setText(theme.fg('toolOutput', summarizeFetch(result.details as WebFetchDetails | undefined)));
      return text;
    },
  });
}
