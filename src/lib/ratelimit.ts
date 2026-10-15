import { Ratelimit } from "@upstash/ratelimit";
import { redis } from "./redis";

// Fallback in-memory rate limiter for dev/test
const ipHits = new Map<string, { count: number; resetAt: number }>();

export const ratelimit = redis
  ? new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(20, "1 m"),
      analytics: false,
    })
  : {
      async limit(identifier: string) {
        const now = Date.now();
        const record = ipHits.get(identifier);
        if (!record || now > record.resetAt) {
          ipHits.set(identifier, { count: 1, resetAt: now + 60000 });
          return { success: true, limit: 20, remaining: 19, reset: now + 60000 };
        }
        if (record.count >= 30) {
          return { success: false, limit: 20, remaining: 0, reset: record.resetAt };
        }
        record.count++;
        return { success: true, limit: 20, remaining: 20 - record.count, reset: record.resetAt };
      },
    };
