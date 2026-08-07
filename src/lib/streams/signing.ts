import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * The proxy fetches whatever URL it is handed, so an unsigned one is a request
 * forgery front door: anything reachable from the server, including cloud
 * metadata, would be a query string away. Only URLs this process minted carry a
 * signature, and a submitted link is never one of them until the resolver has
 * accepted it.
 */
const secret =
  process.env.SCRY_STREAM_SECRET?.trim() ||
  randomBytes(32).toString("hex");

function encode(value: string) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function decode(value: string) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function signature(encoded: string) {
  return createHmac("sha256", secret).update(encoded).digest("base64url");
}

export function signUrl(url: string) {
  const encoded = encode(url);
  return `${encoded}.${signature(encoded)}`;
}

export function verifyUrl(token: string): string | null {
  const split = token.lastIndexOf(".");
  if (split <= 0) return null;

  const encoded = token.slice(0, split);
  const provided = Buffer.from(token.slice(split + 1));
  const expected = Buffer.from(signature(encoded));
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return null;

  try {
    const url = decode(encoded);
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? url : null;
  } catch {
    return null;
  }
}

export function proxyPath(url: string) {
  return `/api/hls/${signUrl(url)}`;
}
