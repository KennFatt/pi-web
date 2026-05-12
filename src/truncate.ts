import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_MAX_LINES, formatSize, truncateHead } from "@earendil-works/pi-coding-agent";
import type { TruncationResult } from "@earendil-works/pi-coding-agent";
import type { FetchArtifacts } from "./types.ts";

export interface ModelCapResult {
  content: string;
  truncated: boolean;
  truncation?: TruncationResult;
}

export function boundedExcerpt(value: string, maxBytes = 2_000): string {
  const truncation = truncateHead(value, {
    maxBytes,
    maxLines: 40,
  });
  return truncation.truncated
    ? `${truncation.content}\n[excerpt truncated: ${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}]`
    : truncation.content;
}

export function applyModelVisibleCap(text: string, maxBytes: number): ModelCapResult {
  const truncation = truncateHead(text, {
    maxBytes,
    maxLines: DEFAULT_MAX_LINES,
  });

  if (!truncation.truncated) {
    return { content: truncation.content, truncated: false };
  }

  const omittedLines = truncation.totalLines - truncation.outputLines;
  const omittedBytes = truncation.totalBytes - truncation.outputBytes;
  const notice = [
    "",
    `[Output capped for model context: showing ${truncation.outputLines} of ${truncation.totalLines} lines`,
    `(${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}).`,
    `${omittedLines} lines (${formatSize(omittedBytes)}) omitted from the model-visible response.`,
    "Full XML/text paths are available in tool details.]",
  ].join(" ");

  return {
    content: `${truncation.content}\n${notice}`,
    truncated: true,
    truncation,
  };
}

export async function saveFetchArtifacts(xml: string, text: string): Promise<FetchArtifacts> {
  const tempDir = await mkdtemp(join(tmpdir(), "pi-web-"));
  const fullXmlPath = join(tempDir, "document.xml");
  const fullTextPath = join(tempDir, "document.txt");
  await Promise.all([
    writeFile(fullXmlPath, xml, "utf8"),
    writeFile(fullTextPath, text, "utf8"),
  ]);
  return { tempDir, fullXmlPath, fullTextPath };
}
