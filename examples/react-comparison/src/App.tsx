import {
  ApolloClient,
  ApolloLink,
  InMemoryCache,
  Observable,
  gql,
} from '@apollo/client'
import { CachePersistor, LocalForageWrapper } from 'apollo3-cache-persist'
import type { NormalizedCacheObject } from '@apollo/client'
import localforage from 'localforage'
import { useCallback, useMemo, useState } from 'react'

import { createLazyCacheLink, createLazyCacheStore } from 'apollo-lazy-cache-persist'

import './App.css'

type Mode = 'default' | 'lazy'
type BenchmarkProfile = 'standard' | 'large-reload'
type SeedProfile = 'standard' | 'large'

type RunMetrics = {
  mode: Mode
  profile: BenchmarkProfile
  startupMs: number
  firstQueryMs: number
  startupCacheSizeBytes: number
  fullCacheSizeBytes: number
  persistedEntryBytes: number
  startupMemorySnapshot: {
    heapUsedBytes: number
    totalHeapBytes: number
  }
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

const TOTAL_RUNS = 5
const LARGE_RELOAD_RUNS = 3
const LARGE_POSTS_COUNT = 12000
const LARGE_USERS_COUNT = 4000
const LARGE_USER_TEXT = 'U'.repeat(2048)
const LARGE_POST_TEXT = 'P'.repeat(4096)

function getRunCount(profile: BenchmarkProfile) {
  const defaultRuns = profile === 'large-reload' ? LARGE_RELOAD_RUNS : TOTAL_RUNS

  if (typeof window === 'undefined') {
    return defaultRuns
  }

  const value = new URLSearchParams(window.location.search).get('benchmarkRuns')
  const parsed = value ? Number(value) : Number.NaN

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return defaultRuns
  }

  return Math.floor(parsed)
}

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

function captureMemorySnapshot() {
  if (typeof performance === 'undefined' || !('memory' in performance)) {
    return {
      heapUsedBytes: 0,
      totalHeapBytes: 0,
    }
  }

  const memory = performance.memory as {
    usedJSHeapSize: number
    totalJSHeapSize: number
  }

  return {
    heapUsedBytes: memory.usedJSHeapSize,
    totalHeapBytes: memory.totalJSHeapSize,
  }
}

function createMockNetworkLink(seedData: ReturnType<typeof buildSeedData>) {
  return new ApolloLink((operation) =>
    new Observable((observer) => {
      if (operation.operationName === 'GetUsers') {
        observer.next({ data: { users: seedData.users } })
        observer.complete()
        return
      }

      if (operation.operationName === 'GetPosts') {
        observer.next({ data: { posts: seedData.posts } })
        observer.complete()
        return
      }

      observer.next({ data: {} })
      observer.complete()
    }),
  )
}

function buildSeedData(profile: SeedProfile) {
  if (profile === 'large') {
    return {
      users: Array.from({ length: LARGE_USERS_COUNT }, (_, index) => ({
        __typename: 'User',
        id: `${index + 1}`,
        name: `Seed User ${index + 1} ${LARGE_USER_TEXT}`,
        email: `seed${index + 1}@example.com`,
        company: {
          __typename: 'Company',
          name: `Seed Company ${(index % 20) + 1}`,
        },
      })),
      posts: Array.from({ length: LARGE_POSTS_COUNT }, (_, index) => ({
        __typename: 'Post',
        id: `${index + 1}`,
        title: `Seed Post ${index + 1}`,
        body: LARGE_POST_TEXT,
      })),
    }
  }

  return {
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
    posts: Array.from({ length: 400 }, (_, index) => ({
      __typename: 'Post',
      id: `${index + 1}`,
      title: `Seed Post ${index + 1}`,
      body: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. '.repeat(4),
    })),
  }
}

async function seedStorageForDefault(storage: LocalForage, cache: InMemoryCache, profile: SeedProfile) {
  const seedData = buildSeedData(profile)

  cache.writeQuery({
    query: USERS_QUERY,
    data: {
      users: seedData.users,
    },
  })

  cache.writeQuery({
    query: POSTS_QUERY,
    data: {
      posts: seedData.posts,
    },
  })

  await storage.setItem('apollo-cache-persist', cache.extract())
}

async function seedStorageForLazy(storage: LocalForage, profile: SeedProfile) {
  const store = createLazyCacheStore({
    storage,
    ttl: 24 * 60 * 60 * 1000,
  })

  const seedData = buildSeedData(profile)

  const usersData = {
    users: seedData.users,
  }

  const postsData = {
    posts: seedData.posts,
  }

  await store.set('GetUsers:{}', usersData)
  await store.set('GetPosts:{}', postsData)
}

async function runDefaultFlow(profile: BenchmarkProfile): Promise<RunMetrics> {
  const seedProfile: SeedProfile = profile === 'large-reload' ? 'large' : 'standard'
  const seedData = buildSeedData(seedProfile)
  const storage = localforage.createInstance({
    name: 'apollo-comparison',
    storeName: profile === 'large-reload' ? 'default-mode-large' : 'default-mode',
  })

  await storage.clear()

  const seedCache = new InMemoryCache()
  await seedStorageForDefault(storage, seedCache, seedProfile)

  const cache = new InMemoryCache()
  const client = new ApolloClient({
    cache,
    link: createMockNetworkLink(seedData),
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
  const startupMemorySnapshot = captureMemorySnapshot()
  const startupMs = nowMs() - startupStart
  const startupCacheSizeBytes = safeJsonSize(cache.extract())

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
    profile,
    startupMs,
    firstQueryMs,
    startupCacheSizeBytes,
    fullCacheSizeBytes: safeJsonSize(cacheSnapshot),
    persistedEntryBytes: safeJsonSize(persistedSnapshot),
    startupMemorySnapshot,
    timestamp: new Date().toISOString(),
  }
}

async function runLazyFlow(profile: BenchmarkProfile): Promise<RunMetrics> {
  const seedProfile: SeedProfile = profile === 'large-reload' ? 'large' : 'standard'
  const seedData = buildSeedData(seedProfile)
  const storage = localforage.createInstance({
    name: 'apollo-comparison',
    storeName: profile === 'large-reload' ? 'lazy-mode-large' : 'lazy-mode',
  })

  await storage.clear()
  await seedStorageForLazy(storage, seedProfile)

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
    link: ApolloLink.from([lazyLink, createMockNetworkLink(seedData)]),
  })

  const startupStart = nowMs()
  await Promise.resolve()
  const startupMemorySnapshot = captureMemorySnapshot()
  const startupMs = nowMs() - startupStart
  const startupCacheSizeBytes = safeJsonSize(cache.extract())

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
    profile,
    startupMs,
    firstQueryMs,
    startupCacheSizeBytes,
    fullCacheSizeBytes: safeJsonSize(cacheSnapshot),
    persistedEntryBytes: safeJsonSize(usersEntry),
    startupMemorySnapshot,
    timestamp: new Date().toISOString(),
  }
}

function App() {
  const [results, setResults] = useState<RunMetrics[]>([])
  const [profile, setProfile] = useState<BenchmarkProfile>('standard')
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
    const defaultStartupCache = average(defaults.map((result) => result.startupCacheSizeBytes))
    const lazyStartupCache = average(lazies.map((result) => result.startupCacheSizeBytes))
    const defaultStartupHeapUsed = average(defaults.map((result) => result.startupMemorySnapshot.heapUsedBytes))
    const lazyStartupHeapUsed = average(lazies.map((result) => result.startupMemorySnapshot.heapUsedBytes))
    const defaultStartupTotalHeap = average(defaults.map((result) => result.startupMemorySnapshot.totalHeapBytes))
    const lazyStartupTotalHeap = average(lazies.map((result) => result.startupMemorySnapshot.totalHeapBytes))

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
      defaultStartupCache,
      lazyStartupCache,
      startupCacheDelta: defaultStartupCache - lazyStartupCache,
      defaultStartupHeapUsed,
      lazyStartupHeapUsed,
      startupHeapUsedDelta: defaultStartupHeapUsed - lazyStartupHeapUsed,
      defaultStartupTotalHeap,
      lazyStartupTotalHeap,
      startupTotalHeapDelta: defaultStartupTotalHeap - lazyStartupTotalHeap,
    }
  }, [results])

  const runComparison = useCallback(async (nextProfile: BenchmarkProfile) => {
    setRunning(true)
    setError(null)
    setResults([])
    setProfile(nextProfile)

    const totalRuns = getRunCount(nextProfile)

    try {
      const runs: RunMetrics[] = []

      for (let run = 0; run < totalRuns; run += 1) {
        runs.push(await runDefaultFlow(nextProfile))
        runs.push(await runLazyFlow(nextProfile))
      }

      setResults(runs)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
    } finally {
      setRunning(false)
    }
  }, [])

  const runModeOnly = useCallback(async (nextProfile: BenchmarkProfile, mode: Mode) => {
    setRunning(true)
    setError(null)
    setResults([])
    setProfile(nextProfile)

    const totalRuns = getRunCount(nextProfile)

    try {
      const runs: RunMetrics[] = []

      for (let run = 0; run < totalRuns; run += 1) {
        if (mode === 'default') {
          runs.push(await runDefaultFlow(nextProfile))
        } else {
          runs.push(await runLazyFlow(nextProfile))
        }
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

      <button className="run-button" disabled={running} onClick={() => runComparison('standard')}>
        {running ? 'Running benchmark...' : `Run ${TOTAL_RUNS}x comparison`}
      </button>
      <button className="run-button" disabled={running} onClick={() => runComparison('large-reload')}>
        {running ? 'Running benchmark...' : `Run ${LARGE_RELOAD_RUNS}x large reload test (~60MB)`}
      </button>
      <button className="run-button" disabled={running} onClick={() => runModeOnly('large-reload', 'default')}>
        {running ? 'Running benchmark...' : 'Run isolated large reload (default only)'}
      </button>
      <button className="run-button" disabled={running} onClick={() => runModeOnly('large-reload', 'lazy')}>
        {running ? 'Running benchmark...' : 'Run isolated large reload (lazy only)'}
      </button>

      {error ? <p className="error">Error: {error}</p> : null}

      <p>
        Active profile: <strong>{profile}</strong>
      </p>

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
        <article>
          <h2>Average Startup Cache (Reload)</h2>
          <p>default: {formatBytes(summary.defaultStartupCache)}</p>
          <p>lazy: {formatBytes(summary.lazyStartupCache)}</p>
          <p>delta: {formatBytes(summary.startupCacheDelta)} lower with lazy</p>
        </article>
        <article>
          <h2>Average Startup JS Heap Snapshot</h2>
          <p>default used heap: {formatBytes(summary.defaultStartupHeapUsed)}</p>
          <p>lazy used heap: {formatBytes(summary.lazyStartupHeapUsed)}</p>
          <p>used heap delta: {formatBytes(summary.startupHeapUsedDelta)} lower with lazy</p>
          <p>default total JS heap: {formatBytes(summary.defaultStartupTotalHeap)}</p>
          <p>lazy total JS heap: {formatBytes(summary.lazyStartupTotalHeap)}</p>
          <p>total heap delta: {formatBytes(summary.startupTotalHeapDelta)} lower with lazy</p>
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
              <th>startup cache</th>
              <th>cache size</th>
              <th>persisted size</th>
              <th>startup total JS heap</th>
              <th>profile</th>
              <th>timestamp</th>
            </tr>
          </thead>
          <tbody>
            {results.map((result, index) => (
              <tr key={`${result.mode}-${result.timestamp}-${index}`}>
                <td>{result.mode}</td>
                <td>{formatMs(result.startupMs)}</td>
                <td>{formatMs(result.firstQueryMs)}</td>
                <td>{formatBytes(result.startupCacheSizeBytes)}</td>
                <td>{formatBytes(result.fullCacheSizeBytes)}</td>
                <td>{formatBytes(result.persistedEntryBytes)}</td>
                <td>{formatBytes(result.startupMemorySnapshot.totalHeapBytes)}</td>
                <td>{result.profile}</td>
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
