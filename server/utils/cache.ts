import logger from "./logger";

// Standard TTL: 24 hours (86400 seconds)
const DEFAULT_TTL = 86400;

interface CacheItem<T> {
  value: T;
  expiry: number;
}

class HybridCache {
  private memoryStore = new Map<string, CacheItem<any>>();
  private redisClient: any = null;
  private isRedisConnected = false;

  constructor() {
    this.initializeRedis();
  }

  private async initializeRedis() {
    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl || redisUrl.trim() === "" || redisUrl === "undefined" || redisUrl === "null" || (!redisUrl.startsWith("redis://") && !redisUrl.startsWith("rediss://"))) {
      logger.info("REDIS_URL is not configured or is invalid. Using high-performance In-Memory Cache with TTL.");
      return;
    }

    try {
      // Dynamically load redis to avoid build issues if redis is not pre-installed
      const { createClient } = await import("redis");
      this.redisClient = createClient({ url: redisUrl });
      
      this.redisClient.on("error", (err: any) => {
        logger.error("Redis Connection Error: %o", err);
        this.isRedisConnected = false;
      });

      this.redisClient.on("connect", () => {
        logger.info("Successfully connected to Redis Server.");
        this.isRedisConnected = true;
      });

      await this.redisClient.connect();
    } catch (err) {
      logger.warn("Could not initialize Redis. Falling back to In-Memory TTL Cache. Error: %o", err);
    }
  }

  /**
   * Fetch item from cache
   */
  public async get<T>(key: string): Promise<T | null> {
    if (this.isRedisConnected && this.redisClient) {
      try {
        const value = await this.redisClient.get(key);
        if (value) {
          logger.info(`Cache Hit (Redis) for key: ${key}`);
          return JSON.parse(value) as T;
        }
      } catch (err) {
        logger.error(`Redis get error for key ${key}: %o`, err);
      }
    }

    // Memory Cache read
    const item = this.memoryStore.get(key);
    if (item) {
      if (Date.now() < item.expiry) {
        logger.info(`Cache Hit (Memory) for key: ${key}`);
        return item.value as T;
      } else {
        // Expired
        this.memoryStore.delete(key);
        logger.info(`Cache Expired (Memory) for key: ${key}`);
      }
    }

    logger.info(`Cache Miss for key: ${key}`);
    return null;
  }

  /**
   * Set item to cache
   */
  public async set<T>(key: string, value: T, ttlSeconds: number = DEFAULT_TTL): Promise<void> {
    if (this.isRedisConnected && this.redisClient) {
      try {
        await this.redisClient.set(key, JSON.stringify(value), {
          EX: ttlSeconds,
        });
        logger.info(`Cache Set (Redis) for key: ${key} (TTL: ${ttlSeconds}s)`);
        return;
      } catch (err) {
        logger.error(`Redis set error for key ${key}: %o`, err);
      }
    }

    // Memory Cache write
    const expiry = Date.now() + ttlSeconds * 1000;
    this.memoryStore.set(key, { value, expiry });
    logger.info(`Cache Set (Memory) for key: ${key} (TTL: ${ttlSeconds}s)`);
  }

  /**
   * Clear item from cache
   */
  public async delete(key: string): Promise<void> {
    if (this.isRedisConnected && this.redisClient) {
      try {
        await this.redisClient.del(key);
      } catch (err) {
        logger.error(`Redis delete error for key ${key}: %o`, err);
      }
    }
    this.memoryStore.delete(key);
  }
}

export const cache = new HybridCache();
export default cache;
