const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const {
  validateRegistration,
  validateLogin,
  validatePasswordResetRequest,
  validatePasswordReset,
  validateProfileUpdate,
  validatePasswordChange,
  validateEmailVerification
} = require('../../shared/validators/authValidator');

// Public routes (no authentication required)

// Register new user
router.post('/register', validateRegistration, authController.register);

// Login user
router.post('/login', validateLogin, authController.login);

// Verify email
router.get('/verify-email', validateEmailVerification, authController.verifyEmail);

// Request password reset
router.post('/forgot-password', validatePasswordResetRequest, authController.requestPasswordReset);

// Reset password
router.post('/reset-password', validatePasswordReset, authController.resetPassword);

// Resend verification email
router.post('/resend-verification', authController.resendVerification);

// Check if user exists (for OAuth2 flows)
router.get('/check-user', authController.checkUserExists);

// Protected routes (authentication required)

// Note: In a real application, these routes would be protected by authentication middleware
// For now, they're included but would need proper JWT verification middleware

// Get current user profile
router.get('/profile', authController.getProfile);

// Update user profile
router.put('/profile', validateProfileUpdate, authController.updateProfile);

// Change password
router.post('/change-password', validatePasswordChange, authController.changePassword);

// Refresh token
router.post('/refresh', validateTokenRefresh, authController.refreshToken);

// Logout user
router.post('/logout', authController.logout);

module.exports = router;