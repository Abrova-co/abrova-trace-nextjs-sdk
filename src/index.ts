// Main SDK
export { AbrovaTrace, init, getInstance } from './AbrovaTrace';

// Models
export * from './models';

// Services
export { BreadcrumbService, CrashDetector } from './services';

// Utilities
export { RouterIntegration, getPlatformInfo, isBrowser, isServer } from './utils';

// Performance / APM
export {
  WebVitalsTracker,
  PerformanceClient,
  createPerformanceFetch,
  createHttpSpan,
  generateTraceId,
  generateSpanId,
  PerformanceSpanFactory,
} from './performance';
export type { PerformanceSpan, WebVitalsData } from './performance';

// Logging
export { LogService } from './logging';
export type { LogEntry, LogLevel, LogServiceConfig } from './logging';

// Constants
export { SDK_VERSION } from './utils/platform';
export const SDK_NAME = '@abrova-trace/nextjs-sdk';
