const path = require('path')
const fs = require('fs')
const { spawnSync } = require('child_process')
const { ApolloClient, InMemoryCache, ApolloLink, Observable, gql } = require('@apollo/client/core')
const { CachePersistor } = require('apollo3-cache-persist')

const distRoot = path.resolve(__dirname, '../../dist')
const distIndexPath = path.join(distRoot, 'index.js')

if (!fs.existsSync(distIndexPath)) {
  console.error('Missing build output at dist/index.js. Run `npm run build` from repository root first.')
  process.exit(1)
}

const { createLazyCacheStore, createLazyCacheLink } = require(path.join(distRoot, 'index.js'))

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

const RUNS = 3
const LARGE_POSTS_COUNT = 12000
const LARGE_USERS_COUNT = 4000
const LARGE_USER_TEXT = 'U'.repeat(2048)
const LARGE_POST_TEXT = 'P'.repeat(4096)
const IS_WORKER = process.argv.includes('--worker')
const WORKER_MODE_ARG = process.argv.find((arg) => arg.startsWith('--mode='))
const WORKER_MODE = WORKER_MODE_ARG ? WORKER_MODE_ARG.split('=')[1] : null

class AsyncStorageLike {
  constructor() {
    this.map = new Map()
  }

  async getItem(key) {
    return this.map.has(key) ? this.map.get(key) : null
  }

  async setItem(key, value) {
    this.map.set(key, typeof value === 'string' ? value : JSON.stringify(value))
  }

  async removeItem(key) {
    this.map.delete(key)
  }

  async clear() {
    this.map.clear()
  }
}

function nowMs() {
  return Number(process.hrtime.bigint()) / 1e6
}

function safeJsonSize(value) {
  try {
    return JSON.stringify(value).length
  } catch {
    return 0
  }
}

function avg(values) {
  if (values.length === 0) return 0
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function toMb(bytes) {
  return bytes / (1024 * 1024)
}

function captureMemorySnapshot() {
  const usage = process.memoryUsage()
  return {
    rssBytes: usage.rss,
    heapTotalBytes: usage.heapTotal,
    heapUsedBytes: usage.heapUsed,
    externalBytes: usage.external,
  }
}

function forceGc(cycles = 3) {
  if (typeof global.gc !== 'function') return false
  for (let i = 0; i < cycles; i += 1) {
    global.gc()
  }
  return true
}

function subtractMemory(after, before) {
  return {
    rssBytes: after.rssBytes - before.rssBytes,
    heapTotalBytes: after.heapTotalBytes - before.heapTotalBytes,
    heapUsedBytes: after.heapUsedBytes - before.heapUsedBytes,
    externalBytes: after.externalBytes - before.externalBytes,
  }
}

function buildLargeSeedData() {
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

function createMockNetworkLink(seedData) {
  return new ApolloLink(
    (operation) =>
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

async function seedDefaultStorage(storage, cache, seedData) {
  cache.writeQuery({
    query: USERS_QUERY,
    data: { users: seedData.users },
  })
  cache.writeQuery({
    query: POSTS_QUERY,
    data: { posts: seedData.posts },
  })
  await storage.setItem('apollo-cache-persist', cache.extract())
}

async function seedLazyStorage(storage, seedData) {
  const store = createLazyCacheStore({ storage, ttl: 24 * 60 * 60 * 1000 })
  await store.set('GetUsers:{}', { users: seedData.users })
  await store.set('GetPosts:{}', { posts: seedData.posts })
}

async function runDefaultFlow(seedData) {
  forceGc()
  const storage = new AsyncStorageLike()
  const seedCache = new InMemoryCache()
  await seedDefaultStorage(storage, seedCache, seedData)

  const cache = new InMemoryCache()
  const client = new ApolloClient({
    cache,
    link: createMockNetworkLink(seedData),
  })

  const startupStart = nowMs()
  const startupMemoryBefore = captureMemorySnapshot()
  const persistor = new CachePersistor({
    cache,
    storage,
    key: 'apollo-cache-persist',
    trigger: false,
    debug: false,
  })
  await persistor.restore()
  forceGc()
  const startupMemoryAfter = captureMemorySnapshot()
  const startupMs = nowMs() - startupStart

  const startupCacheSizeBytes = safeJsonSize(cache.extract())

  const firstQueryStart = nowMs()
  await client.query({
    query: USERS_QUERY,
    variables: {},
    fetchPolicy: 'cache-first',
  })
  const firstQueryMs = nowMs() - firstQueryStart

  const cacheSnapshot = cache.extract()
  const persistedSnapshot = await storage.getItem('apollo-cache-persist')

  return {
    mode: 'default',
    startupMs,
    firstQueryMs,
    startupCacheSizeBytes,
    fullCacheSizeBytes: safeJsonSize(cacheSnapshot),
    persistedEntryBytes: safeJsonSize(persistedSnapshot),
    startupMemoryDelta: subtractMemory(startupMemoryAfter, startupMemoryBefore),
    startupMemorySnapshot: startupMemoryAfter,
  }
}

async function runLazyFlow(seedData) {
  forceGc()
  const storage = new AsyncStorageLike()
  await seedLazyStorage(storage, seedData)

  const cache = new InMemoryCache()
  const store = createLazyCacheStore({
    storage,
    ttl: 24 * 60 * 60 * 1000,
  })

  const lazyLink = createLazyCacheLink({ cache, store })
  const client = new ApolloClient({
    cache,
    link: ApolloLink.from([lazyLink, createMockNetworkLink(seedData)]),
  })

  const startupStart = nowMs()
  const startupMemoryBefore = captureMemorySnapshot()
  await Promise.resolve()
  forceGc()
  const startupMemoryAfter = captureMemorySnapshot()
  const startupMs = nowMs() - startupStart
  const startupCacheSizeBytes = safeJsonSize(cache.extract())

  const firstQueryStart = nowMs()
  await client.query({
    query: USERS_QUERY,
    variables: {},
    fetchPolicy: 'cache-first',
  })
  const firstQueryMs = nowMs() - firstQueryStart

  const cacheSnapshot = cache.extract()
  const usersEntry = await storage.getItem('GetUsers:{}')

  return {
    mode: 'lazy',
    startupMs,
    firstQueryMs,
    startupCacheSizeBytes,
    fullCacheSizeBytes: safeJsonSize(cacheSnapshot),
    persistedEntryBytes: safeJsonSize(usersEntry),
    startupMemoryDelta: subtractMemory(startupMemoryAfter, startupMemoryBefore),
    startupMemorySnapshot: startupMemoryAfter,
  }
}

function runWorker(mode) {
  const worker = spawnSync(process.execPath, ['--expose-gc', __filename, '--worker', `--mode=${mode}`], {
    encoding: 'utf8',
    cwd: __dirname,
  })

  if (worker.status !== 0) {
    throw new Error(worker.stderr || worker.stdout || `Worker failed for mode=${mode}`)
  }

  const output = (worker.stdout || '').trim().split('\n').filter(Boolean).at(-1)
  if (!output) {
    throw new Error(`Worker returned no JSON output for mode=${mode}`)
  }

  return JSON.parse(output)
}

async function runWorkerMode() {
  const seedData = buildLargeSeedData()
  const result = WORKER_MODE === 'default' ? await runDefaultFlow(seedData) : await runLazyFlow(seedData)
  console.log(JSON.stringify(result))
}

async function runParentMode() {
  const all = []

  for (let run = 0; run < RUNS; run += 1) {
    all.push(runWorker('default'))
    all.push(runWorker('lazy'))
  }

  const defaults = all.filter((result) => result.mode === 'default')
  const lazies = all.filter((result) => result.mode === 'lazy')

  const summary = {
    runs: RUNS,
    profile: 'large-reload',
    average: {
      default: {
        startupMs: avg(defaults.map((result) => result.startupMs)),
        firstQueryMs: avg(defaults.map((result) => result.firstQueryMs)),
        startupCacheSizeBytes: avg(defaults.map((result) => result.startupCacheSizeBytes)),
        fullCacheSizeBytes: avg(defaults.map((result) => result.fullCacheSizeBytes)),
        persistedEntryBytes: avg(defaults.map((result) => result.persistedEntryBytes)),
        startupMemoryDelta: {
          rssBytes: avg(defaults.map((result) => result.startupMemoryDelta.rssBytes)),
          heapTotalBytes: avg(defaults.map((result) => result.startupMemoryDelta.heapTotalBytes)),
          heapUsedBytes: avg(defaults.map((result) => result.startupMemoryDelta.heapUsedBytes)),
          externalBytes: avg(defaults.map((result) => result.startupMemoryDelta.externalBytes)),
        },
        startupMemorySnapshot: {
          rssBytes: avg(defaults.map((result) => result.startupMemorySnapshot.rssBytes)),
          heapTotalBytes: avg(defaults.map((result) => result.startupMemorySnapshot.heapTotalBytes)),
          heapUsedBytes: avg(defaults.map((result) => result.startupMemorySnapshot.heapUsedBytes)),
          externalBytes: avg(defaults.map((result) => result.startupMemorySnapshot.externalBytes)),
        },
      },
      lazy: {
        startupMs: avg(lazies.map((result) => result.startupMs)),
        firstQueryMs: avg(lazies.map((result) => result.firstQueryMs)),
        startupCacheSizeBytes: avg(lazies.map((result) => result.startupCacheSizeBytes)),
        fullCacheSizeBytes: avg(lazies.map((result) => result.fullCacheSizeBytes)),
        persistedEntryBytes: avg(lazies.map((result) => result.persistedEntryBytes)),
        startupMemoryDelta: {
          rssBytes: avg(lazies.map((result) => result.startupMemoryDelta.rssBytes)),
          heapTotalBytes: avg(lazies.map((result) => result.startupMemoryDelta.heapTotalBytes)),
          heapUsedBytes: avg(lazies.map((result) => result.startupMemoryDelta.heapUsedBytes)),
          externalBytes: avg(lazies.map((result) => result.startupMemoryDelta.externalBytes)),
        },
        startupMemorySnapshot: {
          rssBytes: avg(lazies.map((result) => result.startupMemorySnapshot.rssBytes)),
          heapTotalBytes: avg(lazies.map((result) => result.startupMemorySnapshot.heapTotalBytes)),
          heapUsedBytes: avg(lazies.map((result) => result.startupMemorySnapshot.heapUsedBytes)),
          externalBytes: avg(lazies.map((result) => result.startupMemorySnapshot.externalBytes)),
        },
      },
    },
    deltaDefaultMinusLazy: {
      startupMs: avg(defaults.map((result) => result.startupMs)) - avg(lazies.map((result) => result.startupMs)),
      firstQueryMs: avg(defaults.map((result) => result.firstQueryMs)) - avg(lazies.map((result) => result.firstQueryMs)),
      startupCacheSizeBytes:
        avg(defaults.map((result) => result.startupCacheSizeBytes)) -
        avg(lazies.map((result) => result.startupCacheSizeBytes)),
      persistedEntryBytes:
        avg(defaults.map((result) => result.persistedEntryBytes)) -
        avg(lazies.map((result) => result.persistedEntryBytes)),
      startupMemoryDelta: {
        rssBytes:
          avg(defaults.map((result) => result.startupMemoryDelta.rssBytes)) -
          avg(lazies.map((result) => result.startupMemoryDelta.rssBytes)),
        heapTotalBytes:
          avg(defaults.map((result) => result.startupMemoryDelta.heapTotalBytes)) -
          avg(lazies.map((result) => result.startupMemoryDelta.heapTotalBytes)),
        heapUsedBytes:
          avg(defaults.map((result) => result.startupMemoryDelta.heapUsedBytes)) -
          avg(lazies.map((result) => result.startupMemoryDelta.heapUsedBytes)),
        externalBytes:
          avg(defaults.map((result) => result.startupMemoryDelta.externalBytes)) -
          avg(lazies.map((result) => result.startupMemoryDelta.externalBytes)),
      },
      startupMemorySnapshot: {
        heapTotalBytes:
          avg(defaults.map((result) => result.startupMemorySnapshot.heapTotalBytes)) -
          avg(lazies.map((result) => result.startupMemorySnapshot.heapTotalBytes)),
      },
    },
    startupCacheSizeMb: {
      default: toMb(avg(defaults.map((result) => result.startupCacheSizeBytes))),
      lazy: toMb(avg(lazies.map((result) => result.startupCacheSizeBytes))),
    },
  }

  console.log(JSON.stringify(summary, null, 2))
}

;(async () => {
  if (IS_WORKER) {
    if (WORKER_MODE !== 'default' && WORKER_MODE !== 'lazy') {
      throw new Error('Worker mode must be default or lazy')
    }
    await runWorkerMode()
    return
  }
  await runParentMode()
})().catch((error) => {
  console.error(error)
  process.exit(1)
})
