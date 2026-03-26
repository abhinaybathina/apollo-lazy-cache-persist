const { ApolloClient, InMemoryCache, ApolloLink, Observable, gql } = require('@apollo/client/core')
const { CachePersistor } = require('apollo3-cache-persist')
const path = require('path')
const { createLazyCacheStore } = require(path.resolve(__dirname, '../../dist/createLazyCacheStore.js'))
const { generateCacheKey } = require(path.resolve(__dirname, '../../dist/utils.js'))

class MemStore {
  constructor() { this.map = new Map() }
  getItem(k){ return this.map.has(k) ? this.map.get(k) : null }
  setItem(k,v){ this.map.set(k,v) }
  removeItem(k){ this.map.delete(k) }
  clear(){ this.map.clear() }
}

const USERS_QUERY = gql`query GetUsers { users { id name email company { name } } }`
const POSTS_QUERY = gql`query GetPosts { posts { id title body } }`

function buildUsers(n=300){
  return { users: Array.from({length:n}, (_,i)=>({
    __typename:'User', id:String(i+1), name:`Seed User ${i+1}`,
    email:`seed${i+1}@example.com`, company:{__typename:'Company', name:`Seed Company ${(i%20)+1}`}
  })) }
}
function buildPosts(n=400){
  return { posts: Array.from({length:n}, (_,i)=>({
    __typename:'Post', id:String(i+1), title:`Seed Post ${i+1}`,
    body:'Lorem ipsum dolor sit amet, consectetur adipiscing elit. '.repeat(4)
  })) }
}

function nowMs(){ return Number(process.hrtime.bigint())/1e6 }
function sizeOf(v){ try { return JSON.stringify(v).length } catch { return 0 } }
function avg(a){ return a.reduce((s,v)=>s+v,0)/a.length }

async function seedDefault(storage){
  const cache = new InMemoryCache()
  cache.writeQuery({ query: USERS_QUERY, data: buildUsers() })
  cache.writeQuery({ query: POSTS_QUERY, data: buildPosts() })
  const persistor = new CachePersistor({ cache, storage, key:'apollo-cache-persist', trigger:false, debug:false })
  await persistor.persist()
}

function mockNetworkLink(){
  return new ApolloLink((operation)=> new Observable((observer)=>{
    const op = operation.operationName
    if(op === 'GetUsers') observer.next({ data: buildUsers(50) })
    else if(op === 'GetPosts') observer.next({ data: buildPosts(60) })
    else observer.next({ data: {} })
    observer.complete()
  }))
}

async function runDefault(){
  const storage = new MemStore()
  await seedDefault(storage)

  const cache = new InMemoryCache()
  const client = new ApolloClient({ cache, link: mockNetworkLink() })

  const t0 = nowMs()
  const persistor = new CachePersistor({ cache, storage, key:'apollo-cache-persist', trigger:false, debug:false })
  await persistor.restore()
  const startupMs = nowMs() - t0

  const q0 = nowMs()
  await client.query({ query: USERS_QUERY, fetchPolicy:'cache-first' })
  const firstQueryMs = nowMs() - q0

  return {
    mode:'default', startupMs, firstQueryMs,
    fullCacheSizeBytes: sizeOf(cache.extract()),
    persistedEntryBytes: sizeOf(storage.getItem('apollo-cache-persist')),
  }
}

async function runLazy(){
  const storage = new MemStore()
  const store = createLazyCacheStore({ storage, ttl: 24*60*60*1000 })
  await store.set(generateCacheKey('GetUsers', {}), buildUsers())
  await store.set(generateCacheKey('GetPosts', {}), buildPosts())

  const cache = new InMemoryCache()
  const lazyLink = new ApolloLink((operation, forward)=>{
    const key = generateCacheKey(operation.operationName, operation.variables)
    let networkResolved = false

    Promise.resolve(store.get(key)).then((data)=>{
      if(!data || networkResolved) return
      try {
        const existing = cache.readQuery({ query: operation.query, variables: operation.variables })
        if(!existing){ cache.writeQuery({ query: operation.query, variables: operation.variables, data }) }
      } catch {
        try { cache.writeQuery({ query: operation.query, variables: operation.variables, data }) } catch {}
      }
    })

    return new Observable((observer)=>{
      const sub = forward(operation).subscribe({
        next: (result)=>{
          networkResolved = true
          if(result && result.data) store.set(key, result.data)
          observer.next(result)
        },
        error: (e)=>observer.error(e),
        complete: ()=>observer.complete(),
      })
      return ()=>sub.unsubscribe()
    })
  })

  const client = new ApolloClient({ cache, link: ApolloLink.from([lazyLink, mockNetworkLink()]) })

  const t0 = nowMs()
  await Promise.resolve()
  const startupMs = nowMs() - t0

  const q0 = nowMs()
  await client.query({ query: USERS_QUERY, fetchPolicy:'cache-first' })
  const firstQueryMs = nowMs() - q0

  return {
    mode:'lazy', startupMs, firstQueryMs,
    fullCacheSizeBytes: sizeOf(cache.extract()),
    persistedEntryBytes: sizeOf(storage.getItem(generateCacheKey('GetUsers', {}))),
  }
}

;(async ()=>{
  const runs = 10
  const all = []
  for(let i=0;i<runs;i++) { all.push(await runDefault()); all.push(await runLazy()) }
  const d = all.filter(x=>x.mode==='default')
  const l = all.filter(x=>x.mode==='lazy')

  const out = {
    runs,
    average: {
      default: {
        startupMs: avg(d.map(x=>x.startupMs)),
        firstQueryMs: avg(d.map(x=>x.firstQueryMs)),
        fullCacheSizeBytes: avg(d.map(x=>x.fullCacheSizeBytes)),
        persistedEntryBytes: avg(d.map(x=>x.persistedEntryBytes)),
      },
      lazy: {
        startupMs: avg(l.map(x=>x.startupMs)),
        firstQueryMs: avg(l.map(x=>x.firstQueryMs)),
        fullCacheSizeBytes: avg(l.map(x=>x.fullCacheSizeBytes)),
        persistedEntryBytes: avg(l.map(x=>x.persistedEntryBytes)),
      }
    },
    deltaDefaultMinusLazy: {
      startupMs: avg(d.map(x=>x.startupMs)) - avg(l.map(x=>x.startupMs)),
      firstQueryMs: avg(d.map(x=>x.firstQueryMs)) - avg(l.map(x=>x.firstQueryMs)),
      persistedEntryBytes: avg(d.map(x=>x.persistedEntryBytes)) - avg(l.map(x=>x.persistedEntryBytes)),
    }
  }
  console.log(JSON.stringify(out,null,2))
})().catch((e)=>{ console.error(e); process.exit(1) })
