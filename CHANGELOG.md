# Changelog

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
