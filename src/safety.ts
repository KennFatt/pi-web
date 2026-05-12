import { lookup as dnsLookup } from "node:dns/promises";
import net from "node:net";

export interface LookupAddress {
  address: string;
  family: number;
}

export type LookupFunction = (hostname: string) => Promise<LookupAddress[]>;

export interface ValidateFetchUrlOptions {
  resolveDns?: boolean;
  dnsTimeoutMs?: number;
  lookup?: LookupFunction;
}

const DEFAULT_DNS_TIMEOUT_MS = 2_000;
const FORBIDDEN_HOSTNAMES = new Set(["localhost", "localhost.localdomain"]);

function stripIpv6Brackets(hostname: string): string {
  return hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
}

function ipv4ToNumber(ip: string): number | undefined {
  const parts = ip.split(".");
  if (parts.length !== 4) return undefined;
  let value = 0;
  for (const part of parts) {
    if (!/^\d+$/.test(part)) return undefined;
    const octet = Number(part);
    if (!Number.isInteger(octet) || octet < 0 || octet > 255) return undefined;
    value = (value << 8) + octet;
  }
  return value >>> 0;
}

function inCidr(ip: number, base: number, bits: number): boolean {
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (ip & mask) === (base & mask);
}

export function isForbiddenIpv4(address: string): boolean {
  const ip = ipv4ToNumber(address);
  if (ip === undefined) return false;

  const ranges: Array<[string, number]> = [
    ["0.0.0.0", 8],
    ["10.0.0.0", 8],
    ["100.64.0.0", 10],
    ["127.0.0.0", 8],
    ["169.254.0.0", 16],
    ["172.16.0.0", 12],
    ["192.0.0.0", 24],
    ["192.0.2.0", 24],
    ["192.168.0.0", 16],
    ["198.18.0.0", 15],
    ["198.51.100.0", 24],
    ["203.0.113.0", 24],
    ["224.0.0.0", 4],
    ["240.0.0.0", 4],
  ];

  return ranges.some(([base, bits]) => inCidr(ip, ipv4ToNumber(base)!, bits));
}

function firstIpv6Hextet(address: string): number | undefined {
  const first = address.split(":")[0];
  if (!first) return 0;
  const parsed = Number.parseInt(first, 16);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function embeddedMappedIpv4(address: string): string | undefined {
  const lower = address.toLowerCase();
  const marker = "::ffff:";
  if (!lower.startsWith(marker)) return undefined;
  const rest = lower.slice(marker.length);
  return net.isIP(rest) === 4 ? rest : undefined;
}

export function isForbiddenIpv6(address: string): boolean {
  const lower = stripIpv6Brackets(address).toLowerCase();
  const mapped = embeddedMappedIpv4(lower);
  if (mapped) return isForbiddenIpv4(mapped);

  if (lower === "::" || lower === "::1") return true;

  const first = firstIpv6Hextet(lower);
  if (first === undefined) return false;

  // fc00::/7 unique local, fe80::/10 link-local, ff00::/8 multicast.
  if ((first & 0xfe00) === 0xfc00) return true;
  if ((first & 0xffc0) === 0xfe80) return true;
  if ((first & 0xff00) === 0xff00) return true;

  return false;
}

export function isForbiddenIpAddress(address: string): boolean {
  const normalized = stripIpv6Brackets(address);
  const family = net.isIP(normalized);
  if (family === 4) return isForbiddenIpv4(normalized);
  if (family === 6) return isForbiddenIpv6(normalized);
  return false;
}

export function isForbiddenHostname(hostname: string): boolean {
  const host = stripIpv6Brackets(hostname).toLowerCase().replace(/\.$/, "");
  if (!host) return true;
  if (FORBIDDEN_HOSTNAMES.has(host)) return true;
  if (host.endsWith(".localhost")) return true;
  if (net.isIP(host) !== 0) return isForbiddenIpAddress(host);
  return false;
}

async function lookupWithTimeout(
  hostname: string,
  lookup: LookupFunction,
  timeoutMs: number,
): Promise<LookupAddress[]> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      lookup(hostname),
      new Promise<LookupAddress[]>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`DNS lookup timed out after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export async function validateFetchUrl(input: string, options: ValidateFetchUrlOptions = {}): Promise<URL> {
  if (typeof input !== "string" || !input.trim()) throw new Error("url must be a non-empty string");

  let url: URL;
  try {
    url = new URL(input.trim());
  } catch (error) {
    throw new Error(`Invalid URL: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("web_fetch only supports http:// and https:// URLs");
  }

  if (url.username || url.password) {
    throw new Error("web_fetch rejects URLs containing embedded credentials");
  }

  const hostname = url.hostname;
  if (isForbiddenHostname(hostname)) {
    throw new Error(`Blocked unsafe URL host: ${hostname}`);
  }

  const shouldResolve = options.resolveDns ?? true;
  if (!shouldResolve || net.isIP(stripIpv6Brackets(hostname)) !== 0) return url;

  const lookup = options.lookup ?? ((host: string) => dnsLookup(host, { all: true, verbatim: true }));
  const addresses = await lookupWithTimeout(hostname, lookup, options.dnsTimeoutMs ?? DEFAULT_DNS_TIMEOUT_MS);
  if (addresses.length === 0) throw new Error(`DNS lookup returned no addresses for ${hostname}`);

  for (const address of addresses) {
    if (isForbiddenIpAddress(address.address)) {
      throw new Error(`Blocked unsafe URL host ${hostname}: resolved to ${address.address}`);
    }
  }

  return url;
}
