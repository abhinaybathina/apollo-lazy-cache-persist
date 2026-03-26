import {
  ApolloClient,
  ApolloLink,
  HttpLink,
  InMemoryCache,
  NormalizedCacheObject,
  gql,
} from '@apollo/client'
import { CachePersistor, LocalForageWrapper } from 'apollo3-cache-persist'
import localforage from 'localforage'
import { useCallback, useMemo, useState } from 'react'

import { createLazyCacheLink, createLazyCacheStore } from 'apollo-lazy-cache-persist'

import './App.css'

type Mode = 'default' | 'lazy'

type RunMetrics = {
  mode: Mode
  startupMs: number
  firstQueryMs: number
  fullCacheSizeBytes: number
  persistedEntryBytes: number
  timestamp: string
}

const USERS_QUERY = gql`
  query GetUsers {
    users {
      id
      name
      email
      company {
        name
      }
    }
  }
`

const POSTS_QUERY = gql`
  query GetPosts {
    posts {
      id
      title
      body
    }
  }
`

const GRAPHQL_URL = 'https://graphqlzero.almansi.me/api'
const TOTAL_RUNS = 5

function nowMs() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

function safeJsonSize(value: unknown) {
  try {
    return JSON.stringify(value).length
  } catch {
    return 0
  }
}

function average(values: number[]) {
  if (values.length === 0) return 0
  return values.reduce((sum, v) => sum + v, 0) / values.length
}

function formatMs(value: number) {
  return `${value.toFixed(2)} ms`
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

async function seedStorageForDefault(storage: LocalForage, cache: InMemoryCache) {
  cache.writeQuery({
    query: USERS_QUERY,
    data: {
      users: Array.from({ length: 300 }, (_, index) => ({
        __typename: 'User',
        id: `${index + 1}`,
        name: `Seed User ${index + 1}`,
        email: `seed${index + 1}@example.com`,
        company: {
          __typename: 'Company',
          name: `Seed Company ${(index % 20) + 1}`,
        },
      })),
    },
  })

  cache.writeQuery({
    query: POSTS_QUERY,
    data: {
      posts: Array.from({ length: 400 }, (_, index) => ({
        __typename: 'Post',
        id: `${index + 1}`,
        title: `Seed Post ${index + 1}`,
        body: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. '.repeat(4),
      })),
    },
  })

  const persistor = new CachePersistor<NormalizedCacheObject>({
    cache,
    storage: new LocalForageWrapper(storage),
    key: 'apollo-cache-persist',
    trigger: false,
    debug: false,
  })

  await persistor.persist()
}

async function seedStorageForLazy(storage: LocalForage) {
  const store = createLazyCacheStore({
    storage,
    ttl: 24 * 60 * 60 * 1000,
  })

  const usersData = {
    users: Array.from({ length: 300 }, (_, index) => ({
      __typename: 'User',
      id: `${index + 1}`,
      name: `Seed User ${index + 1}`,
      email: `seed${index + 1}@example.com`,
      company: {
        __typename: 'Company',
        name: `Seed Company ${(index % 20) + 1}`,
      },
    })),
  }

  const postsData = {
    posts: Array.from({ length: 400 }, (_, index) => ({
      __typename: 'Post',
      id: `${index + 1}`,
      title: `Seed Post ${index + 1}`,
      body: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. '.repeat(4),
    })),
  }

  await store.set('GetUsers:{}', usersData)
  await store.set('GetPosts:{}', postsData)
}

async function runDefaultFlow(): Promise<RunMetrics> {
  const storage = localforage.createInstance({
    name: 'apollo-comparison',
    storeName: 'default-mode',
  })

  await storage.clear()

  const seedCache = new InMemoryCache()
  await seedStorageForDefault(storage, seedCache)

  const cache = new InMemoryCache()
  const client = new ApolloClient({
    cache,
    link: new HttpLink({ uri: GRAPHQL_URL }),
  })

  const startupStart = nowMs()
  const persistor = new CachePersistor<NormalizedCacheObject>({
    cache,
    storage: new LocalForageWrapper(storage),
    key: 'apollo-cache-persist',
    trigger: false,
    debug: false,
  })

  await persistor.restore()
  const startupMs = nowMs() - startupStart

  const firstQueryStart = nowMs()
  await client.query({
    query: USERS_QUERY,
    fetchPolicy: 'cache-first',
  })
  const firstQueryMs = nowMs() - firstQueryStart

  const cacheSnapshot = cache.extract()
  const persistedSnapshot = await storage.getItem('apollo-cache-persist')

  return {
    mode: 'default',
    startupMs,
    firstQueryMs,
    fullCacheSizeBytes: safeJsonSize(cacheSnapshot),
    persistedEntryBytes: safeJsonSize(persistedSnapshot),
    timestamp: new Date().toISOString(),
  }
}

async function runLazyFlow(): Promise<RunMetrics> {
  const storage = localforage.createInstance({
    name: 'apollo-comparison',
    storeName: 'lazy-mode',
  })

  await storage.clear()
  await seedStorageForLazy(storage)

  const cache = new InMemoryCache()
  const store = createLazyCacheStore({
    storage,
    ttl: 24 * 60 * 60 * 1000,
  })

  const lazyLink = createLazyCacheLink({
    cache,
    store,
  })

  const client = new ApolloClient({
    cache,
    link: ApolloLink.from([lazyLink, new HttpLink({ uri: GRAPHQL_URL })]),
  })

  const startupStart = nowMs()
  await Promise.resolve()
  const startupMs = nowMs() - startupStart

  const firstQueryStart = nowMs()
  await client.query({
    query: USERS_QUERY,
    fetchPolicy: 'cache-first',
  })
  const firstQueryMs = nowMs() - firstQueryStart

  const cacheSnapshot = cache.extract()
  const usersEntry = await storage.getItem('GetUsers:{}')

  return {
    mode: 'lazy',
    startupMs,
    firstQueryMs,
    fullCacheSizeBytes: safeJsonSize(cacheSnapshot),
    persistedEntryBytes: safeJsonSize(usersEntry),
    timestamp: new Date().toISOString(),
  }
}

function App() {
  const [results, setResults] = useState<RunMetrics[]>([])
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const summary = useMemo(() => {
    const defaults = results.filter((result) => result.mode === 'default')
    const lazies = results.filter((result) => result.mode === 'lazy')

    const defaultStartup = average(defaults.map((result) => result.startupMs))
    const lazyStartup = average(lazies.map((result) => result.startupMs))

    const defaultFirstQuery = average(defaults.map((result) => result.firstQueryMs))
    const lazyFirstQuery = average(lazies.map((result) => result.firstQueryMs))

    const defaultPersisted = average(defaults.map((result) => result.persistedEntryBytes))
    const lazyPersisted = average(lazies.map((result) => result.persistedEntryBytes))

    return {
      defaultStartup,
      lazyStartup,
      startupDelta: defaultStartup - lazyStartup,
      defaultFirstQuery,
      lazyFirstQuery,
      firstQueryDelta: defaultFirstQuery - lazyFirstQuery,
      defaultPersisted,
      lazyPersisted,
      persistedDelta: defaultPersisted - lazyPersisted,
    }
  }, [results])

  const runComparison = useCallback(async () => {
    setRunning(true)
    setError(null)
    setResults([])

    try {
      const runs: RunMetrics[] = []

      for (let run = 0; run < TOTAL_RUNS; run += 1) {
        runs.push(await runDefaultFlow())
        runs.push(await runLazyFlow())
      }

      setResults(runs)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
    } finally {
      setRunning(false)
    }
  }, [])

  return (
    <main className="container">
      <h1>Apollo Cache Persist Comparison</h1>
      <p>
        This test app compares startup restore behavior of <code>apollo3-cache-persist</code> against{' '}
        <code>apollo-lazy-cache-persist</code>.
      </p>

      <button className="run-button" disabled={running} onClick={runComparison}>
        {running ? 'Running benchmark...' : `Run ${TOTAL_RUNS}x comparison`}
      </button>

      {error ? <p className="error">Error: {error}</p> : null}

      <section className="summary-grid">
        <article>
          <h2>Average Startup</h2>
          <p>default: {formatMs(summary.defaultStartup)}</p>
          <p>lazy: {formatMs(summary.lazyStartup)}</p>
          <p>delta: {formatMs(summary.startupDelta)} faster with lazy</p>
        </article>
        <article>
          <h2>Average First Query</h2>
          <p>default: {formatMs(summary.defaultFirstQuery)}</p>
          <p>lazy: {formatMs(summary.lazyFirstQuery)}</p>
          <p>delta: {formatMs(summary.firstQueryDelta)} faster with lazy</p>
        </article>
        <article>
          <h2>Average Persisted Data</h2>
          <p>default snapshot: {formatBytes(summary.defaultPersisted)}</p>
          <p>lazy per-query entry: {formatBytes(summary.lazyPersisted)}</p>
          <p>delta: {formatBytes(summary.persistedDelta)} lower with lazy</p>
        </article>
      </section>

      <section className="results">
        <h2>Run details</h2>
        <table>
          <thead>
            <tr>
              <th>mode</th>
              <th>startup</th>
              <th>first query</th>
              <th>cache size</th>
              <th>persisted size</th>
              <th>timestamp</th>
            </tr>
          </thead>
          <tbody>
            {results.map((result, index) => (
              <tr key={`${result.mode}-${result.timestamp}-${index}`}>
                <td>{result.mode}</td>
                <td>{formatMs(result.startupMs)}</td>
                <td>{formatMs(result.firstQueryMs)}</td>
                <td>{formatBytes(result.fullCacheSizeBytes)}</td>
                <td>{formatBytes(result.persistedEntryBytes)}</td>
                <td>{new Date(result.timestamp).toLocaleTimeString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  )
}

export default App
