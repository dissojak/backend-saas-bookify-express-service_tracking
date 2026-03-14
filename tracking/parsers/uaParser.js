/**
 * tracking/parsers/uaParser.js
 *
 * Wraps ua-parser-js to produce fully normalized device/browser/OS breakdown.
 * Single source-of-truth for User-Agent parsing across the entire service.
 */

const { UAParser } = require('ua-parser-js');

/**
 * Known bot / automation user-agent patterns.
 * Matched before the full parse so they are classified as deviceType = 'bot'.
 */
const BOT_RE =
  /bot|crawler|spider|slurp|mediapartners|adsbot|facebookexternalhit|whatsapp|baiduspider|yandexbot|curl|python-requests|python-urllib|python\/|go-http-client|java\/|okhttp|axios\/|got\/|node-fetch|scrapy|wget|libwww/i;

/**
 * Parse a raw User-Agent string and return normalized fields.
 *
 * @param {string|null} ua  Raw User-Agent header value
 * @returns {{
 *   userAgent: string,
 *   browser: string,
 *   browserVersion: string,
 *   os: string,
 *   osVersion: string,
 *   deviceType: 'desktop'|'mobile'|'tablet'|'bot',
 *   deviceVendor: string,
 *   deviceModel: string,
 * }}
 */
function parseUserAgent(ua) {
  const raw = (ua || '').trim();

  // Fast-path: empty UA → unknown device
  if (!raw) {
    return _unknown();
  }

  // Classify bots before heavy parsing
  if (BOT_RE.test(raw)) {
    const parser = new UAParser(raw);
    const browser = parser.getBrowser();
    return {
      userAgent: raw,
      browser: browser.name || _extractBotName(raw),
      browserVersion: browser.version || '',
      os: 'Bot/Crawler',
      osVersion: '',
      deviceType: 'bot',
      deviceVendor: '',
      deviceModel: '',
    };
  }

  const parser = new UAParser(raw);
  const uaBrowser = parser.getBrowser();
  const uaOS = parser.getOS();
  const uaDevice = parser.getDevice();

  // ua-parser-js returns undefined for unknown fields — normalise to ''
  const browserName = uaBrowser.name || 'Unknown';
  const browserVersion = uaBrowser.version || '';
  const osName = uaOS.name || 'Unknown';
  const osVersion = uaOS.version || '';

  // ua-parser-js device.type: 'mobile'|'tablet'|'smarttv'|'wearable'|'embedded'|undefined
  let deviceType = 'desktop';
  if (uaDevice.type === 'mobile') deviceType = 'mobile';
  else if (uaDevice.type === 'tablet') deviceType = 'tablet';
  else if (uaDevice.type === 'smarttv' || uaDevice.type === 'wearable' || uaDevice.type === 'embedded')
    deviceType = 'mobile'; // group edge cases as mobile for analytics

  return {
    userAgent: raw,
    browser: browserName,
    browserVersion,
    os: osName,
    osVersion,
    deviceType,
    deviceVendor: uaDevice.vendor || '',
    deviceModel: uaDevice.model || '',
  };
}

/** Extract a readable bot label from the UA string. */
function _extractBotName(ua) {
  const match = ua.match(/^([^\s/;(]+)/);
  return match ? match[1] : 'Bot';
}

function _unknown() {
  return {
    userAgent: '',
    browser: 'Unknown',
    browserVersion: '',
    os: 'Unknown',
    osVersion: '',
    deviceType: 'desktop',
    deviceVendor: '',
    deviceModel: '',
  };
}

module.exports = { parseUserAgent };
