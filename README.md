# Abrova Trace for Next.js

Error tracking, crash detection, breadcrumbs, logging and performance monitoring for Next.js applications, reported to Abrova Trace.

## Requirements

- Next.js 12 or later (the App Router setup needs Next.js 13 or later)
- React 17 or later
- Node.js 16 or later (reporting from server code needs Node.js 18 or later)

## Install

```
# .npmrc (in your project root)
@abrova-trace:registry=https://center.abrova.ir/api/packages/abrova/npm/
```

```
npm install @abrova-trace/nextjs-sdk
```

## Quick start

### App Router

Create a client component, `app/providers.tsx`. The API key comes from the Abrova console.

```tsx
'use client';

import { ReactNode, Suspense, useEffect } from 'react';
import { AbrovaTrace } from '@abrova-trace/nextjs-sdk';
import { ErrorBoundary, useAbrovaTraceNavigation } from '@abrova-trace/nextjs-sdk/react';

function NavigationTracker() {
  useAbrovaTraceNavigation();
  return null;
}

export function Providers({ children }: { children: ReactNode }) {
  useEffect(() => {
    AbrovaTrace.init({
      apiKey: 'ab_live_your_api_key',
      environment: process.env.NODE_ENV,
      release: '1.0.0',
    });
  }, []);

  return (
    <ErrorBoundary>
      <Suspense fallback={null}>
        <NavigationTracker />
      </Suspense>
      {children}
    </ErrorBoundary>
  );
}
```

Then wrap `{children}` in `<Providers>` inside the `<body>` of `app/layout.tsx`.

Uncaught browser errors, unhandled promise rejections, React render errors and route changes are now reported.

### Pages Router

In `pages/_app.tsx`, call `AbrovaTrace.init()` in a `useEffect` in the same way, and call `useAbrovaTracePagesRouter()` from `@abrova-trace/nextjs-sdk/react` instead of `useAbrovaTraceNavigation()`.

### Server code

The browser and the server each need their own `init()`. For route handlers and API routes, create one shared module, for example `lib/trace.ts`, and import `trace` from it:

```ts
import { AbrovaTrace } from '@abrova-trace/nextjs-sdk';

export const trace =
  AbrovaTrace.getInstance() ?? AbrovaTrace.init({ apiKey: 'ab_live_your_api_key' });
```

## Usage

`AbrovaTrace.getInstance()` returns the initialised SDK, or `null` before `init()`.

```ts
import { AbrovaTrace, BreadcrumbService } from '@abrova-trace/nextjs-sdk';

const trace = AbrovaTrace.getInstance();

// Capture an exception: (error, message?, extra?, level?)
trace?.captureException(error, 'Checkout failed', { orderId: 'A-1' });
// Capture a message: (message, level?, extra?) with level debug, info, warning or error
trace?.captureMessage('Checkout completed', 'info', { orderId: 'A-1' });
// Set the user, tags and extra data sent with every event
trace?.setUserId('user-123');
trace?.setTag('plan', 'pro');
trace?.setExtra('cartSize', 3);
// Add a breadcrumb (also: addHttp, addState, addNavigation, addInfo, addQuery)
BreadcrumbService.addUser('Clicked checkout', { cartTotal: 99 });
```

In client components, the `useAbrovaTrace()` and `useBreadcrumbs()` hooks from `@abrova-trace/nextjs-sdk/react` return the same functions (`captureException`, `captureMessage`, `setUserId`, `addBreadcrumb` and others).

`ErrorBoundary` reports render errors of its children. It accepts `fallback` (an element, or a function `(error, errorInfo, resetError) => element`), `onError`, `fallbackMessage` and `showErrorDetails`. The default fallback shows the error message and stack trace in development only.

### Logging

Logs are sent in batches. Available levels: `trace`, `logDebug`, `info`, `warn`, `logError`, `fatal`.

```ts
await trace?.enableLogging({ sourceId: 'web', sourceName: 'Web app' });
trace?.info('Checkout started', { cartSize: 3 });
trace?.logError('Payment failed', { orderId: 'A-1' });
```

### Performance tracing

```ts
trace?.enablePerformanceTracking(); // times every fetch() call in the browser
trace?.enableWebVitals();           // LCP, FID, CLS, INP, TTFB, FCP
const users = await trace?.trackOperation('load-users', () => loadUsers(), { operationType: 'db' });
```

## Configuration

Options for `AbrovaTrace.init()`:

| Option | Default | Description |
|---|---|---|
| `apiKey` | required | Project API key |
| `environment` | `production` | Environment name |
| `release` | none | Version of your application |
| `enabled` | `true` | Set to `false` to stop reporting |
| `debug` | `false` | Print SDK activity to the console |
| `captureUncaughtErrors` | `true` | Report uncaught errors and unhandled promise rejections |
| `enableClientSide`, `enableServerSide` | `true` | Install the automatic error handlers in the browser / on the server |
| `enableCrashDetection` | `true` | Report a browser session that ended without closing normally |
| `sampleRate` | `1.0` | Share of errors and messages to report, from 0.0 to 1.0 |
| `maxBreadcrumbs` | `20` | Breadcrumbs kept in memory |
| `timeout` | `10` | Request timeout in seconds |
| `tags` | `{}` | Tags attached to every event |
| `ignoreErrors` | `[]` | Strings or RegExps; errors with a matching message are not reported |
| `ignoreUrls` | `[]` | Strings or RegExps; errors with a matching stack trace are not reported |
| `beforeSend` | none | Function called with each error before it is sent; return `null` or `false` to drop it |
| `apiUrl` | `https://trace.abrova.ir` | Base URL of the Trace API |

For readable stack traces, set `productionBrowserSourceMaps: true` in `next.config.js` and upload the generated `.map` files with `@abrova-trace/cli`.

## License

MIT, see LICENSE
