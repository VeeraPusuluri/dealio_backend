import Redis from 'ioredis';

// Shared Redis client. When REDIS_URL is unset, or when the initial connection
// fails, this is null and callers fall back to in-memory storage automatically.

let redis: Redis | null = null;

if (process.env.REDIS_URL) {
  let warnedDown = false;

  const client = new Redis(process.env.REDIS_URL, {
    maxRetriesPerRequest: 0,
    enableOfflineQueue: false,
    // Retry up to 3 times (covers transient TCP hiccups), then stop so a
    // missing local Redis doesn't spam the console every few seconds.
    retryStrategy: (times) => {
      if (times >= 3) {
        if (!warnedDown) {
          warnedDown = true;
          console.warn(
            '[Redis] unreachable after 3 attempts — falling back to in-memory ' +
            'OTP store. Start Redis or unset REDIS_URL to use persistent storage.'
          );
        }
        return null; // stop retrying
      }
      return Math.min(times * 300, 1000);
    },
  });

  client.on('connect', () => {
    warnedDown = false;
    console.log('[Redis] connected');
  });

  // Only log the first error per outage; retryStrategy handles the fallback message.
  client.on('error', (err: Error) => {
    if (!warnedDown) console.error('[Redis] error:', err.message);
  });

  redis = client;
}

// True once Redis has successfully connected (status === 'ready').
// Checked dynamically by otpStore so it falls back to in-memory if Redis
// never connects or goes away after startup.
export function isRedisReady(): boolean {
  return redis?.status === 'ready';
}

export const redisEnabled = redis !== null;
export default redis;
