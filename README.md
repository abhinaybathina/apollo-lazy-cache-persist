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

# License

MIT
