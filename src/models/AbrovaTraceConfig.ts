/**
 * Configuration options for AbrovaTrace SDK
 */
export interface AbrovaTraceConfig {
  /**
   * API Key from Abrova Console
   * Format: ab_live_xxx or ab_test_xxx
   */
  apiKey: string;

  /**
   * Environment name (e.g., 'production', 'staging', 'development')
   * @default 'production'
   */
  environment?: string;

  /**
   * Release version of your application
   * @default undefined
   */
  release?: string;

  /**
   * Whether to automatically capture uncaught errors
   * @default true
   */
  captureUncaughtErrors?: boolean;

  /**
   * Enable or disable the SDK
   * @default true
   */
  enabled?: boolean;

  /**
   * Enable debug logging to console
   * @default false
   */
  debug?: boolean;

  /**
   * HTTP timeout in seconds
   * @default 10
   */
  timeout?: number;

  /**
   * Maximum number of breadcrumbs to keep in memory
   * @default 20
   */
  maxBreadcrumbs?: number;

  /**
   * Sample rate for error reporting (0.0 to 1.0)
   * 1.0 = 100% of errors reported
   * @default 1.0
   */
  sampleRate?: number;

  /**
   * Custom tags to attach to all events
   */
  tags?: Record<string, string>;

  /**
   * Enable server-side error tracking (Next.js API routes, server components)
   * @default true
   */
  enableServerSide?: boolean;

  /**
   * Enable client-side error tracking (browser errors)
   * @default true
   */
  enableClientSide?: boolean;

  /**
   * Enable crash detection (tab crashes, page unresponsiveness)
   * @default true
   */
  enableCrashDetection?: boolean;

  /**
   * Release health: report browser sessions so the console shows crash-free
   * sessions and users per release. Browser only; sessions are free.
   * @default true
   */
  enableReleaseHealth?: boolean;

  /**
   * Callback function called before sending an error
   * Return false to prevent sending
   */
  beforeSend?: (error: AbrovaTraceError) => AbrovaTraceError | null | false;

  /**
   * List of error messages to ignore (regex patterns)
   */
  ignoreErrors?: (string | RegExp)[];

  /**
   * List of URLs to ignore errors from
   */
  ignoreUrls?: (string | RegExp)[];

  /**
   * Custom API URL for self-hosted AbrovaTrace instances
   * @default 'https://trace.abrova.ir'
   * @example 'https://my-server.com'
   */
  apiUrl?: string;
}

/**
 * Error data structure sent to AbrovaTrace API
 */
export interface AbrovaTraceError {
  message: string;
  stack_trace?: string;
  platform: string;
  environment?: string;
  release_version?: string;
  timestamp: string;
  breadcrumbs?: Breadcrumb[];
  extra?: Record<string, any>;
  tags?: Record<string, string>;
  user_id?: string;
  session_id?: string;
  level?: 'fatal' | 'error' | 'warning' | 'info' | 'debug';
  url?: string;
  /** Browser UA (browser) or SDK UA (server); filled in when sending. */
  user_agent?: string;
}

/**
 * Message/log data structure
 */
export interface AbrovaTraceMessage {
  message: string;
  level: MessageLevel | 'info' | 'warning' | 'error' | 'debug';
  platform: string;
  environment?: string;
  release?: string;
  timestamp: string;
  user_id?: string;
  session_id?: string;
  extra?: Record<string, any>;
  tags?: Record<string, string>;
  breadcrumbs?: Breadcrumb[];
}

/**
 * Log/message severity levels
 */
export enum MessageLevel {
  Debug = 'debug',
  Info = 'info',
  Warning = 'warning',
  Error = 'error',
}

/**
 * Breadcrumb - user action tracking
 */
export interface Breadcrumb {
  message: string;
  type: BreadcrumbType;
  timestamp: string;
  data?: Record<string, any>;
  level?: 'debug' | 'info' | 'warning' | 'error';
}

/**
 * Breadcrumb types
 */
export enum BreadcrumbType {
  Navigation = 'navigation',
  User = 'user',
  Http = 'http',
  State = 'state',
  Error = 'error',
  Info = 'info',
  Console = 'console',
  Query = 'query',
}

/**
 * Platform detection result
 */
export interface PlatformInfo {
  platform: string;
  userAgent?: string;
  isServer: boolean;
  isBrowser: boolean;
  browser?: string;
  os?: string;
  device?: string;
}

/**
 * Internal SDK options with defaults applied
 */
export interface NormalizedConfig extends Required<Omit<AbrovaTraceConfig, 'beforeSend' | 'ignoreErrors' | 'ignoreUrls' | 'tags'>> {
  beforeSend?: AbrovaTraceConfig['beforeSend'];
  ignoreErrors: (string | RegExp)[];
  ignoreUrls: (string | RegExp)[];
  tags: Record<string, string>;
  apiUrl: string;
}
