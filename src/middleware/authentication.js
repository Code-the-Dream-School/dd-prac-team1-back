// const User = require('../models/User');
const jwt = require('jsonwebtoken');
const { UnauthenticatedError } = require('../errors');

const authenticationMiddleware = async (req, res, next) => {
  // check header
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer')) {
    throw new UnauthenticatedError('Authentication invalid');
  }
  const token = authHeader.split(' ')[1];
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const { userId, username } = payload;
    // attach the user to the recipe routes
    req.user = { userId, username };
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      err.userMessage = 'Session expired, please login again.';
      throw err;
    } else {
      throw new UnauthenticatedError('Authentication invalid');
    }
  }
};

module.exports = authenticationMiddleware;
