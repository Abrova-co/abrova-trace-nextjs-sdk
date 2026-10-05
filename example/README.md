# Abrova Trace Next.js example

A Next.js App Router application that exercises the SDK. The SDK is initialised in `app/providers.tsx`, and each page tests one feature: manual errors (`/`), messages (`/message`), automatic error tracking (`/error-tracking`), the error boundary (`/error-boundary`), breadcrumbs (`/breadcrumbs`), user context (`/user-context`), logging (`/logging`), performance (`/performance`), crash detection (`/crash-detection`) and source maps (`/source-maps`).

## Run it

The example uses the SDK from the parent directory, so build the SDK first:

```
npm install && npm run build
cd example && npm install
```

Create `example/.env.local` with your API key from the Abrova console:

```
NEXT_PUBLIC_ABROVA_TRACE_API_KEY=ab_live_your_api_key
NEXT_PUBLIC_APP_VERSION=1.0.0
```

`app/providers.tsx` sets `apiUrl` to `http://localhost:3001`. Remove that line to send events to Abrova Trace. Then start the application and open http://localhost:3000:

```
npm run dev
```
