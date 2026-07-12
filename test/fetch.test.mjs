import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeFetchInput, renderFetchContent, runWebFetch } from '../src/fetch.ts';

function isProbeCall(args) {
  return args.some((a) => typeof a === 'string' && a.includes('type web-fetch'));
}

test('normalizeFetchInput sets defaults', () => {
  const normalized = normalizeFetchInput({ url: ' https://example.com ' });
  assert.equal(normalized.url, 'https://example.com');
  assert.equal(normalized.timeoutMs, 30_000);
  assert.equal(normalized.maxLines, 500);
  assert.equal(normalized.renderWaitMs, 2_000);
  assert.equal(normalized.xml, false);
});

test('normalizeFetchInput preserves overrides', () => {
  const normalized = normalizeFetchInput({
    url: 'https://example.com',
    timeoutMs: 10_000,
    maxLines: 100,
    renderWaitMs: 1_000,
    xml: true,
  });
  assert.equal(normalized.url, 'https://example.com');
  assert.equal(normalized.timeoutMs, 10_000);
  assert.equal(normalized.maxLines, 100);
  assert.equal(normalized.renderWaitMs, 1_000);
  assert.equal(normalized.xml, true);
});

test('renderFetchContent formats output', () => {
  const rendered = renderFetchContent('https://example.com/page', 'Hello world');
  assert.match(rendered, /web_fetch: https:\/\/example.com\/page/);
  assert.match(rendered, /Hello world/);
});

test('runWebFetch calls web-fetch via interactive shell and returns details', async () => {
  const calls = [];
  const fakePi = {
    async exec(command, args) {
      calls.push({ command, args });
      if (isProbeCall(args)) {
        return { stdout: '', stderr: '', code: 0, killed: false };
      }
      return { stdout: '# Hello\n\nWorld', stderr: '', code: 0, killed: false };
    },
  };

  const result = await runWebFetch(fakePi, { url: 'https://93.184.216.34/article' });

  assert.equal(calls.length, 2);

  // Probe call
  assert.match(calls[0].command, /\/(bash|zsh)$/);
  assert.ok(calls[0].args.includes('-i'));
  assert.ok(calls[0].args.includes('-c'));
  assert.match(calls[0].args.join(' '), /type web-fetch/);

  // Fetch call
  assert.match(calls[1].command, /\/(bash|zsh)$/);
  const cmd = calls[1].args[calls[1].args.indexOf('-c') + 1];
  assert.match(cmd, /web-fetch/);
  assert.match(cmd, /https:\/\/93\.184\.216\.34\/article/);
  assert.match(cmd, /--no-glow/);
  assert.match(cmd, /--max-lines 500/);
  assert.match(cmd, /--wait 2000/);

  assert.equal(result.details.url, 'https://93.184.216.34/article');
  assert.equal(result.details.exitCode, 0);
  assert.equal(result.details.text, '# Hello\n\nWorld');
  assert.match(result.contentText, /web_fetch:/);
});

test('runWebFetch passes --xml flag', async () => {
  const calls = [];
  const fakePi = {
    async exec(_command, args) {
      calls.push(args);
      if (isProbeCall(args)) {
        return { stdout: '', stderr: '', code: 0, killed: false };
      }
      return { stdout: '<doc><main>content</main></doc>', stderr: '', code: 0, killed: false };
    },
  };

  await runWebFetch(fakePi, { url: 'https://93.184.216.34/article', xml: true });
  const cmd = calls[1][calls[1].indexOf('-c') + 1];
  assert.match(cmd, /--xml/);
});

test('runWebFetch passes --wait flag', async () => {
  const calls = [];
  const fakePi = {
    async exec(_command, args) {
      calls.push(args);
      if (isProbeCall(args)) {
        return { stdout: '', stderr: '', code: 0, killed: false };
      }
      return { stdout: 'content', stderr: '', code: 0, killed: false };
    },
  };

  await runWebFetch(fakePi, { url: 'https://93.184.216.34/article', renderWaitMs: 5_000 });
  const cmd = calls[1][calls[1].indexOf('-c') + 1];
  assert.match(cmd, /--wait 5000/);
});

test('runWebFetch errors when web-fetch is not available', async () => {
  const fakePi = {
    async exec(_command, _args) {
      return { stdout: '', stderr: 'web-fetch not found', code: 1, killed: false };
    },
  };

  await assert.rejects(
    () => runWebFetch(fakePi, { url: 'https://93.184.216.34/article' }),
    /web-fetch is not installed/,
  );
});

test('runWebFetch errors on web-fetch timeout', async () => {
  const fakePi = {
    async exec(_command, args) {
      if (isProbeCall(args)) {
        return { stdout: '', stderr: '', code: 0, killed: false };
      }
      return { stdout: '', stderr: '', code: 0, killed: true };
    },
  };

  await assert.rejects(() => runWebFetch(fakePi, { url: 'https://93.184.216.34/article' }), /timed out/);
});

test('runWebFetch passes stderr when present', async () => {
  const fakePi = {
    async exec(_command, args) {
      if (isProbeCall(args)) {
        return { stdout: '', stderr: '', code: 0, killed: false };
      }
      return { stdout: 'content', stderr: 'some warning', code: 0, killed: false };
    },
  };

  const result = await runWebFetch(fakePi, { url: 'https://93.184.216.34/article' });
  assert.ok(result.details.stderr);
  assert.match(result.details.stderr, /some warning/);
});

test('runWebFetch detects truncated output', async () => {
  const fakePi = {
    async exec(_command, args) {
      if (isProbeCall(args)) {
        return { stdout: '', stderr: '', code: 0, killed: false };
      }
      return {
        stdout: '# Page title\n\nFirst paragraph.\n\n[truncated: full content at /tmp/cache/file.markdown]',
        stderr: '',
        code: 0,
        killed: false,
      };
    },
  };

  const result = await runWebFetch(fakePi, { url: 'https://93.184.216.34/article' });
  assert.equal(result.details.truncated, true);
});

test('runWebFetch does not flag untruncated output', async () => {
  const fakePi = {
    async exec(_command, args) {
      if (isProbeCall(args)) {
        return { stdout: '', stderr: '', code: 0, killed: false };
      }
      return { stdout: 'full content here', stderr: '', code: 0, killed: false };
    },
  };

  const result = await runWebFetch(fakePi, { url: 'https://93.184.216.34/article' });
  assert.equal(result.details.truncated, false);
});
