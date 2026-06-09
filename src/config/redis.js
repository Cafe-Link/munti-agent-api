const { createClient } = require('redis');
const { REDIS } = require('./constants');

const redisClient = createClient({
  url: REDIS.url
});

redisClient.on('error', (err) => {
  console.error('Redis Error:', err.message);
});

redisClient.on('connect', () => {
  // We'll log the status in the main server startup block
});

const connectRedis = async () => {
  try {
    if (!redisClient.isOpen) {
      await redisClient.connect();
    }
  } catch (err) {
    console.error('Failed to connect to Redis:', err);
  }
};

module.exports = {
  redisClient,
  connectRedis
};
