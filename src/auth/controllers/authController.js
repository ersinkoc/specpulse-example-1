const authService = require('../services/authService');
const tokenService = require('../services/tokenService');
const logger = require('../../shared/utils/logger');

class AuthController {
  // Register new user
  async register(req, res) {
    try {
      const { email, password, confirmPassword, name } = req.body;

      const result = await authService.register({
        email,
        password,
        name
      });

      res.status(201).json({
        success: true,
        message: result.message,
        user: result.user
      });

    } catch (error) {
      logger.error('Registration endpoint error:', error);

      if (error.message.includes('already exists')) {
        return res.status(409).json({
          success: false,
          error: 'UserExistsError',
          message: 'A user with this email address already exists'
        });
      }

      if (error.message.includes('secure password')) {
        return res.status(400).json({
          success: false,
          error: 'PasswordValidationError',
          message: error.message
        });
      }

      res.status(500).json({
        success: false,
        error: 'RegistrationError',
        message: 'Failed to register user. Please try again.'
      });
    }
  }

  // Login user
  async login(req, res) {
    try {
      const { email, password } = req.body;

      const result = await authService.login(email, password);

      res.status(200).json({
        success: true,
        message: 'Login successful',
        user: result.user,
        tokens: result.tokens,
        requiresEmailVerification: result.requiresEmailVerification
      });

    } catch (error) {
      logger.error('Login endpoint error:', { email, error: error.message });

      if (error.message.includes('Invalid email or password')) {
        return res.status(401).json({
          success: false,
          error: 'AuthenticationError',
          message: 'Invalid email or password'
        });
      }

      res.status(500).json({
        success: false,
        error: 'LoginError',
        message: 'Login failed. Please try again.'
      });
    }
  }

  // Verify email
  async verifyEmail(req, res) {
    try {
      const { token } = req.query;

      if (!token) {
        return res.status(400).json({
          success: false,
          error: 'MissingTokenError',
          message: 'Verification token is required'
        });
      }

      const result = await authService.verifyEmail(token);

      res.status(200).json({
        success: true,
        message: result.message,
        user: result.user
      });

    } catch (error) {
      logger.error('Email verification endpoint error:', { token: req.query.token, error: error.message });

      if (error.message.includes('Invalid or expired')) {
        return res.status(400).json({
          success: false,
          error: 'TokenError',
          message: error.message
        });
      }

      res.status(500).json({
        success: false,
        error: 'VerificationError',
        message: 'Email verification failed. Please try again or request a new verification email.'
      });
    }
  }

  // Request password reset
  async requestPasswordReset(req, res) {
    try {
      const { email } = req.body;

      const result = await authService.requestPasswordReset(email);

      res.status(200).json({
        success: true,
        message: result.message
      });

    } catch (error) {
      logger.error('Password reset request endpoint error:', { email: req.body.email, error: error.message });

      res.status(500).json({
        success: false,
        error: 'PasswordResetRequestError',
        message: 'Failed to process password reset request. Please try again.'
      });
    }
  }

  // Reset password
  async resetPassword(req, res) {
    try {
      const { token, password, confirmPassword } = req.body;

      const result = await authService.resetPassword(token, password);

      res.status(200).json({
        success: true,
        message: result.message
      });

    } catch (error) {
      logger.error('Password reset endpoint error:', { token: req.body.token, error: error.message });

      if (error.message.includes('Invalid or expired')) {
        return res.status(400).json({
          success: false,
          error: 'TokenError',
          message: error.message
        });
      }

      res.status(500).json({
        success: false,
        error: 'PasswordResetError',
        message: 'Password reset failed. Please request a new reset link.'
      });
    }
  }

  // Change password
  async changePassword(req, res) {
    try {
      const userId = req.user?.id; // This would come from authentication middleware
      const { currentPassword, newPassword, confirmNewPassword } = req.body;

      if (!userId) {
        return res.status(401).json({
          success: false,
          error: 'AuthenticationError',
          message: 'You must be logged in to change your password'
        });
      }

      const result = await authService.changePassword(userId, currentPassword, newPassword);

      res.status(200).json({
        success: true,
        message: result.message
      });

    } catch (error) {
      logger.error('Password change endpoint error:', { userId: req.user?.id, error: error.message });

      if (error.message.includes('Current password is incorrect')) {
        return res.status(400).json({
          success: false,
          error: 'PasswordValidationError',
          message: error.message
        });
      }

      if (error.message.includes('User not found')) {
        return res.status(404).json({
          success: false,
          error: 'UserNotFoundError',
          message: 'User not found'
        });
      }

      res.status(500).json({
        success: false,
        error: 'PasswordChangeError',
        message: 'Failed to change password. Please try again.'
      });
    }
  }

  // Get current user profile
  async getProfile(req, res) {
    try {
      const userId = req.user?.id; // This would come from authentication middleware

      if (!userId) {
        return res.status(401).json({
          success: false,
          error: 'AuthenticationError',
          message: 'You must be logged in to view your profile'
        });
      }

      const user = await authService.getUserById(userId);

      if (!user) {
        return res.status(404).json({
          success: false,
          error: 'UserNotFoundError',
          message: 'User not found'
        });
      }

      res.status(200).json({
        success: true,
        user: user.toJSON()
      });

    } catch (error) {
      logger.error('Get profile endpoint error:', { userId: req.user?.id, error: error.message });

      res.status(500).json({
        success: false,
        error: 'ProfileError',
        message: 'Failed to retrieve profile. Please try again.'
      });
    }
  }

  // Update user profile
  async updateProfile(req, res) {
    try {
      const userId = req.user?.id; // This would come from authentication middleware
      const { name, avatarUrl } = req.body;

      if (!userId) {
        return res.status(401).json({
          success: false,
          error: 'AuthenticationError',
          message: 'You must be logged in to update your profile'
        });
      }

      const result = await authService.updateProfile(userId, {
        name,
        avatar_url: avatarUrl
      });

      res.status(200).json({
        success: true,
        message: 'Profile updated successfully',
        user: result.user
      });

    } catch (error) {
      logger.error('Update profile endpoint error:', { userId: req.user?.id, error: error.message });

      if (error.message.includes('User not found')) {
        return res.status(404).json({
          success: false,
          error: 'UserNotFoundError',
          message: 'User not found'
        });
      }

      if (error.message.includes('No valid fields')) {
        return res.status(400).json({
          success: false,
          error: 'ValidationError',
          message: 'No valid fields to update'
        });
      }

      res.status(500).json({
        success: false,
        error: 'ProfileUpdateError',
        message: 'Failed to update profile. Please try again.'
      });
    }
  }

  // Refresh token
  async refreshToken(req, res) {
    try {
      const { refreshToken } = req.body;

      if (!refreshToken) {
        return res.status(400).json({
          success: false,
          error: 'MissingTokenError',
          message: 'Refresh token is required'
        });
      }

      const result = await tokenService.refreshAccessToken(refreshToken);

      res.status(200).json({
        success: true,
        message: 'Token refreshed successfully',
        tokens: result
      });

    } catch (error) {
      logger.error('Token refresh endpoint error:', error);

      if (error.message.includes('expired') || error.message.includes('invalid')) {
        return res.status(401).json({
          success: false,
          error: 'TokenError',
          message: 'Refresh token is invalid or expired'
        });
      }

      res.status(500).json({
        success: false,
        error: 'TokenRefreshError',
        message: 'Failed to refresh token. Please login again.'
      });
    }
  }

  // Logout user
  async logout(req, res) {
    try {
      const userId = req.user?.id;
      const token = tokenService.extractTokenFromHeader(req.headers.authorization);

      // Blacklist the current token
      if (token) {
        tokenService.blacklistToken(token);
      }

      // Blacklist all user tokens (more comprehensive logout)
      if (userId) {
        tokenService.blacklistAllUserTokens(userId);
        logger.info('User logged out', { userId });
      }

      res.status(200).json({
        success: true,
        message: 'Logged out successfully'
      });

    } catch (error) {
      logger.error('Logout endpoint error:', error);

      res.status(500).json({
        success: false,
        error: 'LogoutError',
        message: 'Logout failed. Please try again.'
      });
    }
  }

  // Resend verification email
  async resendVerification(req, res) {
    try {
      const { email } = req.body;

      // This would be implemented to resend verification email
      // For now, return a success message
      res.status(200).json({
        success: true,
        message: 'If an account with this email exists and is not verified, a verification email has been sent.'
      });

    } catch (error) {
      logger.error('Resend verification endpoint error:', { email: req.body.email, error: error.message });

      res.status(500).json({
        success: false,
        error: 'ResendVerificationError',
        message: 'Failed to resend verification email. Please try again.'
      });
    }
  }

  // Check if user exists (for OAuth2 flows)
  async checkUserExists(req, res) {
    try {
      const { email } = req.query;

      if (!email) {
        return res.status(400).json({
          success: false,
          error: 'MissingEmailError',
          message: 'Email parameter is required'
        });
      }

      const user = await authService.getUserByEmail(email);

      res.status(200).json({
        success: true,
        exists: !!user,
        user: user ? {
          id: user.id,
          email: user.email,
          name: user.name,
          avatarUrl: user.avatarUrl,
          emailVerified: user.emailVerified
        } : null
      });

    } catch (error) {
      logger.error('Check user exists endpoint error:', { email: req.query.email, error: error.message });

      res.status(500).json({
        success: false,
        error: 'CheckUserError',
        message: 'Failed to check if user exists'
      });
    }
  }
}

module.exports = new AuthController();