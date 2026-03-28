const assert = require("assert");
const { createLazyCacheStore, createLazyCacheLink } = require("../dist");
const { generateCacheKey } = require("../dist/utils");

class MemoryStorage {
  constructor() {
    this.map = new Map();
  }

  async getItem(key) {
    return this.map.has(key) ? this.map.get(key) : null;
  }

  async setItem(key, value) {
    this.map.set(key, value);
  }

  async removeItem(key) {
    this.map.delete(key);
  }

  async clear() {
    this.map.clear();
  }
}

function makeOperation() {
  return {
    query: {
      definitions: [
        {
          kind: "OperationDefinition",
          operation: "query",
          name: { value: "GetUser" },
        },
      ],
    },
    variables: { id: "1" },
  };
}

class CacheStub {
  constructor() {
    this.value = null;
  }

  readQuery() {
    return this.value;
  }

  writeQuery({ data }) {
    this.value = data;
  }
}

async function run() {
  const storage = new MemoryStorage();
  const store = createLazyCacheStore({ storage });
  const cache = new CacheStub();

  const link = createLazyCacheLink({ cache, store });
  const operation = makeOperation();

  const received = [];

  await new Promise((resolve, reject) => {
    link
      .request(operation, () => ({
        subscribe(observer) {
          observer.next({ data: { user: { id: "1", name: "Ada" } } });
          observer.complete();
          return { unsubscribe() {} };
        },
      }))
      .subscribe({
        next(result) {
          received.push(result);
        },
        error: reject,
        complete: resolve,
      });
  });

  assert.equal(received.length, 1);
  const storedValue = await storage.getItem(
    generateCacheKey("GetUser", { id: "1" }),
  );
  assert.ok(storedValue, "Expected persisted value to be set");

  const entry =
    typeof storedValue === "string" ? JSON.parse(storedValue) : storedValue;
  assert.deepEqual(entry.data, { user: { id: "1", name: "Ada" } });
}

async function runLegacyRawValueReadTest() {
  const storage = new MemoryStorage();
  const store = createLazyCacheStore({ storage });

  await storage.setItem(
    generateCacheKey("GetUser", { id: "legacy" }),
    JSON.stringify({ user: { id: "legacy", name: "Legacy Ada" } }),
  );

  const restored = await store.get(generateCacheKey("GetUser", { id: "legacy" }));
  assert.deepEqual(restored, {
    user: { id: "legacy", name: "Legacy Ada" },
  });
}

run()
  .then(runLegacyRawValueReadTest)
  .then(() => {
    console.log("Apollo compatibility smoke test passed.");
  })
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
