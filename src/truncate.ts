import { formatSize, truncateHead } from '@earendil-works/pi-coding-agent';

export function boundedExcerpt(value: string, maxBytes = 2_000): string {
  const truncation = truncateHead(value, {
    maxBytes,
    maxLines: 40,
  });
  return truncation.truncated
    ? `${truncation.content}\n[excerpt truncated: ${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}]`
    : truncation.content;
}
