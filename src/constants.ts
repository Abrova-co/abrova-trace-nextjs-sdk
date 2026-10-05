/** AbrovaTrace API endpoint - hardcoded, not user-configurable */
// Internal dev override via env var (not documented, not in public API)
export const ABROVATRACE_API_URL =
  (typeof process !== 'undefined' && process.env?.ABROVATRACE_DEV_API_URL) ||
  'https://trace.abrova.ir';
