const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../config/constants');

const isAuthenticated = async (req, res, next) => {
  const token = req.cookies.accessToken;

  if (!token) {
    return res.status(401).json({ error: 'Unauthorized: Session required' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    
    req.user = {
      id: decoded.userId,
      sessionId: decoded.sessionId,
      role: decoded.role
    };
    
    req.authSessionId = decoded.sessionId;

    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired', code: 'TOKEN_EXPIRED' });
    }
    console.error('Auth Middleware Error:', err.message);
    res.status(401).json({ error: 'Unauthorized: Invalid token' });
  }
};

const isAdmin = [
  isAuthenticated,
  (req, res, next) => {
    if (req.user && req.user.role === 'admin') {
      next();
    } else {
      res.status(403).json({ error: 'Forbidden: Admin access required' });
    }
  }
];

module.exports = { isAuthenticated, isAdmin };
