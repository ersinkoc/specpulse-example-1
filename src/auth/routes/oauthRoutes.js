const express = require('express');
const passport = require('passport');
const oauthController = require('../controllers/oauthController');
const securityMiddleware = require('../middleware/securityMiddleware');
const { authenticate } = require('../middleware/authMiddleware');
const { oauthStateSchema } = require('../middleware/validationSchemas');

const router = express.Router();

// Apply IP blocking to all OAuth routes
router.use(securityMiddleware.createIpBlocker());

// OAuth Routes with rate limiting
router.get('/google',
  securityMiddleware.createAuthLimiter({ max: 10 }),
  oauthController.googleAuth
);

router.get('/google/callback',
  securityMiddleware.createAuthLimiter({ max: 20 }),
  passport.authenticate('google', { session: false }),
  oauthController.googleCallback
);

router.get('/github',
  securityMiddleware.createAuthLimiter({ max: 10 }),
  oauthController.githubAuth
);

router.get('/github/callback',
  securityMiddleware.createAuthLimiter({ max: 20 }),
  passport.authenticate('github', { session: false }),
  oauthController.githubCallback
);

// Provider management routes (require authentication)
router.get('/providers',
  authenticate,
  oauthController.getProviders
);

router.delete('/providers/:providerName',
  authenticate,
  securityMiddleware.createStrictLimiter({ max: 5 }),
  oauthController.unlinkProvider
);

// OAuth result handlers
router.get('/success',
  securityMiddleware.validateInput({ query: oauthStateSchema }),
  oauthController.oauthSuccess
);

router.get('/error',
  securityMiddleware.validateInput({ query: oauthStateSchema }),
  oauthController.oauthError
);

module.exports = router;