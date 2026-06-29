import redis, { redisEnabled, isRedisReady } from '../utils/redis';

// Shared storage for one-time passcodes and send rate-limiting.
//
// Two interchangeable implementations sit behind one async interface:
//   • Redis      — used when REDIS_URL is set (restart- and multi-instance-safe)
//   • in-memory  — automatic fallback for single-process local dev
//
// Rate-limit counters use a fixed window (counter + TTL) in both modes so the
// caps behave identically whether or not Redis is configured.

export interface OtpRecord {
  code: string;
  attempts: number;
}

export interface OtpStore {
  /** Store a fresh code for `phone`, resetting attempts, expiring after `ttlMs`. */
  saveOtp(phone: string, code: string, ttlMs: number): Promise<void>;
  /** Return the live record for `phone`, or null if none/expired. */
  readOtp(phone: string): Promise<OtpRecord | null>;
  /** Increment the verify-attempt counter and return the new value. */
  bumpAttempts(phone: string): Promise<number>;
  /** Delete any code stored for `phone`. */
  clearOtp(phone: string): Promise<void>;

  /** Milliseconds left on the resend cooldown for `key` (0 if none). */
  cooldownRemainingMs(key: string): Promise<number>;
  /** Start/refresh the resend cooldown for `key`. */
  startCooldown(key: string, ttlMs: number): Promise<void>;
  /** Number of sends recorded for `key` in the current window. */
  sendCount(key: string): Promise<number>;
  /** Record one send against `key`'s rolling window of length `windowMs`. */
  recordSend(key: string, windowMs: number): Promise<void>;
}

// ── Redis implementation ─────────────────────────────────────────────
const REC = (p: string) => `otp:rec:${p}`;   // hash: { code, attempts }
const CD = (k: string) => `otp:cd:${k}`;      // cooldown marker (TTL only)
const CNT = (k: string) => `otp:cnt:${k}`;    // send counter (TTL = window)

const redisStore: OtpStore = {
  async saveOtp(phone, code, ttlMs) {
    const key = REC(phone);
    await redis!
      .multi()
      .del(key)
      .hset(key, 'code', code, 'attempts', '0')
      .pexpire(key, ttlMs)
      .exec();
  },
  async readOtp(phone) {
    const data = await redis!.hgetall(REC(phone));
    if (!data || !data.code) return null;
    return { code: data.code, attempts: parseInt(data.attempts ?? '0', 10) };
  },
  async bumpAttempts(phone) {
    return redis!.hincrby(REC(phone), 'attempts', 1);
  },
  async clearOtp(phone) {
    await redis!.del(REC(phone));
  },
  async cooldownRemainingMs(key) {
    const ttl = await redis!.pttl(CD(key));
    return ttl > 0 ? ttl : 0;
  },
  async startCooldown(key, ttlMs) {
    await redis!.set(CD(key), '1', 'PX', ttlMs);
  },
  async sendCount(key) {
    const v = await redis!.get(CNT(key));
    return v ? parseInt(v, 10) : 0;
  },
  async recordSend(key, windowMs) {
    const k = CNT(key);
    const n = await redis!.incr(k);
    if (n === 1) await redis!.pexpire(k, windowMs);
  },
};

// ── In-memory fallback ───────────────────────────────────────────────
interface MemOtp { code: string; attempts: number; expiresAt: number; }
const memOtps = new Map<string, MemOtp>();
const memCooldown = new Map<string, number>();              // key -> expiresAt
const memCount = new Map<string, { n: number; resetAt: number }>();

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of memOtps) if (v.expiresAt < now) memOtps.delete(k);
  for (const [k, exp] of memCooldown) if (exp < now) memCooldown.delete(k);
  for (const [k, c] of memCount) if (c.resetAt < now) memCount.delete(k);
}, 10 * 60 * 1000).unref();

const memStore: OtpStore = {
  async saveOtp(phone, code, ttlMs) {
    memOtps.set(phone, { code, attempts: 0, expiresAt: Date.now() + ttlMs });
  },
  async readOtp(phone) {
    const e = memOtps.get(phone);
    if (!e || e.expiresAt < Date.now()) {
      memOtps.delete(phone);
      return null;
    }
    return { code: e.code, attempts: e.attempts };
  },
  async bumpAttempts(phone) {
    const e = memOtps.get(phone);
    if (!e) return 0;
    e.attempts += 1;
    return e.attempts;
  },
  async clearOtp(phone) {
    memOtps.delete(phone);
  },
  async cooldownRemainingMs(key) {
    const exp = memCooldown.get(key);
    if (!exp) return 0;
    const rem = exp - Date.now();
    if (rem <= 0) {
      memCooldown.delete(key);
      return 0;
    }
    return rem;
  },
  async startCooldown(key, ttlMs) {
    memCooldown.set(key, Date.now() + ttlMs);
  },
  async sendCount(key) {
    const e = memCount.get(key);
    if (!e || e.resetAt < Date.now()) return 0;
    return e.n;
  },
  async recordSend(key, windowMs) {
    const now = Date.now();
    const e = memCount.get(key);
    if (!e || e.resetAt < now) {
      memCount.set(key, { n: 1, resetAt: now + windowMs });
    } else {
      e.n += 1;
    }
  },
};

// Proxy that selects the backend dynamically: uses Redis when it's actually
// connected and ready, falls back to in-memory otherwise. This means a missing
// local Redis never breaks OTP flow — it just uses the in-memory store.
export const otpStore: OtpStore = new Proxy({} as OtpStore, {
  get(_target, prop: keyof OtpStore) {
    const store = (redisEnabled && isRedisReady()) ? redisStore : memStore;
    return store[prop];
  },
});

console.log(`[OtpStore] backend: ${redisEnabled ? 'Redis (when connected) / in-memory fallback' : 'in-memory'}`);
