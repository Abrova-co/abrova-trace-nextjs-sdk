# Changelog

## 0.1.5 - 2026-10-05

First public release.

- Automatic reporting of uncaught errors and unhandled promise rejections, in the browser and on the server.
- Manual reporting with `captureException()` and `captureMessage()`, with user ID, tags, extra data and breadcrumbs.
- React bindings in `@abrova-trace/nextjs-sdk/react`: `ErrorBoundary`, `useAbrovaTrace`, `useBreadcrumbs` and navigation tracking for the App Router and the Pages Router.
- Browser crash detection, reported on the next visit.
- Batched logging with six levels, from `trace` to `fatal`.
- Performance monitoring: Web Vitals, automatic `fetch` timing and custom spans with `trackOperation()`.
- Filtering with `ignoreErrors`, `ignoreUrls`, `sampleRate` and `beforeSend`.
