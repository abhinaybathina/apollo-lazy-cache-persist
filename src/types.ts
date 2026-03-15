export interface LazyCacheStorage {
  getItem(key: string): Promise<any>;
  setItem(key: string, value: any): Promise<void>;
  removeItem?(key: string): Promise<void>;
  clear?(): Promise<void>;
}

export interface LazyCacheStoreConfig {
  storage: LazyCacheStorage;
  ttl?: number;
  maxSize?: number;
  serialize?: boolean;
}

export interface LazyCacheLinkConfig {
  cache: any;
  store: LazyCacheStore;
  hash?: (value: string) => string;
}

export interface LazyCacheStore {
  get(key: string): Promise<any | null>;
  set(key: string, data: any): Promise<void>;
  purge(): Promise<void>;
  disable(): void;
}
