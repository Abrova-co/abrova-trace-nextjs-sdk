import { ReleaseHealth, isAppError, MAX_QUEUED, type StorageLike } from '../services/ReleaseHealth';

class MemoryStorage implements StorageLike {
  data = new Map<string, string>();
  getItem(k: string) {
    return this.data.has(k) ? this.data.get(k)! : null;
  }
  setItem(k: string, v: string) {
    this.data.set(k, v);
  }
}

class ThrowingStorage implements StorageLike {
  getItem(): string | null {
    throw new Error('SecurityError');
  }
  setItem(): void {
    throw new Error('QuotaExceededError');
  }
}

/** Broadcast bus between "tabs". */
function bus() {
  const members: any[] = [];
  return () => {
    const ch: any = {
      onmessage: null,
      postMessage(m: unknown) {
        for (const o of members) if (o !== ch && o.onmessage) o.onmessage({ data: m });
      },
      close() {
        members.splice(members.indexOf(ch), 1);
      },
    };
    members.push(ch);
    return ch;
  };
}

const ORIGIN = 'https://app.example.com';
const flushAll = () => new Promise((r) => setTimeout(r, 0));

describe('ReleaseHealth', () => {
  let now: number;
  let sent: any[];
  let requests: number;
  let status: number;
  let offline: boolean;
  let local: StorageLike;
  let session: StorageLike;
  let channel: ReturnType<typeof bus>;
  let fetchFn: jest.Mock;
  const made: ReleaseHealth[] = [];

  function tab(opts: { user?: string; release?: string; session?: StorageLike; local?: StorageLike } = {}) {
    const win = new EventTarget();
    const doc: any = new EventTarget();
    doc.visibilityState = 'visible';
    const h = new ReleaseHealth({
      apiUrl: 'https://trace.test',
      apiKey: 'ab_live_test',
      platform: 'nextjs',
      environment: 'production',
      release: opts.release ?? '1.2.0',
      userId: () => opts.user,
      fetchFn: fetchFn as any,
      localStorage: () => opts.local ?? local,
      sessionStorage: () => opts.session ?? session,
      win,
      doc,
      origin: ORIGIN,
      channel,
      clock: () => now,
    });
    made.push(h);
    return { h, win, doc };
  }

  function setVisibility(doc: any, state: 'hidden' | 'visible') {
    doc.visibilityState = state;
    doc.dispatchEvent(new Event('visibilitychange'));
  }

  beforeEach(() => {
    now = Date.UTC(2026, 10, 14, 10);
    sent = [];
    requests = 0;
    status = 202;
    offline = false;
    local = new MemoryStorage();
    session = new MemoryStorage();
    channel = bus();
    fetchFn = jest.fn(async (url: string, init: any) => {
      requests++;
      if (offline) throw new TypeError('Failed to fetch');
      expect(url).toBe('https://trace.test/api/sessions');
      expect(init.headers['X-API-Key']).toBe('ab_live_test');
      sent.push(...JSON.parse(init.body).sessions);
      return { status } as Response;
    });
  });

  afterEach(() => {
    while (made.length) made.pop()!.stop();
  });

  it('first load reports one ok session with a random install id and nothing personal', async () => {
    const { h } = tab();
    h.start();
    await flushAll();
    expect(sent).toHaveLength(1);
    expect(Object.keys(sent[0]).sort()).toEqual(['did', 'environment', 'platform', 'release', 'sid', 'started', 'status']);
    expect(sent[0]).toMatchObject({ status: 'ok', release: '1.2.0', environment: 'production', platform: 'nextjs' });
    expect(sent[0].sid).toMatch(/^[0-9a-f]{32}$/);
    expect(sent[0].did).toMatch(/^[0-9a-f]{32}$/);
    expect(sent[0].started).toBe('2026-11-14T10:00:00.000Z');
    expect(h.sessionId).toBe(sent[0].sid);
  });

  it('a reload in the same tab keeps the session (no new ok)', async () => {
    const first = tab();
    first.h.start();
    await flushAll();
    first.win.dispatchEvent(new Event('pagehide'));
    first.h.stop();
    now += 2000;

    const reloaded = tab(); // same sessionStorage
    reloaded.h.start();
    await flushAll();
    expect(sent.filter((r) => r.status === 'ok')).toHaveLength(1);
    expect(reloaded.h.sessionId).toBe(first.h.sessionId);
  });

  it('a new tab is a new session with the same install id', async () => {
    tab().h.start();
    await flushAll();
    const other = tab({ session: new MemoryStorage() });
    other.h.start();
    await flushAll();
    expect(sent).toHaveLength(2);
    expect(sent[1].sid).not.toBe(sent[0].sid);
    expect(sent[1].did).toBe(sent[0].did);
  });

  it('a duplicated tab (copied sessionStorage) gets its own session', async () => {
    const original = tab();
    original.h.start();
    await flushAll();
    const copy = new MemoryStorage();
    (session as MemoryStorage).data.forEach((v, k) => copy.setItem(k, v));
    const dup = tab({ session: copy });
    dup.h.start();
    await flushAll();
    await flushAll();
    expect(dup.h.sessionId).not.toBe(original.h.sessionId);
    expect(sent.filter((r) => r.status === 'ok')).toHaveLength(2);
  });

  it('a new release in the same tab starts a new session', async () => {
    tab().h.start();
    await flushAll();
    const next = tab({ release: '1.3.0' });
    next.h.start();
    await flushAll();
    expect(sent.map((r) => r.release)).toEqual(['1.2.0', '1.3.0']);
  });

  it('a crash is reported once, for the same session, with the user id', async () => {
    const { h } = tab({ user: 'u-1' });
    h.start();
    await flushAll();
    h.markCrashed();
    h.markCrashed();
    await flushAll();
    h.onErrorEvent({ error: new Error('again'), filename: `${ORIGIN}/_next/static/chunks/app.js` });
    await flushAll();
    expect(sent.map((r) => r.status)).toEqual(['ok', 'crashed']);
    expect(sent[1].sid).toBe(sent[0].sid);
    expect(sent[1].started).toBe(sent[0].started);
    expect(sent[1].userId).toBe('u-1');
  });

  it('both reports of a session carry the user id read at its start, so it counts as one user', async () => {
    let user: string | undefined;
    const win = new EventTarget();
    const h = new ReleaseHealth({
      apiUrl: 'https://trace.test', apiKey: 'ab_live_test', platform: 'nextjs', environment: 'production', release: '1',
      userId: () => user, fetchFn: fetchFn as any, localStorage: () => local, sessionStorage: () => session,
      win, doc: null, origin: ORIGIN, channel: () => null, clock: () => now,
    });
    made.push(h);
    h.start();
    user = 'set-right-after-init'; // same tick as init()
    await flushAll();
    user = 'signed-in-later';
    h.markCrashed();
    await flushAll();
    expect(sent.map((r) => [r.status, r.userId])).toEqual([['ok', 'set-right-after-init'], ['crashed', 'set-right-after-init']]);
  });

  it('a crash before a reload is not reported again after it', async () => {
    const first = tab();
    first.h.start();
    first.h.markCrashed();
    await flushAll();
    first.h.stop();
    const again = tab();
    again.h.start();
    again.h.markCrashed();
    await flushAll();
    expect(sent.filter((r) => r.status === 'crashed')).toHaveLength(1);
  });

  it("an app error from the page's own origin is a crash", async () => {
    const { h } = tab();
    h.start();
    const err = new Error('boom');
    err.stack = `Error: boom\n    at onClick (${ORIGIN}/_next/static/chunks/app/page-1a2b.js:12:34)\n    at HTMLUnknownElement.callCallback (${ORIGIN}/_next/static/chunks/framework.js:1:1)`;
    h.onErrorEvent({ error: err, message: 'Uncaught Error: boom', filename: `${ORIGIN}/_next/static/chunks/app/page-1a2b.js` });
    await flushAll();
    expect(sent.map((r) => r.status)).toEqual(['ok', 'crashed']);
  });

  it('extension, cross-origin and stackless errors are not crashes', async () => {
    const { h } = tab();
    h.start();
    const ext = new Error('ext');
    ext.stack = 'Error: ext\n    at inject (chrome-extension://abcdef/content.js:1:2)';
    h.onErrorEvent({ error: ext, filename: 'chrome-extension://abcdef/content.js' });
    const ff = new Error('ff');
    ff.stack = 'inject@moz-extension://1234-5678/content.js:3:4\n';
    h.onRejection(ff);
    const viaExt = new Error('via ext');
    viaExt.stack = `Error: via ext\n    at a (${ORIGIN}/app.js:1:1)\n    at b (safari-web-extension://X/inject.js:2:2)`;
    h.onErrorEvent({ error: viaExt });
    h.onErrorEvent({ error: null, message: 'Script error.', filename: '' }); // cross-origin script
    const third = new Error('third party');
    third.stack = 'Error: third party\n    at x (https://cdn.ads.example.net/tag.js:1:1)';
    h.onErrorEvent({ error: third, filename: 'https://cdn.ads.example.net/tag.js' });
    h.onRejection('a string reason');
    h.onRejection(Object.assign(new TypeError('Failed to fetch'), { stack: 'TypeError: Failed to fetch' }));
    await flushAll();
    expect(sent.map((r) => r.status)).toEqual(['ok']);
  });

  it('isAppError: same origin, /_next/ on an asset CDN, Firefox frames', () => {
    expect(isAppError(`Error\n    at f (${ORIGIN}/page.js:1:2)`, undefined, ORIGIN)).toBe(true);
    expect(isAppError('Error\n    at f (https://cdn.example.net/_next/static/chunks/main.js:1:2)', undefined, ORIGIN)).toBe(true);
    expect(isAppError(`f@${ORIGIN}/_next/static/chunks/a.js:3:9\n`, undefined, ORIGIN)).toBe(true);
    expect(isAppError(undefined, `${ORIGIN}/`, ORIGIN)).toBe(true); // inline script
    expect(isAppError('Error\n    at f (webkit-masked-url://hidden/:1:2)', undefined, ORIGIN)).toBe(false);
    expect(isAppError(undefined, undefined, ORIGIN)).toBe(false);
  });

  it('30 minutes hidden starts a new session; a short absence does not', async () => {
    const { h, doc } = tab();
    h.start();
    await flushAll();
    const first = h.sessionId;
    setVisibility(doc, 'hidden');
    now += 29 * 60 * 1000;
    setVisibility(doc, 'visible');
    await flushAll();
    expect(h.sessionId).toBe(first);
    setVisibility(doc, 'hidden');
    now += 30 * 60 * 1000;
    setVisibility(doc, 'visible');
    await flushAll();
    expect(h.sessionId).not.toBe(first);
    expect(sent.map((r) => r.status)).toEqual(['ok', 'ok']);
    expect(sent[1].started).toBe(new Date(now).toISOString());
  });

  it('a reload after 30 minutes away starts a new session', async () => {
    const first = tab();
    first.h.start();
    await flushAll();
    first.win.dispatchEvent(new Event('pagehide'));
    first.h.stop();
    now += 31 * 60 * 1000;
    const later = tab();
    later.h.start();
    await flushAll();
    expect(later.h.sessionId).not.toBe(first.h.sessionId);
    expect(sent.filter((r) => r.status === 'ok')).toHaveLength(2);
  });

  it('offline: reports are kept and sent later', async () => {
    offline = true;
    const { h, win } = tab();
    h.start();
    h.markCrashed();
    await flushAll();
    expect(sent).toHaveLength(0);
    expect(JSON.parse(local.getItem('abrova_trace_rh_queue')!)).toHaveLength(2);

    offline = false;
    win.dispatchEvent(new Event('online'));
    await flushAll();
    expect(sent.map((r) => r.status)).toEqual(['ok', 'crashed']);
    expect(JSON.parse(local.getItem('abrova_trace_rh_queue')!)).toHaveLength(0);
  });

  it('kept on 5xx and 404, dropped on 400/401/403/413', async () => {
    for (const code of [500, 503, 404]) {
      status = code;
      const { h } = tab({ session: new MemoryStorage() });
      h.start();
      await flushAll();
    }
    expect(JSON.parse(local.getItem('abrova_trace_rh_queue')!)).toHaveLength(3);
    status = 401;
    const { h } = tab({ session: new MemoryStorage() });
    h.start();
    await flushAll();
    expect(JSON.parse(local.getItem('abrova_trace_rh_queue')!)).toHaveLength(0);
    expect(requests).toBe(4);
    // refused reports are not sent again
    const again = tab({ session: new MemoryStorage() });
    status = 202;
    again.h.start();
    await flushAll();
    expect(sent.slice(-1)[0].sid).toBe(again.h.sessionId);
    expect(JSON.parse(fetchFn.mock.calls.slice(-1)[0][1].body).sessions).toHaveLength(1);
  });

  it('keeps at most 50 reports, dropping the oldest', async () => {
    offline = true;
    const sids: string[] = [];
    for (let i = 0; i < MAX_QUEUED + 10; i++) {
      const { h } = tab({ session: new MemoryStorage() });
      h.start();
      sids.push(h.sessionId!);
      await flushAll();
    }
    const queue = JSON.parse(local.getItem('abrova_trace_rh_queue')!);
    expect(queue).toHaveLength(MAX_QUEUED);
    expect(queue[0].sid).toBe(sids[10]);
    offline = false;
    const { h } = tab({ session: new MemoryStorage() });
    h.start();
    await flushAll();
    expect(JSON.parse(fetchFn.mock.calls.slice(-1)[0][1].body).sessions).toHaveLength(MAX_QUEUED);
  });

  it('pagehide sends the queue with a keepalive request', async () => {
    offline = true;
    const { h, win } = tab();
    h.start();
    await flushAll();
    offline = false;
    win.dispatchEvent(new Event('pagehide'));
    await flushAll();
    const last = fetchFn.mock.calls.slice(-1)[0][1];
    expect(last.keepalive).toBe(true);
    expect(sent).toHaveLength(1);
  });

  it('storage that throws: still works from memory and never throws', async () => {
    const bad = new ThrowingStorage();
    const { h, doc } = tab({ local: bad, session: bad });
    expect(() => h.start()).not.toThrow();
    h.markCrashed();
    await flushAll();
    expect(sent.map((r) => r.status)).toEqual(['ok', 'crashed']);
    expect(() => setVisibility(doc, 'hidden')).not.toThrow();
  });

  it('storage that is missing (getter throws): still works', async () => {
    const { h } = tab({ local: undefined as any });
    const h2 = new ReleaseHealth({
      apiUrl: 'https://trace.test',
      apiKey: 'ab_live_test',
      platform: 'nextjs',
      environment: 'production',
      release: '1',
      userId: () => undefined,
      fetchFn: fetchFn as any,
      localStorage: () => {
        throw new Error('SecurityError');
      },
      sessionStorage: () => null,
      win: null,
      doc: null,
      origin: ORIGIN,
      channel: () => null,
    });
    made.push(h2);
    h.start();
    h2.start();
    await flushAll();
    expect(sent).toHaveLength(2);
  });

  it('a fetch that throws synchronously does not reach the app', async () => {
    fetchFn.mockImplementation(() => {
      throw new Error('blocked');
    });
    const { h, win } = tab();
    expect(() => h.start()).not.toThrow();
    expect(() => win.dispatchEvent(new Event('pagehide'))).not.toThrow();
    await flushAll();
  });
});

describe('AbrovaTrace + release health', () => {
  // Imported lazily so the browser globals below are in place first.
  const { AbrovaTrace } = require('../AbrovaTrace');
  let fetchMock: jest.Mock;
  const originalFetch = global.fetch;

  function sessionCalls() {
    return fetchMock.mock.calls.filter((c) => String(c[0]).endsWith('/api/sessions'));
  }

  function browser() {
    const win: any = new EventTarget();
    win.location = { origin: ORIGIN, href: `${ORIGIN}/` };
    win.localStorage = new MemoryStorage();
    win.sessionStorage = new MemoryStorage();
    (global as any).window = win;
    (global as any).document = Object.assign(new EventTarget(), { visibilityState: 'visible' });
    Object.defineProperty(global, 'navigator', { value: { userAgent: 'Mozilla/5.0 Chrome/120.0' }, configurable: true });
    return win;
  }

  beforeEach(() => {
    (AbrovaTrace as any).instance = null;
    fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 202, text: () => Promise.resolve('') });
    global.fetch = fetchMock as any;
  });

  afterEach(() => {
    AbrovaTrace.getInstance()?.close();
    (AbrovaTrace as any).instance = null;
    delete (global as any).window;
    delete (global as any).document;
    global.fetch = originalFetch;
  });

  const config = { apiKey: 'ab_live_test', apiUrl: 'https://trace.test', release: '2.0.0', environment: 'staging', enableCrashDetection: false };

  it('server code never sends sessions', async () => {
    AbrovaTrace.init({ ...config, enableServerSide: false });
    await flushAll();
    expect(sessionCalls()).toHaveLength(0);
  });

  it('in the browser: one ok session, errors carry its id, an app error marks it crashed once', async () => {
    const win = browser();
    const sdk = AbrovaTrace.init(config);
    sdk.setUserId('user-7');
    await flushAll();
    expect(sessionCalls()).toHaveLength(1);
    const ok = JSON.parse(sessionCalls()[0][1].body).sessions[0];
    expect(ok).toMatchObject({ status: 'ok', platform: 'nextjs', release: '2.0.0', environment: 'staging' });
    expect(sdk.getSessionId()).toBe(ok.sid);

    const error = new Error('boom');
    error.stack = `Error: boom\n    at f (${ORIGIN}/_next/static/chunks/page.js:1:2)`;
    const event: any = new Event('error');
    Object.assign(event, { error, message: 'boom', filename: `${ORIGIN}/_next/static/chunks/page.js`, lineno: 1, colno: 2 });
    win.dispatchEvent(event);
    win.dispatchEvent(event);
    await flushAll();
    const crashed = sessionCalls().flatMap((c) => JSON.parse(c[1].body).sessions).filter((r: any) => r.status === 'crashed');
    expect(crashed).toHaveLength(1);
    expect(crashed[0]).toMatchObject({ sid: ok.sid, userId: 'user-7' });
    const errorCall = fetchMock.mock.calls.find((c) => String(c[0]).endsWith('/api/errors'));
    expect(JSON.parse(errorCall[1].body).session_id).toBe(ok.sid);
  });

  it('the ErrorBoundary hook marks the session crashed', async () => {
    browser();
    const sdk = AbrovaTrace.init(config);
    sdk.markSessionCrashed();
    await flushAll();
    const all = sessionCalls().flatMap((c) => JSON.parse(c[1].body).sessions);
    expect(all.map((r: any) => r.status).sort()).toEqual(['crashed', 'ok']);
  });

  it('enableReleaseHealth: false or enabled: false sends nothing', async () => {
    browser();
    AbrovaTrace.init({ ...config, enableReleaseHealth: false }).markSessionCrashed();
    await flushAll();
    AbrovaTrace.getInstance()?.close();
    (AbrovaTrace as any).instance = null;
    AbrovaTrace.init({ ...config, enabled: false });
    await flushAll();
    expect(sessionCalls()).toHaveLength(0);
  });
});
