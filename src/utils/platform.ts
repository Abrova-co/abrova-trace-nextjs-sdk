import type { PlatformInfo } from '../models';

/**
 * Detect if code is running on server or client
 */
export function isServer(): boolean {
  return typeof window === 'undefined';
}

/**
 * Detect if code is running in browser
 */
export function isBrowser(): boolean {
  return typeof window !== 'undefined';
}

/**
 * Get browser name from user agent
 */
export function getBrowserName(userAgent: string): string {
  const ua = userAgent.toLowerCase();

  if (ua.includes('edg/') || ua.includes('edge/')) {
    return 'edge';
  }
  if (ua.includes('chrome/') && !ua.includes('edg/')) {
    return 'chrome';
  }
  if (ua.includes('firefox/')) {
    return 'firefox';
  }
  if (ua.includes('safari/') && !ua.includes('chrome/') && !ua.includes('edg/')) {
    return 'safari';
  }
  if (ua.includes('opera/') || ua.includes('opr/')) {
    return 'opera';
  }

  return 'unknown';
}

/**
 * Get OS name from user agent
 */
export function getOSName(userAgent: string): string {
  const ua = userAgent.toLowerCase();

  if (ua.includes('win')) return 'windows';
  if (ua.includes('mac')) return 'macos';
  if (ua.includes('linux')) return 'linux';
  if (ua.includes('android')) return 'android';
  if (ua.includes('iphone') || ua.includes('ipad')) return 'ios';

  return 'unknown';
}

/**
 * Get device type from user agent
 */
export function getDeviceType(userAgent: string): string {
  const ua = userAgent.toLowerCase();

  if (ua.includes('mobile')) return 'mobile';
  if (ua.includes('tablet') || ua.includes('ipad')) return 'tablet';

  return 'desktop';
}

/**
 * Get comprehensive platform information
 */
export function getPlatformInfo(): PlatformInfo {
  const isServerEnv = isServer();

  if (isServerEnv) {
    // Server-side (Node.js)
    return {
      platform: 'nextjs_server',
      isServer: true,
      isBrowser: false,
      userAgent: process.env.USER_AGENT || 'Node.js',
      os: process.platform,
    };
  }

  // Client-side (Browser)
  const userAgent = navigator.userAgent;
  const browser = getBrowserName(userAgent);
  const os = getOSName(userAgent);
  const device = getDeviceType(userAgent);

  return {
    platform: 'nextjs',
    userAgent,
    isServer: false,
    isBrowser: true,
    browser,
    os,
    device,
  };
}

const SDK_NAME = 'abrova-trace-nextjs';
/** Must equal `version` in package.json (a test checks it). */
export const SDK_VERSION = '0.1.8';

/**
 * SDK identity for the request body. Browsers forbid setting `User-Agent`
 * on `fetch` — Safari blocks with a CORS error, Chrome/FF silently strip
 * it — so identity travels in the payload instead.
 */
export function getClientInfo(): { name: string; version: string; platform: string } {
  return {
    name: SDK_NAME,
    version: SDK_VERSION,
    platform: getPlatformString(),
  };
}

/**
 * Legacy — kept only for the Node/server code path and existing tests.
 * Never call from a browser fetch header.
 */
export function getUserAgent(): string {
  if (isServer()) {
    const node = typeof process !== 'undefined' && process.version ? `; Node ${process.version}` : '';
    return `AbrovaTrace-SDK/${SDK_VERSION} (nextjs_server${node})`;
  }

  return `AbrovaTrace-SDK/${SDK_VERSION} (${getPlatformString()})`;
}

/**
 * Get platform identifier string for API calls
 */
export function getPlatformString(): string {
  return getPlatformInfo().platform;
}

/**
 * The `user_agent` sent in error/message payloads: the browser's own UA in
 * the browser (the Console parses browser, OS and device from it), the SDK
 * UA with the Node version on the server.
 */
export function getReportUserAgent(): string {
  if (isBrowser() && typeof navigator !== 'undefined' && navigator.userAgent) {
    return navigator.userAgent;
  }
  return getUserAgent();
}

/**
 * Headers for a request to the AbrovaTrace API. `User-Agent` only on the
 * server — browsers forbid setting it (Safari fails the request with a
 * CORS error, others strip it).
 */
export function getRequestHeaders(apiKey: string): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-api-key': apiKey,
  };
  if (isServer()) headers['User-Agent'] = getUserAgent();
  return headers;
}

/**
 * Error/message payload plus SDK identity: `client`, `user_agent` (unless
 * already set) and `extra._sdk.sdk_version` (kept if the caller set one).
 */
export function withSdkContext<T extends object>(
  payload: T,
): T & { client: ReturnType<typeof getClientInfo>; user_agent: string; extra: Record<string, any> } {
  const p = payload as { extra?: Record<string, any>; user_agent?: string };
  const extra = p.extra ?? {};
  const sdk = extra._sdk && typeof extra._sdk === 'object' ? extra._sdk : {};
  return {
    ...payload,
    user_agent: p.user_agent || getReportUserAgent(),
    extra: { ...extra, _sdk: { sdk_version: SDK_VERSION, ...sdk } },
    client: getClientInfo(),
  };
}
