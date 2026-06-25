import Redis from 'ioredis';

// Shared Redis client, configured via REDIS_URL
// (e.g. redis://localhost:6379, or rediss://host:6379 for TLS).
//
// When REDIS_URL is unset, this is null and callers fall back to in-memory
// storage. In-memory is fine for a single local dev process, but it does NOT
// survive restarts and is NOT shared across instances — set REDIS_URL in any
// environment that runs more than one backend instance (e.g. production).
let redis: Redis | null = null;

if (process.env.REDIS_URL) {
  redis = new Redis(process.env.REDIS_URL, {
    // Fail fast instead of queueing commands forever when Redis is unreachable.
    maxRetriesPerRequest: 2,
    retryStrategy: (times) => Math.min(times * 200, 2000),
  });

  redis.on('connect', () => console.log('[Redis] connected'));
  redis.on('error', (err) => console.error('[Redis] error:', err.message));
}

export const redisEnabled = redis !== null;
export default redis;
