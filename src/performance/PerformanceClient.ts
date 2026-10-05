import type { PerformanceSpan } from './PerformanceSpan';
import { createHttpSpan, generateSpanId, generateTraceId } from './PerformanceSpan';
import { isBrowser, getClientInfo } from '../utils/platform';
import { ABROVATRACE_API_URL } from '../constants';

interface PerformanceClientConfig {
  apiKey: string;
  environment?: string;
  releaseVersion?: string;
  debug?: boolean;
  batchSize?: number;
  flushInterval?: number;
  apiUrl?: string;
}

/**
 * Performance Client for tracking HTTP request latency
 * Supports automatic fetch interception and manual span reporting
 */
export class PerformanceClient {
  private static instance: PerformanceClient | null = null;
  private config: PerformanceClientConfig;
  private spanBuffer: PerformanceSpan[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private originalFetch: typeof fetch | null = null;

  private constructor(config: PerformanceClientConfig) {
    this.config = {
      // 5 keeps the unload-flush payload well under Safari's 64 KB keepalive
      // quota; each span is ~1-5 KB depending on URL/tags/metadata.
      batchSize: 5,
      flushInterval: 5000,
      ...config,
    };
    this.registerUnloadFlush();
  }

  /**
   * Flush the buffer when the page is being unloaded / hidden so the last
   * batch survives navigation. This is the only place we use keepalive:true
   * (browsers cap total in-flight keepalive at 64 KB) — normal flushes go
   * through regular fetch with no size limit.
   */
  private registerUnloadFlush(): void {
    if (!isBrowser()) return;
    const flushOnUnload = () => {
      // Fire-and-forget; the event loop is about to shut down.
      this.flush({ keepalive: true });
    };
    // visibilitychange is the modern, reliable signal on mobile Safari;
    // pagehide is the fallback for older browsers + bfcache navigations.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flushOnUnload();
    });
    window.addEventListener('pagehide', flushOnUnload);
  }

  /**
   * Initialize Performance Client
   */
  static init(config: PerformanceClientConfig): PerformanceClient {
    if (PerformanceClient.instance) {
      return PerformanceClient.instance;
    }

    PerformanceClient.instance = new PerformanceClient(config);
    return PerformanceClient.instance;
  }

  /**
   * Get client instance
   */
  static getInstance(): PerformanceClient | null {
    return PerformanceClient.instance;
  }

  /**
   * Enable automatic fetch interception
   */
  enableAutoTracking(): void {
    if (!isBrowser()) return;

    if (this.originalFetch) {
      if (this.config.debug) {
        console.log('[AbrovaTrace] Auto tracking already enabled');
      }
      return;
    }

    this.originalFetch = window.fetch;
    const self = this;

    window.fetch = async function (input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
      const startTime = new Date();
      const traceId = generateTraceId();
      const spanId = generateSpanId();

      // Determine URL and method
      let url: string;
      let method: string;

      if (typeof input === 'string') {
        url = input;
        method = init?.method || 'GET';
      } else if (input instanceof URL) {
        url = input.toString();
        method = init?.method || 'GET';
      } else {
        url = input.url;
        method = input.method || init?.method || 'GET';
      }

      // Skip tracking for AbrovaTrace API calls
      if (url.includes(self.config.apiUrl ?? ABROVATRACE_API_URL)) {
        return self.originalFetch!.call(window, input, init);
      }

      try {
        const response = await self.originalFetch!.call(window, input, init);
        const durationMs = Date.now() - startTime.getTime();

        const span = createHttpSpan({
          method,
          url,
          statusCode: response.status,
          durationMs,
          startTime,
          environment: self.config.environment,
          releaseVersion: self.config.releaseVersion,
        });

        span.traceId = traceId;
        span.spanId = spanId;

        self.reportSpan(span);

        return response;
      } catch (error) {
        const durationMs = Date.now() - startTime.getTime();

        const span = createHttpSpan({
          method,
          url,
          durationMs,
          startTime,
          error: error instanceof Error ? error : new Error(String(error)),
          environment: self.config.environment,
          releaseVersion: self.config.releaseVersion,
        });

        span.traceId = traceId;
        span.spanId = spanId;

        self.reportSpan(span);

        throw error;
      }
    };

    if (this.config.debug) {
      console.log('[AbrovaTrace] Fetch auto-tracking enabled');
    }
  }

  /**
   * Disable automatic fetch interception
   */
  disableAutoTracking(): void {
    if (this.originalFetch && isBrowser()) {
      window.fetch = this.originalFetch;
      this.originalFetch = null;

      if (this.config.debug) {
        console.log('[AbrovaTrace] Fetch auto-tracking disabled');
      }
    }
  }

  /**
   * Report a performance span
   */
  reportSpan(span: PerformanceSpan): void {
    this.spanBuffer.push(span);

    if (this.spanBuffer.length >= (this.config.batchSize || 10)) {
      this.flush();
    } else {
      this.scheduleFlush();
    }
  }

  /**
   * Track a custom operation
   */
  async trackOperation<T>(
    operation: string,
    fn: () => Promise<T>,
    options?: { operationType?: 'http' | 'db' | 'custom'; tags?: Record<string, string> }
  ): Promise<T> {
    const startTime = new Date();
    const traceId = generateTraceId();
    const spanId = generateSpanId();

    try {
      const result = await fn();
      const durationMs = Date.now() - startTime.getTime();

      this.reportSpan({
        operation,
        operationType: options?.operationType || 'custom',
        durationMs,
        startTime: startTime.toISOString(),
        endTime: new Date().toISOString(),
        traceId,
        spanId,
        platform: 'nextjs',
        environment: this.config.environment,
        releaseVersion: this.config.releaseVersion,
        tags: options?.tags,
        status: 'ok',
      });

      return result;
    } catch (error) {
      const durationMs = Date.now() - startTime.getTime();

      this.reportSpan({
        operation,
        operationType: options?.operationType || 'custom',
        durationMs,
        startTime: startTime.toISOString(),
        endTime: new Date().toISOString(),
        traceId,
        spanId,
        platform: 'nextjs',
        environment: this.config.environment,
        releaseVersion: this.config.releaseVersion,
        tags: options?.tags,
        status: 'error',
        errorMessage: error instanceof Error ? error.message : String(error),
      });

      throw error;
    }
  }

  /**
   * Schedule a flush
   */
  private scheduleFlush(): void {
    if (this.flushTimer) return;

    this.flushTimer = setTimeout(() => {
      this.flush();
    }, this.config.flushInterval);
  }

  /**
   * Send a single performance span immediately (matching Flutter SDK's single span endpoint)
   */
  async sendSingleSpan(span: PerformanceSpan): Promise<void> {
    try {
      const url = `${this.config.apiUrl ?? ABROVATRACE_API_URL}/api/performance/spans`;

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.config.apiKey,
        },
        body: JSON.stringify({ ...span, client: getClientInfo() }),
      });

      if (this.config.debug) {
        if (response.ok) {
          console.log(`[AbrovaTrace] Sent single performance span: ${span.operation}`);
        } else {
          console.error('[AbrovaTrace] Failed to send span:', response.status);
        }
      }
    } catch (error) {
      if (this.config.debug) {
        console.error('[AbrovaTrace] Error sending span:', error);
      }
    }
  }

  /**
   * Flush buffered spans to the API.
   *
   * `keepalive` is only set on page-unload flushes (see registerUnloadFlush).
   * Setting it on regular flushes made Safari reject the request once total
   * in-flight keepalive bytes exceeded the browser's 64 KB quota, surfacing
   * as a CORS-shaped "access control checks" error.
   */
  async flush(options: { keepalive?: boolean } = {}): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    if (this.spanBuffer.length === 0) return;

    const spans = [...this.spanBuffer];
    this.spanBuffer = [];

    try {
      const url = `${this.config.apiUrl ?? ABROVATRACE_API_URL}/api/performance/spans/batch`;

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.config.apiKey,
        },
        body: JSON.stringify({ spans, client: getClientInfo() }),
        ...(options.keepalive ? { keepalive: true } : {}),
      });

      if (this.config.debug) {
        if (response.ok) {
          console.log(`[AbrovaTrace] Sent ${spans.length} performance spans`);
        } else {
          console.error('[AbrovaTrace] Failed to send spans:', response.status);
        }
      }
    } catch (error) {
      if (this.config.debug) {
        console.error('[AbrovaTrace] Error sending spans:', error);
      }

      // Re-add failed spans to buffer (up to limit)
      const maxBuffer = (this.config.batchSize || 10) * 5;
      this.spanBuffer = [...spans, ...this.spanBuffer].slice(0, maxBuffer);
    }
  }
}

/**
 * Create a wrapped fetch function with performance tracking
 */
export function createPerformanceFetch(config: PerformanceClientConfig): typeof fetch {
  return async function performanceFetch(
    input: RequestInfo | URL,
    init?: RequestInit
  ): Promise<Response> {
    const startTime = new Date();

    let url: string;
    let method: string;

    if (typeof input === 'string') {
      url = input;
      method = init?.method || 'GET';
    } else if (input instanceof URL) {
      url = input.toString();
      method = init?.method || 'GET';
    } else {
      url = input.url;
      method = input.method || init?.method || 'GET';
    }

    try {
      const response = await fetch(input, init);
      const durationMs = Date.now() - startTime.getTime();

      const span = createHttpSpan({
        method,
        url,
        statusCode: response.status,
        durationMs,
        startTime,
        environment: config.environment,
        releaseVersion: config.releaseVersion,
      });

      // Send span
      const client = PerformanceClient.getInstance();
      if (client) {
        client.reportSpan(span);
      }

      return response;
    } catch (error) {
      const durationMs = Date.now() - startTime.getTime();

      const span = createHttpSpan({
        method,
        url,
        durationMs,
        startTime,
        error: error instanceof Error ? error : new Error(String(error)),
        environment: config.environment,
        releaseVersion: config.releaseVersion,
      });

      const client = PerformanceClient.getInstance();
      if (client) {
        client.reportSpan(span);
      }

      throw error;
    }
  };
}
