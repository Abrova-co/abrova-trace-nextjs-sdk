# Changelog

## 0.2.0 - 2026-11-14

- Release health: in the browser, the SDK now reports sessions so the console shows crash-free sessions and crash-free users per release. One session per browser tab; a session counts as crashed when the `ErrorBoundary` catches a render error or an uncaught error comes from your own code. Sends a random install id kept in `localStorage`, never a device id. Sessions are free. Turn it off with `enableReleaseHealth: false`.
- In the browser, `getSessionId()` and the `session_id` sent with errors and messages are now the release health session (one per tab, kept across reloads).

## 0.1.8 - 2026-10-05

- `ErrorBoundary` and the hooks from `@abrova-trace/nextjs-sdk/react` now use the SDK you initialised with `AbrovaTrace.init()`. Before, errors caught by the boundary were not reported.
- The default `ErrorBoundary` fallback no longer shows the error message and stack trace in production. Use the new `showErrorDetails` prop to choose.
- `ErrorBoundary` no longer writes debug lines to the browser console.

## 0.1.5 - 2026-10-05

First public release.

- Automatic reporting of uncaught errors and unhandled promise rejections, in the browser and on the server.
- Manual reporting with `captureException()` and `captureMessage()`, with user ID, tags, extra data and breadcrumbs.
- React bindings in `@abrova-trace/nextjs-sdk/react`: `ErrorBoundary`, `useAbrovaTrace`, `useBreadcrumbs` and navigation tracking for the App Router and the Pages Router.
- Browser crash detection, reported on the next visit.
- Batched logging with six levels, from `trace` to `fatal`.
- Performance monitoring: Web Vitals, automatic `fetch` timing and custom spans with `trackOperation()`.
- Filtering with `ignoreErrors`, `ignoreUrls`, `sampleRate` and `beforeSend`.
