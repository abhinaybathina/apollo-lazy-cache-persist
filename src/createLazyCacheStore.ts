import { LazyCacheStore, LazyCacheStoreConfig } from "./types";

type StoreEntry = {
  data: any;
  timestamp?: number;
};

function normalizeEntry(raw: any, serialize: boolean): StoreEntry | null {
  if (raw == null) {
    return null;
  }

  let parsed = raw;

  if (serialize && typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
  }

  if (parsed && typeof parsed === "object" && "data" in parsed) {
    return {
      data: parsed.data,
      timestamp: typeof parsed.timestamp === "number" ? parsed.timestamp : undefined,
    };
  }

  return {
    data: parsed,
  };
}

export function createLazyCacheStore(
  config: LazyCacheStoreConfig,
): LazyCacheStore {
  const { storage, ttl, maxSize, serialize = true } = config;

  let disabled = false;

  async function get(key: string) {
    if (disabled) return null;

    try {
      const entry = normalizeEntry(await storage.getItem(key), serialize);

      if (!entry) return null;

      if (ttl && typeof entry.timestamp === "number" && Date.now() - entry.timestamp > ttl) {
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
      const existing = normalizeEntry(await storage.getItem(key), serialize);

      if (existing) {
        if (
          typeof existing.timestamp === "number" &&
          existing.timestamp > entry.timestamp
        ) {
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
