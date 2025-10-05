const express = require('express');
const authController = require('../controllers/authController');
const securityMiddleware = require('../middleware/securityMiddleware');
const {
  authenticate,
  authorizeSelfOrAdmin,
  validateSession,
  optionalAuthenticate
} = require('../middleware/authMiddleware');
const {
  registerSchema,
  loginSchema,
  changePasswordSchema,
  requestPasswordResetSchema,
  resetPasswordSchema,
  verifyEmailSchema,
  updateProfileSchema
} = require('../middleware/validationSchemas');

const router = express.Router();

// Apply security middleware
router.use(securityMiddleware.createIpBlocker());
router.use(securityMiddleware.generateCsrfToken);

// Registration routes with rate limiting and validation
router.post('/register',
  securityMiddleware.createRegistrationLimiter(),
  securityMiddleware.validateInput({ body: registerSchema }),
  securityMiddleware.validatePasswordStrength,
  authController.register
);

router.post('/verify-email',
  securityMiddleware.createEmailVerificationLimiter(),
  securityMiddleware.validateInput({ body: verifyEmailSchema }),
  authController.verifyEmail
);

router.post('/resend-verification',
  securityMiddleware.createEmailVerificationLimiter(),
  authController.resendVerification
);

// Authentication routes with rate limiting and validation
router.post('/login',
  securityMiddleware.createAuthLimiter(),
  validateSession,
  securityMiddleware.validateInput({ body: loginSchema }),
  authController.login
);

router.post('/logout',
  authenticate,
  authController.logout
);

router.post('/logout-all',
  authenticate,
  authController.logoutAll
);

// Password management routes with rate limiting and validation
router.post('/forgot-password',
  securityMiddleware.createPasswordResetLimiter(),
  securityMiddleware.validateInput({ body: requestPasswordResetSchema }),
  authController.forgotPassword
);

router.post('/reset-password',
  securityMiddleware.createStrictLimiter({ max: 3 }),
  securityMiddleware.validateInput({ body: resetPasswordSchema }),
  securityMiddleware.validatePasswordStrength,
  authController.resetPassword
);

router.post('/change-password',
  authenticate,
  securityMiddleware.createStrictLimiter({ max: 5 }),
  securityMiddleware.validateInput({ body: changePasswordSchema }),
  securityMiddleware.validatePasswordStrength,
  authController.changePassword
);

// Token management routes
router.post('/refresh-token',
  securityMiddleware.createStrictLimiter({ max: 20 }),
  authController.refreshToken
);

router.get('/token-info',
  authenticate,
  authController.getTokenInfo
);

// User routes (protected)
router.get('/me',
  authenticate,
  authController.getCurrentUser
);

router.put('/me',
  authenticate,
  securityMiddleware.validateInput({ body: updateProfileSchema }),
  authController.updateCurrentUser
);

module.exports = router;