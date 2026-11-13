/**
 * Release health for the browser: sessions and crash-free sessions per release.
 *
 * One session per browser tab. Its id is kept in sessionStorage, so client-side
 * navigations and reloads in the same tab keep it. A new session starts when a
 * new tab opens, or when the tab comes back after being hidden for at least
 * `hiddenTimeoutMs` (30 minutes). Each session is reported once as `ok` when it
 * starts, and once more as `crashed` when it crashed. Abrova Trace counts every
 * session and crash once, so a report may be sent again safely.
 *
 * Sends only a random install id (made in the browser and kept in
 * localStorage, never a device id), a random session id, the start time, the
 * release, the environment, the platform and the user id the app set. Reports
 * that could not be sent are kept in localStorage and sent later (at most
 * MAX_QUEUED). When storage is blocked (private mode, Safari ITP) everything
 * works from memory for the life of the page.
 *
 * Nothing here throws into the app.
 */

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

interface ChannelLike {
  postMessage(message: unknown): void;
  close(): void;
  onmessage: ((event: { data: any }) => void) | null;
}

export interface ReleaseHealthOptions {
  apiUrl: string;
  apiKey: string;
  platform: string;
  environment: string;
  release: string;
  /** The user id the app set through the SDK, read at report time. */
  userId: () => string | undefined;
  timeoutMs?: number;
  hiddenTimeoutMs?: number;
  debug?: boolean;
  // The rest default to the browser globals; tests pass their own.
  fetchFn?: typeof fetch;
  localStorage?: () => StorageLike | null | undefined;
  sessionStorage?: () => StorageLike | null | undefined;
  win?: Pick<EventTarget, 'addEventListener' | 'removeEventListener'> | null;
  doc?: (Pick<EventTarget, 'addEventListener' | 'removeEventListener'> & { visibilityState?: string }) | null;
  origin?: string;
  channel?: () => ChannelLike | null;
  clock?: () => number;
}

interface SessionReport {
  sid: string;
  did: string;
  status: 'ok' | 'crashed';
  started: string;
  release: string;
  environment: string;
  platform: string;
  userId?: string;
}

interface CurrentSession {
  sid: string;
  started: string;
  release: string;
  environment: string;
  platform: string;
  crashed: boolean;
  /** When the tab was hidden (or left), so a reload after a long absence starts a new session. */
  hiddenAt?: number;
  /**
   * The user id the session's reports carry: read once, at its first report, and then kept, so the
   * `ok` and `crashed` reports of one session always count as the same user. null: no user id.
   */
  user?: string | null;
}

const DID_KEY = 'abrova_trace_rh_did';
const QUEUE_KEY = 'abrova_trace_rh_queue';
const SESSION_KEY = 'abrova_trace_rh_session';
const CHANNEL_NAME = 'abrova_trace_rh';
const ID = /^[0-9a-f]{32}$/;

export const MAX_QUEUED = 50;
const MAX_BATCH = 100;

/** Server answers after which a batch is done: sent, or refused for good. Anything else (network error, 5xx, 404) keeps it. */
function isFinal(status: number): boolean {
  return (status >= 200 && status < 300) || status === 400 || status === 401 || status === 403 || status === 413;
}

function randomId(): string {
  const bytes = new Uint8Array(16);
  try {
    crypto.getRandomValues(bytes);
  } catch {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** A Web Storage that falls back to memory as soon as the real one throws (or is missing). */
class SafeStore {
  private memory = new Map<string, string>();
  private broken = false;

  constructor(private readonly get: () => StorageLike | null | undefined) {}

  private storage(): StorageLike | null {
    if (this.broken) return null;
    try {
      const s = this.get();
      if (s) return s;
    } catch {
      // Accessing window.localStorage itself can throw (SecurityError).
    }
    this.broken = true;
    return null;
  }

  read(key: string): string | null {
    const s = this.storage();
    if (s) {
      try {
        return s.getItem(key);
      } catch {
        this.broken = true;
      }
    }
    return this.memory.get(key) ?? null;
  }

  write(key: string, value: string): void {
    this.memory.set(key, value);
    const s = this.storage();
    if (!s) return;
    try {
      s.setItem(key, value);
    } catch {
      this.broken = true;
    }
  }
}

// Stack frame URLs: Chrome "at fn (https://x/a.js:1:2)", Firefox/Safari "fn@https://x/a.js:1:2".
const URL_IN_STACK = /\b[a-z][a-z0-9+.-]*:\/\/[^\s()'"@]+/gi;
const NOT_THE_APP = /^(chrome-extension|moz-extension|safari-extension|safari-web-extension|ms-browser-extension|webkit-masked-url|chrome|resource|about):/i;

/**
 * Whether an uncaught browser error belongs to the app, i.e. may count as a crash.
 *
 * A browser page does not die on an uncaught error, so this is conservative:
 *  - the error must carry a stack frame or a filename (a cross-origin
 *    "Script error." carries neither and is never counted);
 *  - no frame may come from a browser extension or the browser itself
 *    (chrome-extension://, moz-extension://, safari-web-extension://,
 *    webkit-masked-url://, ...);
 *  - the top frame must be the page's own origin, or a Next.js bundle
 *    (`/_next/`, which may be served from an `assetPrefix` CDN).
 * Errors from third-party scripts, and rejections without a stack (a plain
 * string, most network failures), are not crashes.
 */
export function isAppError(stack: string | undefined, filename: string | undefined, origin: string): boolean {
  const urls: string[] = stack ? stack.match(URL_IN_STACK) ?? [] : [];
  if (urls.length === 0 && filename) urls.push(filename);
  const first = urls[0];
  if (first === undefined) return false;
  if (urls.some((u) => NOT_THE_APP.test(u))) return false;
  try {
    const top = new URL(first.replace(/(:\d+){1,2}$/, ''));
    return top.origin === origin || top.pathname.includes('/_next/');
  } catch {
    return false;
  }
}

export class ReleaseHealth {
  private readonly local: SafeStore;
  private readonly session: SafeStore;
  private readonly clock: () => number;
  private readonly hiddenTimeoutMs: number;
  private readonly tabId = randomId();
  private did = '';
  private current: CurrentSession | null = null;
  private started = false;
  private stopped = false;
  private flushing = false;
  /** A report was queued while a flush was running: send it when that one is done. */
  private flushAgain = false;
  private pendingOk: CurrentSession | null = null;
  private channel: ChannelLike | null = null;
  private readonly listeners: Array<[Pick<EventTarget, 'removeEventListener'>, string, EventListener]> = [];

  constructor(private readonly options: ReleaseHealthOptions) {
    const g: any = typeof window !== 'undefined' ? window : undefined;
    this.local = new SafeStore(options.localStorage ?? (() => g?.localStorage));
    this.session = new SafeStore(options.sessionStorage ?? (() => g?.sessionStorage));
    this.clock = options.clock ?? Date.now;
    this.hiddenTimeoutMs = options.hiddenTimeoutMs ?? 30 * 60 * 1000;
  }

  /** The current session's id, or undefined before start(). */
  get sessionId(): string | undefined {
    return this.current?.sid;
  }

  /** Starts (or, in the same tab, continues) the session and sends the waiting reports. */
  start(): void {
    if (this.started) return;
    this.started = true;
    try {
      this.loadInstallId();
      const kept = this.readSession();
      const o = this.options;
      const reuse =
        kept &&
        kept.release === o.release &&
        kept.environment === o.environment &&
        kept.platform === o.platform &&
        !(kept.hiddenAt !== undefined && this.clock() - kept.hiddenAt >= this.hiddenTimeoutMs);
      if (reuse) {
        kept.hiddenAt = undefined;
        this.current = kept;
        this.saveSession();
      } else {
        // The ok report waits a microtask, so a setUserId() right after init() is in it.
        this.newSession(true);
      }
      this.listen();
      // A duplicated tab copies sessionStorage: ask the other tabs whether this session is theirs.
      if (reuse) this.channel?.postMessage({ t: 'claim', sid: this.current!.sid, tab: this.tabId });
      // A new session flushes once its ok report is queued (see newSession).
      if (reuse) void this.flush();
    } catch (e) {
      this.log('start failed', e);
      void this.flush();
    }
  }

  /** The session crashed (reported once). */
  markCrashed(): void {
    try {
      const s = this.current;
      if (!s || s.crashed || this.stopped) return;
      this.reportPendingOk(); // ok first, in the same tick as init()
      s.crashed = true;
      this.saveSession();
      this.enqueue(s, 'crashed');
      void this.flush();
    } catch (e) {
      this.log('crash not recorded', e);
    }
  }

  /** A window `error` event: a crash when it belongs to the app (see isAppError). */
  onErrorEvent(event: { error?: any; filename?: string; message?: string }): void {
    try {
      const stack = event?.error && typeof event.error.stack === 'string' ? event.error.stack : undefined;
      if (isAppError(stack, event?.filename, this.origin())) this.markCrashed();
    } catch {
      // never into the app
    }
  }

  /** An `unhandledrejection` reason: a crash only for an Error whose stack belongs to the app. */
  onRejection(reason: any): void {
    try {
      const stack = reason && typeof reason.stack === 'string' ? reason.stack : undefined;
      if (isAppError(stack, undefined, this.origin())) this.markCrashed();
    } catch {
      // never into the app
    }
  }

  /** Sends the waiting reports in one batch. Kept on a network error, 5xx or 404. */
  async flush(): Promise<void> {
    if (this.stopped) return;
    if (this.flushing) {
      this.flushAgain = true;
      return;
    }
    const batch = this.readQueue().slice(0, MAX_BATCH);
    if (batch.length === 0) return;
    this.flushing = true;
    this.flushAgain = false;
    let sentOk = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const controller = typeof AbortController !== 'undefined' ? new AbortController() : undefined;
      if (controller) timer = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 10000);
      const response = await this.fetchFn()(this.url(), {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({ sessions: batch }),
        signal: controller?.signal,
      });
      sentOk = this.settle(batch, response.status);
    } catch (e) {
      this.log('reports kept for later', e);
    } finally {
      if (timer) clearTimeout(timer);
      this.flushing = false;
    }
    // Only after an answer (not after a failure, so an offline page does not retry in a loop).
    if (sentOk && this.flushAgain) void this.flush();
  }

  /** The page is going away: hand the waiting reports to a keepalive request (sendBeacon cannot send the key header). */
  flushOnExit(): void {
    try {
      const batch = this.readQueue().slice(0, MAX_BATCH);
      if (batch.length === 0) return;
      this.fetchFn()(this.url(), {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({ sessions: batch }),
        keepalive: true,
      })
        .then((r) => this.settle(batch, r.status))
        .catch(() => undefined);
    } catch {
      // never into the app
    }
  }

  /** Removes the listeners (SDK close). */
  stop(): void {
    if (this.stopped) return;
    this.flushOnExit();
    this.stopped = true;
    for (const [target, type, fn] of this.listeners) {
      try {
        target.removeEventListener(type, fn);
      } catch {
        // ignore
      }
    }
    this.listeners.length = 0;
    try {
      this.channel?.close();
    } catch {
      // ignore
    }
    this.channel = null;
  }

  // ─── internals ───────────────────────────────────────────

  private listen(): void {
    const o = this.options;
    const win = o.win !== undefined ? o.win : typeof window !== 'undefined' ? window : null;
    const doc = o.doc !== undefined ? o.doc : typeof document !== 'undefined' ? document : null;
    const on = (target: Pick<EventTarget, 'addEventListener' | 'removeEventListener'> | null, type: string, fn: EventListener) => {
      if (!target) return;
      target.addEventListener(type, fn);
      this.listeners.push([target, type, fn]);
    };
    on(doc, 'visibilitychange', () => {
      if (doc?.visibilityState === 'hidden') this.hidden();
      else if (doc?.visibilityState === 'visible') this.visible();
    });
    on(win, 'pagehide', () => {
      this.hidden();
      this.flushOnExit();
    });
    on(win, 'pageshow', (e: any) => {
      if (e?.persisted) this.visible();
    });
    on(win, 'online', () => void this.flush());

    try {
      this.channel = o.channel
        ? o.channel()
        : typeof BroadcastChannel !== 'undefined'
          ? (new BroadcastChannel(CHANNEL_NAME) as unknown as ChannelLike)
          : null;
    } catch {
      this.channel = null;
    }
    if (this.channel) {
      this.channel.onmessage = (event) => {
        try {
          const m = event?.data;
          const sid = this.current?.sid;
          if (!m || !sid || m.sid !== sid || m.tab === this.tabId) return;
          if (m.t === 'claim') this.channel?.postMessage({ t: 'taken', sid, to: m.tab });
          else if (m.t === 'taken' && m.to === this.tabId) {
            this.newSession();
            void this.flush();
          }
        } catch {
          // ignore
        }
      };
    }
  }

  private hidden(): void {
    const s = this.current;
    if (!s || this.stopped) return;
    if (s.hiddenAt === undefined) s.hiddenAt = this.clock();
    this.saveSession();
  }

  private visible(): void {
    const s = this.current;
    if (!s || this.stopped) return;
    const since = s.hiddenAt;
    s.hiddenAt = undefined;
    if (since !== undefined && this.clock() - since >= this.hiddenTimeoutMs) this.newSession();
    else this.saveSession();
    void this.flush();
  }

  private newSession(deferReport = false): void {
    const o = this.options;
    this.current = {
      sid: randomId(),
      started: new Date(this.clock()).toISOString(),
      release: o.release,
      environment: o.environment,
      platform: o.platform,
      crashed: false,
    };
    this.saveSession();
    if (!deferReport) {
      this.enqueue(this.current, 'ok');
      return;
    }
    this.pendingOk = this.current;
    Promise.resolve().then(() => {
      try {
        if (this.reportPendingOk()) void this.flush();
      } catch (e) {
        this.log('session not recorded', e);
      }
    });
  }

  /** Queues the deferred ok report of the current session, if it still waits; true when it did. */
  private reportPendingOk(): boolean {
    const s = this.pendingOk;
    this.pendingOk = null;
    if (!s || s !== this.current || this.stopped) return false;
    this.enqueue(s, 'ok');
    return true;
  }

  private enqueue(s: CurrentSession, status: 'ok' | 'crashed'): void {
    if (s.user === undefined) {
      const uid = this.options.userId();
      s.user = uid ? String(uid) : null;
      if (s === this.current) this.saveSession();
    }
    const report: SessionReport = {
      sid: s.sid,
      did: this.did,
      status,
      started: s.started,
      release: s.release,
      environment: s.environment,
      platform: s.platform,
    };
    if (s.user) report.userId = s.user;
    // Read-modify-write on every change: other tabs share the queue.
    const queue = this.readQueue().filter((r) => !(r.sid === report.sid && r.status === report.status));
    queue.push(report);
    this.writeQueue(queue.slice(-MAX_QUEUED));
  }

  /** Removes the batch from the queue when the answer is final; true then. */
  private settle(batch: SessionReport[], status: number): boolean {
    if (!isFinal(status)) {
      this.log(`server answered ${status}, reports kept`);
      return false;
    }
    if (status >= 300) this.log(`reports refused (${status})`);
    const sent = new Set(batch.map((r) => `${r.sid}|${r.status}`));
    this.writeQueue(this.readQueue().filter((r) => !sent.has(`${r.sid}|${r.status}`)));
    return true;
  }

  private loadInstallId(): void {
    const kept = this.local.read(DID_KEY);
    if (kept && ID.test(kept)) {
      this.did = kept;
      return;
    }
    this.did = randomId();
    this.local.write(DID_KEY, this.did);
  }

  private readSession(): CurrentSession | null {
    try {
      const raw = this.session.read(SESSION_KEY);
      if (!raw) return null;
      const s = JSON.parse(raw);
      if (!s || typeof s.sid !== 'string' || !ID.test(s.sid) || typeof s.started !== 'string') return null;
      return {
        sid: s.sid,
        started: s.started,
        release: String(s.release ?? ''),
        environment: String(s.environment ?? ''),
        platform: String(s.platform ?? ''),
        crashed: s.crashed === true,
        hiddenAt: typeof s.hiddenAt === 'number' ? s.hiddenAt : undefined,
        user: typeof s.user === 'string' || s.user === null ? s.user : undefined,
      };
    } catch {
      return null;
    }
  }

  private saveSession(): void {
    if (this.current) this.session.write(SESSION_KEY, JSON.stringify(this.current));
  }

  private readQueue(): SessionReport[] {
    try {
      const raw = this.local.read(QUEUE_KEY);
      const list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list)
        ? list.filter((r) => r && typeof r.sid === 'string' && typeof r.did === 'string' && (r.status === 'ok' || r.status === 'crashed'))
        : [];
    } catch {
      return [];
    }
  }

  private writeQueue(queue: SessionReport[]): void {
    this.local.write(QUEUE_KEY, JSON.stringify(queue));
  }

  private fetchFn(): typeof fetch {
    return this.options.fetchFn ?? fetch;
  }

  private url(): string {
    return `${this.options.apiUrl}/api/sessions`;
  }

  private headers(): Record<string, string> {
    return { 'Content-Type': 'application/json', 'X-API-Key': this.options.apiKey };
  }

  private origin(): string {
    if (this.options.origin !== undefined) return this.options.origin;
    try {
      return window.location.origin;
    } catch {
      return '';
    }
  }

  private log(message: string, error?: unknown): void {
    if (this.options.debug) console.log(`[AbrovaTrace] Release health: ${message}`, error ?? '');
  }
}
