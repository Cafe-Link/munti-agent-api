const { Pool } = require('pg');
const { DB } = require('../config/constants');

const pool = new Pool({
  host: DB.host,
  user: DB.user,
  password: DB.password,
  database: DB.database,
  port: DB.port,
  ssl: { rejectUnauthorized: false }
});

const isAdmin = async (req, res, next) => {
  const pin = req.headers['x-admin-pin'];

  if (!pin) {
    return res.status(401).json({ error: 'Unauthorized: Admin PIN required' });
  }

  try {
    const schema = DB.schema.toLowerCase();
    const query = `SELECT role FROM ${schema}.user_details WHERE pin = $1`;
    const result = await pool.query(query, [pin]);

    if (result.rows.length === 0 || result.rows[0].role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden: Admin access required' });
    }

    next();
  } catch (err) {
    console.error('Admin Middleware Error:', err);
    res.status(500).json({ error: 'Internal server error during authentication' });
  }
};

module.exports = { isAdmin };
