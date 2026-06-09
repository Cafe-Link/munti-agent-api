const { redisClient } = require('../config/redis');

/**
 * Cache Service to handle Redis operations
 */
const cacheService = {
  /**
   * Set a value in cache
   * @param {string} key - Cache key
   * @param {any} value - Value to store (will be stringified)
   * @param {number} ttl - Time to live in seconds (optional)
   */
  set: async (key, value, ttl = 3600) => {
    try {
      const stringValue = JSON.stringify(value);
      if (ttl) {
        await redisClient.setEx(key, ttl, stringValue);
      } else {
        await redisClient.set(key, stringValue);
      }
      return true;
    } catch (error) {
      console.error(`Redis set error for key ${key}:`, error);
      return false;
    }
  },

  /**
   * Get a value from cache
   * @param {string} key - Cache key
   */
  
  get: async (key) => {
    try {
      const value = await redisClient.get(key);
      return value ? JSON.parse(value) : null;
    } catch (error) {
      console.error(`Redis get error for key ${key}:`, error);
      return null;
    }
  },

  /**
   * Delete a value from cache
   * @param {string} key - Cache key
   */
  del: async (key) => {
    try {
      await redisClient.del(key);
      return true;
    } catch (error) {
      console.error(`Redis del error for key ${key}:`, error);
      return false;
    }
  },

  /**
   * Clear all cache (use with caution)
   */
  flush: async () => {
    try {
      await redisClient.flushAll();
      return true;
    } catch (error) {
      console.error('Redis flush error:', error);
      return false;
    }
  }
};

module.exports = cacheService;
