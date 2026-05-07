const { Pool } = require('pg');
const { DB, REFRESH_TOKEN_EXPIRY_MINUTES } = require('../config/constants');
const sessionManager = require('../services/sessionManager');

const pool = new Pool({
  host: DB.host,
  user: DB.user,
  password: DB.password,
  database: DB.database,
  port: DB.port,
  ssl: { rejectUnauthorized: false }
});

const schema = DB.schema.toLowerCase();

const login = async (req, res) => {
  const { pin } = req.body;

  if (!pin) {
    return res.status(400).json({ error: 'PIN is required' });
  }

  try {
    const query = `SELECT id, name, allowed_agents, role FROM ${schema}.user_details WHERE pin = $1`;
    const result = await pool.query(query, [pin]);

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid PIN' });
    }

    const user = result.rows[0];

    // Create DB Session
    const metadata = {
      userAgent: req.headers['user-agent'],
      ip: req.ip
    };
    const { session, refreshToken } = await sessionManager.createAuthSession(user.id, metadata);

    // Generate Access Token
    const accessToken = sessionManager.generateAccessToken({
      userId: user.id,
      sessionId: session.id,
      role: user.role
    });

    // Set Cookies
    res.cookie('accessToken', accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 15 * 60 * 1000 // 15 mins
    });

    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: REFRESH_TOKEN_EXPIRY_MINUTES * 60 * 1000 // Now 30 mins
    });

    res.status(200).json({
      success: true,
      user: {
        id: user.id,
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

const refresh = async (req, res) => {
  const oldRefreshToken = req.cookies.refreshToken;

  if (!oldRefreshToken) {
    return res.status(401).json({ error: 'Refresh token missing' });
  }

  try {
    const { session, newRefreshToken } = await sessionManager.refreshAuthSession(oldRefreshToken);

    const accessToken = sessionManager.generateAccessToken({
      userId: session.user_id,
      sessionId: session.id,
      role: session.role
    });

    res.cookie('accessToken', accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 15 * 60 * 1000
    });

    res.cookie('refreshToken', newRefreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: REFRESH_TOKEN_EXPIRY_MINUTES * 60 * 1000
    });

    res.status(200).json({ success: true });
  } catch (err) {
    console.error('Refresh Error:', err.message);
    res.status(401).json({ error: 'Session expired' });
  }
};

const logout = async (req, res) => {
  const { sessionId } = req.user || {}; // From isAuthenticated middleware

  try {
    if (sessionId) {
      await sessionManager.revokeSession(sessionId);
    }
    
    res.clearCookie('accessToken');
    res.clearCookie('refreshToken');
    
    res.status(200).json({ success: true, message: 'Logged out successfully' });
  } catch (err) {
    console.error('Logout Error:', err);
    res.status(500).json({ error: 'Logout failed' });
  }
};

module.exports = { login, refresh, logout };
