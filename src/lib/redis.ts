import { Redis } from "@upstash/redis";

// In-memory fallback map for development/testing when Upstash credentials are not yet configured
interface CacheEntry {
  value: string;
  expiresAt: number;
}
const memoryStore = new Map<string, CacheEntry>();

const isUpstashConfigured = Boolean(
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
);

export const redis = isUpstashConfigured
  ? new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL!,
      token: process.env.UPSTASH_REDIS_REST_TOKEN!,
    })
  : null;

/**
 * Universal key-value store client with TTL support that seamlessly works with Upstash Redis
 * or fallback memory store.
 */
export const sessionStore = {
  async set(key: string, value: unknown, exSeconds?: number): Promise<void> {
    const serialized = JSON.stringify(value);
    if (redis) {
      if (exSeconds) {
        await redis.set(key, serialized, { ex: exSeconds });
      } else {
        await redis.set(key, serialized);
      }
      return;
    }

    const expiresAt = exSeconds ? Date.now() + exSeconds * 1000 : Infinity;
    memoryStore.set(key, { value: serialized, expiresAt });
  },

  async get<T>(key: string): Promise<T | null> {
    if (redis) {
      const data = await redis.get<string | object>(key);
      if (!data) return null;
      if (typeof data === "string") {
        try {
          return JSON.parse(data) as T;
        } catch {
          return data as T;
        }
      }
      return data as T;
    }

    const entry = memoryStore.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      memoryStore.delete(key);
      return null;
    }
    return JSON.parse(entry.value) as T;
  },

  async del(key: string): Promise<void> {
    if (redis) {
      await redis.del(key);
      return;
    }
    memoryStore.delete(key);
  },

  async pushSignal(roomId: string, envelope: unknown): Promise<void> {
    const listKey = `signals:${roomId}`;
    if (redis) {
      await redis.rpush(listKey, JSON.stringify(envelope));
      await redis.expire(listKey, 600);
      return;
    }
    const current = (await this.get<unknown[]>(listKey)) || [];
    current.push(envelope);
    await this.set(listKey, current, 600);
  },

  async popSignals(roomId: string, afterTimestamp: number = 0): Promise<unknown[]> {
    const listKey = `signals:${roomId}`;
    if (redis) {
      const rawList = await redis.lrange<string>(listKey, 0, -1);
      if (!rawList || rawList.length === 0) return [];
      return rawList
        .map((item) => (typeof item === "string" ? JSON.parse(item) : item))
        .filter((item: { timestamp: number }) => item.timestamp > afterTimestamp);
    }

    const current = (await this.get<Array<{ timestamp: number }>>(listKey)) || [];
    return current.filter((item) => item.timestamp > afterTimestamp);
  },
};
