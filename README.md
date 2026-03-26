# apollo-lazy-cache-persist

[![npm version](https://badge.fury.io/js/apollo-lazy-cache-persist.svg)](https://www.npmjs.com/package/apollo-lazy-cache-persist)
[![npm downloads](https://img.shields.io/npm/dm/apollo-lazy-cache-persist.svg)](https://www.npmjs.com/package/apollo-lazy-cache-persist)

Lazy query cache persistence for [Apollo Client](https://www.apollographql.com/docs/react/).

Instead of restoring the **entire persisted cache during app startup**, this package restores **only the required query results when they are needed**.

This approach significantly reduces **memory spikes and startup time** in applications with large GraphQL caches.

---

# Why this package?

[Traditional Apollo cache persistence](https://github.com/apollographql/apollo-cache-persist) restores the **entire cache snapshot** when the application loads.

Typical flow:

```
IndexedDB → Load entire cache → Restore into InMemoryCache
```

When the persisted cache grows large (50MB–100MB+), this can cause:

- Large **memory spikes**
- Slower **application startup**
- Unnecessary data loaded into memory

## Lazy persistence approach

`apollo-lazy-cache-persist` restores **only the queries that are actually requested**.
```
Query request
↓
Check persisted storage
↓
Restore query result into Apollo InMemoryCache
↓
Network request executes normally
↓
Fresh result persists again
```

### Benefits

- ⚡ Faster startup time
- 🧠 Lower memory usage
- 📦 Smaller runtime cache footprint
- 🔄 Always updated with latest network response

---

# Features

- Lazy query cache restoration
- Query-level persistence
- Automatic pagination detection (pagination queries are skipped)
- Configurable TTL (time-to-live)
- Configurable maximum cache entry size
- Optional serialization
- Developer-provided storage engine
- Works with IndexedDB, localStorage, AsyncStorage, etc.

---

# Installation

```bash
npm install apollo-lazy-cache-persist
```

# Basic Usage

```js
import { ApolloClient, ApolloLink, HttpLink, InMemoryCache } from "@apollo/client"
import localforage from "localforage"

import {
  createLazyCacheStore,
  createLazyCacheLink
} from "apollo-lazy-cache-persist"

const cache = new InMemoryCache()

const storage = localforage.createInstance({
  name: "apollo-lazy-cache-persist",
  storeName: "query_cache"
})

const store = createLazyCacheStore({
  storage,
  ttl: 7 * 24 * 60 * 60 * 1000
})

const lazyLink = createLazyCacheLink({
  cache,
  store
})

const client = new ApolloClient({
  cache,
  link: ApolloLink.from([
    lazyLink,
    new HttpLink({ uri: "/graphql" })
  ])
})

```

# How it works

1. A query is executed in Apollo Client.
2. The lazy cache link checks if the result exists in persisted storage.
3. If found, the cached result is immediately written into InMemoryCache.
4. The network request continues normally.
5. When the network response arrives, the fresh result is persisted.

This allows the UI to render instantly using persisted data, while still updating with the latest network response.

# Configuration

```js
createLazyCacheStore({
  storage, // Storage adapter implementing getItem and setItem
  ttl, // Time-to-live for cache entries in milliseconds
  maxSize, // Maximum size allowed per persisted entry
  serialize // Whether entries should be stored as JSON strings
})
```

# Example Storage Implementations
## IndexedDB (Recommended)

Using localforage:
```js
import localforage from "localforage"

const storage = localforage.createInstance({
  name: "apollo-lazy-cache-persist",
  storeName: "query_cache"
})
```

# Cache Management
## Purge persisted cache

```
await store.purge()
```

This removes all persisted query results.

## Disable persistence

```
store.disable()
```

Stops any further query results from being persisted.

# Pagination Handling
Pagination queries are automatically skipped.

Variables containing keys such as:

```
cursor
offset
after
before
first
last
```

are treated as pagination queries and not persisted.

This prevents storing partial result sets that could corrupt merged lists.

# Hashing Query Variables (Optional)
Large variable objects can produce very long cache keys.

You can optionally provide a hashing function.

```js
const lazyLink = createLazyCacheLink({
  cache,
  store,
  hash: value => myHashFunction(value)
})
```

Example cache keys:

Without hashing:

`GetUsers:{"orgId":"123","filters":{"status":"active"}}`

With hashing:

`GetUsers:ab3f9k`

# What this package does NOT do
This package intentionally does not persist the entire Apollo cache.

It only persists network query results.

Manual cache updates like below are not persisted.

```
cache.writeQuery
cache.modify
cache.writeFragment
```

This design keeps the system predictable and prevents storing inconsistent or optimistic data.

# When should you use this?

This package works best when:

- Apollo cache becomes very large
- Startup performance is important
- Memory spikes from full cache restoration are problematic

Example applications:

- Large SaaS dashboards
- Analytics platforms
- Enterprise admin panels

# Comparison

| Feature | apollo-lazy-cache-persist | apollo3-cache-persist |
|------|------|------|
| Startup memory usage | Low | High |
| Startup speed | Fast | Slower |
| Persistence granularity | Per query | Entire cache |
| Manual cache updates persisted | No | Yes |

## Benchmark results (large reload profile, 50–80MB cache target)

### Web benchmark (`examples/react-comparison`, large-reload profile, 3 runs)

| Metric | apollo3-cache-persist (default) | apollo-lazy-cache-persist (lazy) | Delta (default - lazy) |
|------|------:|------:|------:|
| Startup restore time | 125.83 ms | 0.00 ms | 125.83 ms faster with lazy |
| First query time | 159.77 ms | 257.20 ms | -97.43 ms (default faster in this run) |
| Startup in-memory cache after reload | 56.56 MB | 2 B | 56.56 MB lower with lazy |
| Persisted size | 56.56 MB | 8.48 MB | 48.09 MB smaller with lazy |
| Runtime full cache size (after first query) | 56.56 MB | 8.51 MB | 48.05 MB smaller with lazy |

### React Native-style benchmark (`examples/react-comparison/rn_large_reload_compare.cjs`, 3 runs)

This benchmark uses an AsyncStorage-like adapter and Node runtime to emulate React Native persistence behavior without UI overhead.

| Metric | apollo3-cache-persist (default) | apollo-lazy-cache-persist (lazy) | Delta (default - lazy) |
|------|------:|------:|------:|
| Startup restore time | 111.71 ms | 0.09 ms | 111.62 ms faster with lazy |
| First query time | 214.38 ms | 289.75 ms | -75.38 ms (default faster in this run) |
| Startup in-memory cache after reload | 56.56 MB | ~0 MB (2 B) | 56.56 MB lower with lazy |
| Persisted size | 56.94 MB | 8.48 MB | 48.46 MB smaller with lazy |
| Runtime full cache size (after first query) | 56.56 MB | 8.51 MB | 48.05 MB smaller with lazy |
| Startup memory snapshot delta (RSS) | 45.83 MB | 0 MB | 45.83 MB lower with lazy |
| Startup memory snapshot delta (heap used) | 78.18 MB | ~0 MB (-5,960 B) | 78.19 MB lower with lazy |
| Startup memory snapshot delta (external) | 13.33 B | 0 B | 13.33 B lower with lazy |

Notes:

- Results vary by device/OS/runtime and storage backend implementation.
- In this large-reload profile, lazy mode consistently minimizes startup restore time and startup memory footprint.
- First query can be slower in lazy mode when data is restored on demand; this is expected tradeoff behavior.
- Memory snapshots in the React Native-style benchmark are captured from `process.memoryUsage()` during the startup restore window.
- Web benchmark can be reproduced from the UI button **Run 3x large reload test (~60MB)**.
- React Native-style benchmark can be reproduced with:
  - `cd examples/react-comparison`
  - `npm run benchmark:rn-large-reload`

# License

MIT
