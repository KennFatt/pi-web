import test from "node:test";
import assert from "node:assert/strict";
import { isForbiddenHostname, isForbiddenIpAddress, validateFetchUrl } from "../src/safety.ts";

test("validateFetchUrl accepts public https URL without DNS resolution", async () => {
  const url = await validateFetchUrl("https://example.com/a", { resolveDns: false });
  assert.equal(url.toString(), "https://example.com/a");
});

test("validateFetchUrl rejects unsupported schemes", async () => {
  await assert.rejects(() => validateFetchUrl("file:///etc/passwd", { resolveDns: false }), /only supports/);
});

test("validateFetchUrl rejects embedded credentials", async () => {
  await assert.rejects(() => validateFetchUrl("https://user:pass@example.com", { resolveDns: false }), /credentials/);
});

test("validateFetchUrl rejects localhost and local IP addresses", async () => {
  await assert.rejects(() => validateFetchUrl("http://localhost", { resolveDns: false }), /unsafe URL host/);
  await assert.rejects(() => validateFetchUrl("http://127.0.0.1", { resolveDns: false }), /unsafe URL host/);
  await assert.rejects(() => validateFetchUrl("http://[::1]", { resolveDns: false }), /unsafe URL host/);
});

test("validateFetchUrl rejects private and metadata IP addresses", async () => {
  await assert.rejects(() => validateFetchUrl("http://10.0.0.1", { resolveDns: false }), /unsafe URL host/);
  await assert.rejects(() => validateFetchUrl("http://172.16.0.1", { resolveDns: false }), /unsafe URL host/);
  await assert.rejects(() => validateFetchUrl("http://192.168.1.1", { resolveDns: false }), /unsafe URL host/);
  await assert.rejects(() => validateFetchUrl("http://169.254.169.254", { resolveDns: false }), /unsafe URL host/);
});

test("isForbiddenIpAddress covers direct ranges", () => {
  assert.equal(isForbiddenIpAddress("8.8.8.8"), false);
  assert.equal(isForbiddenIpAddress("100.64.0.1"), true);
  assert.equal(isForbiddenIpAddress("fe80::1"), true);
  assert.equal(isForbiddenIpAddress("fc00::1"), true);
});

test("isForbiddenHostname rejects localhost names", () => {
  assert.equal(isForbiddenHostname("localhost"), true);
  assert.equal(isForbiddenHostname("foo.localhost"), true);
  assert.equal(isForbiddenHostname("example.com"), false);
});

test("validateFetchUrl rejects hostnames resolving to private IPs", async () => {
  await assert.rejects(
    () => validateFetchUrl("https://private.example", {
      lookup: async () => [{ address: "192.168.1.10", family: 4 }],
    }),
    /resolved to 192\.168\.1\.10/,
  );
});
