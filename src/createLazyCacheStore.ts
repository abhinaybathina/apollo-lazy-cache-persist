import { LazyCacheStore, LazyCacheStoreConfig } from "./types";

export function createLazyCacheStore(
  config: LazyCacheStoreConfig,
): LazyCacheStore {
  const { storage, ttl, maxSize, serialize = true } = config;

  let disabled = false;

  async function get(key: string) {
    if (disabled) return null;

    try {
      let entry = await storage.getItem(key);

      if (!entry) return null;

      if (serialize && typeof entry === "string") {
        entry = JSON.parse(entry);
      }

      if (ttl && Date.now() - entry.timestamp > ttl) {
        await storage.removeItem?.(key);
        return null;
      }

      return entry.data;
    } catch (err) {
      console.warn("LazyCacheStore: get failed", err);
      return null;
    }
  }

  async function set(key: string, data: any) {
    if (disabled) return;

    try {
      const entry = {
        data,
        timestamp: Date.now(),
      };

      const value = serialize ? JSON.stringify(entry) : entry;

      if (maxSize) {
        const size =
          typeof value === "string"
            ? value.length
            : JSON.stringify(value).length;

        if (size > maxSize) {
          console.warn(
            `LazyCacheStore: entry for key "${key}" exceeds maxSize and will not be persisted`,
          );
          return;
        }
      }

      // 🔹 multi-tab safety check
      const existing = await storage.getItem(key);

      if (existing) {
        let parsed = existing;

        if (serialize && typeof existing === "string") {
          parsed = JSON.parse(existing);
        }

        if (parsed?.timestamp && parsed.timestamp > entry.timestamp) {
          return;
        }
      }

      await storage.setItem(key, value);
    } catch (err) {
      console.warn("LazyCacheStore: set failed", err);
    }
  }

  async function purge() {
    try {
      await storage.clear?.();
    } catch (err) {
      console.warn("LazyCacheStore: purge failed", err);
    }
  }

  function disable() {
    disabled = true;
  }

  return {
    get,
    set,
    purge,
    disable,
  };
}
