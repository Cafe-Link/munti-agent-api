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

const schema = DB.schema.toLowerCase();

// API 1: Get User List
const getUsers = async (req, res) => {
  const { page = 1, limit = 10, search = '' } = req.query;
  const offset = (page - 1) * limit;

  try {
    let query = `SELECT id, name, pin, allowed_agents FROM ${schema}.user_details`;
    let countQuery = `SELECT COUNT(*) FROM ${schema}.user_details`;
    const params = [];

    if (search) {
      query += ` WHERE name ILIKE $1`;
      countQuery += ` WHERE name ILIKE $1`;
      params.push(`%${search}%`);
    }

    query += ` ORDER BY name ASC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    const queryParams = [...params, limit, offset];

    const result = await pool.query(query, queryParams);
    const countResult = await pool.query(countQuery, params);

    const total = parseInt(countResult.rows[0].count);

    res.status(200).json({
      data: result.rows,
      total,
      page: parseInt(page),
      totalPages: Math.ceil(total / limit)
    });
  } catch (err) {
    console.error('Get Users Error:', err);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
};

// API 2: Get All Agents
const getAgents = async (req, res) => {
  try {
    const query = `SELECT id, name, type FROM ${schema}.agents ORDER BY name ASC`;
    const result = await pool.query(query);
    res.status(200).json(result.rows);
  } catch (err) {
    console.error('Get Agents Error:', err);
    res.status(500).json({ error: 'Failed to fetch agents' });
  }
};

// API 3: Update User Allowed Agents
const updateUserAgents = async (req, res) => {
  const { userId, allowed_agents } = req.body;

  if (!userId || !Array.isArray(allowed_agents)) {
    return res.status(400).json({ error: 'User ID and allowed_agents array are required' });
  }

  try {
    const query = `UPDATE ${schema}.user_details SET allowed_agents = $1 WHERE id = $2`;
    const result = await pool.query(query, [JSON.stringify(allowed_agents), userId]);

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.status(200).json({ success: true, message: 'User agents updated successfully' });
  } catch (err) {
    console.error('Update User Agents Error:', err);
    res.status(500).json({ error: 'Failed to update user agents' });
  }
};

// API 4: Add New Agent
const addAgent = async (req, res) => {
  const { id, name, type } = req.body;

  if (!id || !name || !type) {
    return res.status(400).json({ error: 'ID, name, and type are required' });
  }

  try {
    const query = `
      INSERT INTO ${schema}.agents (id, name, type)
      VALUES ($1, $2, $3)
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        type = EXCLUDED.type,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *
    `;
    const result = await pool.query(query, [id, name, type]);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Add Agent Error:', err);
    res.status(500).json({ error: 'Failed to add agent' });
  }
};

module.exports = {
  getUsers,
  getAgents,
  updateUserAgents,
  addAgent
};
