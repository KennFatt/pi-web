import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import {
  DEFAULT_FETCH_MAX_LINES,
  DEFAULT_FETCH_RENDER_WAIT_MS,
  DEFAULT_FETCH_TIMEOUT_MS,
  MAX_FETCH_RENDER_WAIT_MS,
  MAX_FETCH_TIMEOUT_MS,
  WEB_FETCH_PROBE_TIMEOUT_MS,
  type ToolRunResult,
  type WebFetchDetails,
  type WebFetchInput,
} from './types.ts';
import { validateFetchUrl } from './safety.ts';
import { boundedExcerpt } from './truncate.ts';

interface NormalizedFetchInput {
  url: string;
  timeoutMs: number;
  maxLines: number;
  renderWaitMs: number;
  xml: boolean;
}

function normalizeInteger(value: unknown, fallback: number, max: number, name: string): number {
  if (value === undefined || value === null) return fallback;
  if (!Number.isInteger(value) || Number(value) < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  if (Number(value) > max) {
    throw new Error(`${name} must be <= ${max}`);
  }
  return Number(value);
}

export function normalizeFetchInput(input: WebFetchInput): NormalizedFetchInput {
  if (!input || typeof input !== 'object') throw new Error('web_fetch input must be an object');
  if (typeof input.url !== 'string' || !input.url.trim()) throw new Error('url must be a non-empty string');

  return {
    url: input.url.trim(),
    timeoutMs: normalizeInteger(input.timeoutMs, DEFAULT_FETCH_TIMEOUT_MS, MAX_FETCH_TIMEOUT_MS, 'timeoutMs'),
    maxLines: normalizeInteger(input.maxLines, DEFAULT_FETCH_MAX_LINES, Number.MAX_SAFE_INTEGER, 'maxLines'),
    renderWaitMs: normalizeInteger(
      input.renderWaitMs,
      DEFAULT_FETCH_RENDER_WAIT_MS,
      MAX_FETCH_RENDER_WAIT_MS,
      'renderWaitMs',
    ),
    xml: input.xml ?? false,
  };
}

function getUserShell(): string {
  return process.env.SHELL || '/bin/bash';
}

function shellQuote(arg: string): string {
  if (!arg) return "''";
  return `'${arg.replace(/'/g, "'\\''")}'`;
}

const availabilityByApi = new WeakMap<Pick<ExtensionAPI, 'exec'>, Promise<void>>();

async function probeWebFetch(pi: Pick<ExtensionAPI, 'exec'>, signal?: AbortSignal): Promise<void> {
  const shell = getUserShell();
  const result = await pi.exec(shell, ['-i', '-c', 'type web-fetch >/dev/null 2>&1'], {
    signal,
    timeout: WEB_FETCH_PROBE_TIMEOUT_MS,
  });
  if (result.killed || result.code !== 0) {
    throw new Error(
      'web-fetch is not installed or not available as a shell function. ' +
        'Ensure the web-fetch shell function is defined in your interactive shell configuration.',
    );
  }
}

async function checkWebFetchAvailable(pi: Pick<ExtensionAPI, 'exec'>, signal?: AbortSignal): Promise<void> {
  const cached = availabilityByApi.get(pi);
  if (cached) return cached;

  const availability = probeWebFetch(pi, signal);
  availabilityByApi.set(pi, availability);
  return availability;
}

function buildWebFetchCommand(input: NormalizedFetchInput): string {
  const parts = [
    'web-fetch',
    shellQuote(input.url),
    '--no-glow',
    '--max-lines',
    String(input.maxLines),
    '--wait',
    String(input.renderWaitMs),
  ];
  if (input.xml) {
    parts.push('--xml');
  }
  return parts.join(' ');
}

export function renderFetchContent(url: string, text: string): string {
  return `web_fetch: ${url}\n\n${text}`;
}

export async function runWebFetch(
  pi: Pick<ExtensionAPI, 'exec'>,
  input: WebFetchInput,
  signal?: AbortSignal,
): Promise<ToolRunResult<WebFetchDetails>> {
  const normalized = normalizeFetchInput(input);
  const safeUrl = await validateFetchUrl(normalized.url);
  const safeInput = { ...normalized, url: safeUrl.toString() };

  await checkWebFetchAvailable(pi, signal);

  const shell = getUserShell();
  const command = buildWebFetchCommand(safeInput);
  const result = await pi.exec(shell, ['-i', '-c', command], {
    signal,
    timeout: safeInput.timeoutMs,
  });

  if (result.killed) {
    throw new Error(`web-fetch timed out after ${safeInput.timeoutMs}ms`);
  }

  if (result.code !== 0) {
    throw new Error(`web-fetch failed with exit code ${result.code}\nstderr:\n${boundedExcerpt(result.stderr)}`);
  }

  const truncated = result.stdout.includes('[truncated:');

  const details: WebFetchDetails = {
    url: safeInput.url,
    text: result.stdout,
    truncated,
    exitCode: result.code,
    ...(result.stderr.trim() ? { stderr: boundedExcerpt(result.stderr.trim()) } : {}),
  };

  return {
    contentText: renderFetchContent(safeInput.url, result.stdout),
    details,
  };
}
