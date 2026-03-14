/**
 * tracking/utils/ipExtractor.js
 *
 * Proxy-aware IP address extraction.
 * Checks headers in priority order: Cloudflare → real-ip header → x-forwarded-for → socket.
 *
 * Supports:
 *   - Cloudflare (CF-Connecting-IP)
 *   - Nginx proxy_pass (X-Real-IP)
 *   - Standard proxies (X-Forwarded-For)
 *   - Direct socket connection (req.socket.remoteAddress)
 *
 * Always returns a clean IPv4 string (IPv4-mapped IPv6 is unwrapped).
 * Returns '127.0.0.1' for loopback and 'unknown' only as a last resort.
 */

/** IPv4-mapped IPv6 prefix */
const IPV4_MAPPED_RE = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/;

/**
 * Normalize a single IP string:
 *  - Unwrap IPv4-mapped IPv6 (::ffff:1.2.3.4 → 1.2.3.4)
 *  - Map IPv6 loopback to 127.0.0.1
 *  - Strip port if present (some proxies append it)
 * @param {string} raw
 * @returns {string}
 */
function normalizeIP(raw) {
  if (!raw || typeof raw !== 'string') return 'unknown';

  const trimmed = raw.trim();

  if (trimmed === '::1') return '127.0.0.1';

  const mapped = trimmed.match(IPV4_MAPPED_RE);
  if (mapped) return mapped[1];

  // Strip port from IPv4 addresses (e.g. "1.2.3.4:12345")
  const withPort = trimmed.match(/^(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}):\d+$/);
  if (withPort) return withPort[1];

  return trimmed || 'unknown';
}

/**
 * Extract the real client IP from an Express request object.
 *
 * Priority:
 *  1. CF-Connecting-IP  (Cloudflare sets this, always a single real client IP)
 *  2. X-Real-IP         (Nginx, set manually by ops)
 *  3. X-Forwarded-For   (first entry is the original client in a well-configured proxy chain)
 *  4. req.ip            (Express with `trust proxy` set — handles most cases automatically)
 *  5. req.socket.remoteAddress (raw TCP layer fallback)
 *
 * @param {import('express').Request} req
 * @returns {string}  Normalized IPv4 string
 */
function extractIP(req) {
  // 1. Cloudflare
  const cf = req.headers['cf-connecting-ip'];
  if (cf) return normalizeIP(cf.split(',')[0]);

  // 2. Nginx real-ip
  const realIP = req.headers['x-real-ip'];
  if (realIP) return normalizeIP(realIP.split(',')[0]);

  // 3. X-Forwarded-For — first IP in the comma-separated list
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    const first = forwarded.split(',')[0];
    return normalizeIP(first);
  }

  // 4. Express req.ip (respects trust proxy settings)
  if (req.ip) return normalizeIP(req.ip);

  // 5. Raw socket
  const socket = req.socket?.remoteAddress || req.connection?.remoteAddress;
  return normalizeIP(socket);
}

module.exports = { extractIP, normalizeIP };
