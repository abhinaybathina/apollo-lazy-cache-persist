# Apollo persistence comparison app

This app compares:

- **Default strategy**: [`apollo3-cache-persist`](https://github.com/apollographql/apollo-cache-persist) restoring a full persisted cache snapshot at startup.
- **Lazy strategy**: [`apollo-lazy-cache-persist`](https://www.npmjs.com/package/apollo-lazy-cache-persist) restoring query results lazily on demand.

## What this demo measures

On each run, the app executes both flows and captures:

1. **Startup restore time**
   - `apollo3-cache-persist`: time spent running `persistor.restore()`
   - `apollo-lazy-cache-persist`: near-zero startup restore (no full cache restore)
2. **First query time** (`GetUsers` with `cache-first`)
3. **Persisted payload size**
   - default: full cache snapshot bytes
   - lazy: one query entry bytes
4. **Runtime cache size** after the first query
5. **Startup JS heap snapshot (web)**
   - captured from `performance.memory` after startup restore window (`usedJSHeapSize` + `totalJSHeapSize`)

The UI runs multiple iterations and displays per-run details and averages.

## Run locally

From the repository root:

```bash
cd examples/react-comparison
npm install
npm run dev
```

Open the local Vite URL (usually `http://localhost:5173`) and click **Run 5x comparison**.

For large persisted-cache testing (50–80MB equivalent payload), click:

- **Run 3x large reload test (~60MB)**

This profile seeds significantly larger users/posts payloads, simulates app reload behavior, and compares:

1. Startup restore time
2. Startup in-memory cache size immediately after reload
3. First query time after reload
4. Persisted storage size
5. Startup JS heap snapshot (used + total heap)

## Notes

- The app uses an in-app mock Apollo link for deterministic query responses during benchmarking.
- Seeded data is written into each persistence strategy before timing starts, so both modes run with comparable stored content.
- Browser/device performance affects absolute numbers; focus on relative differences.
- Large profile is intentionally heavy and may take longer per run.

## Expected comparison pattern

In most runs you should see:

- **Lower startup time** for lazy mode.
- **Smaller persisted unit size** per query in lazy mode.
- **Potentially similar or slightly different first query time**, depending on network conditions.

This mirrors the package design goal: avoid full startup cache hydration and restore data only when queries are actually used.

## Interpreting large reload test results

For the large profile, you should typically observe:

- **default (`apollo3-cache-persist`)**: larger startup restore time and much larger startup in-memory cache due to full snapshot hydration.
- **lazy (`apollo-lazy-cache-persist`)**: near-zero startup restore with low startup in-memory cache, because query data is restored on demand.

This test is designed specifically to emulate the real-world “persisted cache has grown large, user reloads app” scenario.
