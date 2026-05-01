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

const login = async (req, res) => {
  const { pin } = req.body;

  if (!pin) {
    return res.status(400).json({ error: 'PIN is required' });
  }

  try {
    const schema = DB.schema.toLowerCase();
    const query = `SELECT name, allowed_agents, role FROM ${schema}.user_details WHERE pin = $1`;
    const result = await pool.query(query, [pin]);

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid PIN' });
    }

    const user = result.rows[0];
    res.status(200).json({
      success: true,
      user: {
        name: user.name,
        allowed_agents: user.allowed_agents,
        role: user.role
      }
    });
  } catch (err) {
    console.error('Login Error:', err);
    res.status(500).json({ error: 'Authentication failed' });
  }
};

module.exports = { login };
