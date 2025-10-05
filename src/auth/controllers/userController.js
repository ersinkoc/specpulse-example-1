const authService = require('../services/authService');
const { canAccessResource } = require('../middleware/rbacMiddleware');
const logger = require('../../shared/utils/logger');
const User = require('../models/User');

class UserController {
  // Get current user profile
  async getProfile(req, res) {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          error: 'AuthenticationRequired',
          message: 'Authentication required'
        });
      }

      // Get fresh user data from database
      const user = await authService.getUserById(req.user.id);
      if (!user) {
        return res.status(404).json({
          success: false,
          error: 'UserNotFound',
          message: 'User not found'
        });
      }

      // Get user's OAuth providers
      const oAuthService = require('../services/oAuthService');
      const providers = await oAuthService.getUserProviders(user.id);

      // Get user's active sessions
      const tokenService = require('../services/tokenService');
      const activeSessions = await tokenService.getUserActiveRefreshTokens(user.id);

      res.json({
        success: true,
        data: {
          user: {
            ...user.toJSON(),
            providers: providers.map(p => ({
              providerName: p.provider_name,
              providerId: p.provider_id,
              createdAt: p.created_at
            })),
            activeSessions: activeSessions.map(session => ({
              id: session.id,
              deviceInfo: session.deviceInfo,
              ipAddress: session.ipAddress,
              userAgent: session.userAgent,
              createdAt: session.createdAt,
              lastUsedAt: session.lastUsedAt,
              expiresAt: session.expiresAt
            }))
          }
        }
      });

    } catch (error) {
      logger.error('Failed to get user profile:', error);
      res.status(500).json({
        success: false,
        error: 'GetProfileError',
        message: 'Failed to retrieve user profile'
      });
    }
  }

  // Update user profile
  async updateProfile(req, res) {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          error: 'AuthenticationRequired',
          message: 'Authentication required'
        });
      }

      const { name, avatar_url, bio } = req.body;

      // Validate input
      const allowedFields = ['name', 'avatar_url', 'bio'];
      const updates = {};

      for (const [key, value] of Object.entries(req.body)) {
        if (allowedFields.includes(key) && value !== undefined) {
          updates[key] = value;
        }
      }

      if (Object.keys(updates).length === 0) {
        return res.status(400).json({
          success: false,
          error: 'NoValidFields',
          message: 'No valid fields to update'
        });
      }

      // Update user profile
      const result = await authService.updateProfile(req.user.id, updates);

      logger.info('User profile updated', {
        userId: req.user.id,
        fields: Object.keys(updates)
      });

      res.json({
        success: true,
        message: 'Profile updated successfully',
        data: {
          user: result.user
        }
      });

    } catch (error) {
      logger.error('Failed to update user profile:', error);
      res.status(500).json({
        success: false,
        error: 'UpdateProfileError',
        message: 'Failed to update profile'
      });
    }
  }

  // Upload profile avatar
  async uploadAvatar(req, res) {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          error: 'AuthenticationRequired',
          message: 'Authentication required'
        });
      }

      if (!req.file) {
        return res.status(400).json({
          success: false,
          error: 'NoFileUploaded',
          message: 'No file uploaded'
        });
      }

      // In a real implementation, you would:
      // 1. Validate file type and size
      // 2. Store file in cloud storage (AWS S3, etc.)
      // 3. Update user's avatar_url field

      const avatarUrl = `/uploads/avatars/${req.file.filename}`;

      // Update user profile with new avatar URL
      const result = await authService.updateProfile(req.user.id, {
        avatar_url: avatarUrl
      });

      logger.info('Avatar uploaded successfully', {
        userId: req.user.id,
        filename: req.file.filename
      });

      res.json({
        success: true,
        message: 'Avatar uploaded successfully',
        data: {
          avatarUrl,
          user: result.user
        }
      });

    } catch (error) {
      logger.error('Failed to upload avatar:', error);
      res.status(500).json({
        success: false,
        error: 'UploadAvatarError',
        message: 'Failed to upload avatar'
      });
    }
  }

  // Change password
  async changePassword(req, res) {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          error: 'AuthenticationRequired',
          message: 'Authentication required'
        });
      }

      const { currentPassword, newPassword } = req.body;

      if (!currentPassword || !newPassword) {
        return res.status(400).json({
          success: false,
          error: 'MissingFields',
          message: 'Current password and new password are required'
        });
      }

      // Validate new password strength
      if (newPassword.length < 8) {
        return res.status(400).json({
          success: false,
          error: 'WeakPassword',
          message: 'Password must be at least 8 characters long'
        });
      }

      // Change password
      await authService.changePassword(req.user.id, currentPassword, newPassword);

      logger.info('Password changed successfully', {
        userId: req.user.id
      });

      res.json({
        success: true,
        message: 'Password changed successfully'
      });

    } catch (error) {
      logger.error('Failed to change password:', error);

      if (error.message.includes('incorrect')) {
        return res.status(400).json({
          success: false,
          error: 'IncorrectPassword',
          message: 'Current password is incorrect'
        });
      }

      res.status(500).json({
        success: false,
        error: 'ChangePasswordError',
        message: 'Failed to change password'
      });
    }
  }

  // Delete account
  async deleteAccount(req, res) {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          error: 'AuthenticationRequired',
          message: 'Authentication required'
        });
      }

      const { password, confirmation } = req.body;

      if (!password) {
        return res.status(400).json({
          success: false,
          error: 'PasswordRequired',
          message: 'Password is required to delete account'
        });
      }

      if (confirmation !== 'DELETE') {
        return res.status(400).json({
          success: false,
          error: 'InvalidConfirmation',
          message: 'Please type "DELETE" to confirm account deletion'
        });
      }

      // Verify password before deletion
      const user = await authService.getUserById(req.user.id);
      if (!user) {
        return res.status(404).json({
          success: false,
          error: 'UserNotFound',
          message: 'User not found'
        });
      }

      const isValidPassword = await user.verifyPassword(password);
      if (!isValidPassword) {
        return res.status(400).json({
          success: false,
          error: 'IncorrectPassword',
          message: 'Password is incorrect'
        });
      }

      // Delete user account (this should cascade delete related records)
      const dbConnection = require('../../database/connection');
      await dbConnection.query('UPDATE users SET is_active = false WHERE id = $1', [req.user.id]);

      // Blacklist all user tokens
      const tokenService = require('../services/tokenService');
      await tokenService.blacklistAllUserTokens(req.user.id, 'Account deletion');

      logger.info('User account deleted', {
        userId: req.user.id,
        email: user.email
      });

      res.json({
        success: true,
        message: 'Account deleted successfully'
      });

    } catch (error) {
      logger.error('Failed to delete account:', error);
      res.status(500).json({
        success: false,
        error: 'DeleteAccountError',
        message: 'Failed to delete account'
      });
    }
  }

  // Get user preferences
  async getPreferences(req, res) {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          error: 'AuthenticationRequired',
          message: 'Authentication required'
        });
      }

      // In a real implementation, you would have a preferences table
      // For now, return default preferences
      const preferences = {
        theme: 'light',
        language: 'en',
        notifications: {
          email: true,
          push: false,
          security: true
        },
        privacy: {
          showEmail: false,
          showProfile: true
        }
      };

      res.json({
        success: true,
        data: { preferences }
      });

    } catch (error) {
      logger.error('Failed to get user preferences:', error);
      res.status(500).json({
        success: false,
        error: 'GetPreferencesError',
        message: 'Failed to retrieve user preferences'
      });
    }
  }

  // Update user preferences
  async updatePreferences(req, res) {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          error: 'AuthenticationRequired',
          message: 'Authentication required'
        });
      }

      const { preferences } = req.body;

      if (!preferences || typeof preferences !== 'object') {
        return res.status(400).json({
          success: false,
          error: 'InvalidPreferences',
          message: 'Valid preferences object is required'
        });
      }

      // In a real implementation, you would save preferences to database
      // For now, just validate and return success

      logger.info('User preferences updated', {
        userId: req.user.id,
        preferences: Object.keys(preferences)
      });

      res.json({
        success: true,
        message: 'Preferences updated successfully',
        data: { preferences }
      });

    } catch (error) {
      logger.error('Failed to update user preferences:', error);
      res.status(500).json({
        success: false,
        error: 'UpdatePreferencesError',
        message: 'Failed to update preferences'
      });
    }
  }

  // Revoke user session
  async revokeSession(req, res) {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          error: 'AuthenticationRequired',
          message: 'Authentication required'
        });
      }

      const { sessionId } = req.params;

      if (!sessionId) {
        return res.status(400).json({
          success: false,
          error: 'MissingSessionId',
          message: 'Session ID is required'
        });
      }

      const tokenService = require('../services/tokenService');
      const revoked = await tokenService.revokeRefreshToken(sessionId, 'User initiated');

      if (!revoked) {
        return res.status(404).json({
          success: false,
          error: 'SessionNotFound',
          message: 'Session not found'
        });
      }

      logger.info('User session revoked', {
        userId: req.user.id,
        sessionId
      });

      res.json({
        success: true,
        message: 'Session revoked successfully'
      });

    } catch (error) {
      logger.error('Failed to revoke session:', error);
      res.status(500).json({
        success: false,
        error: 'RevokeSessionError',
        message: 'Failed to revoke session'
      });
    }
  }

  // Revoke all user sessions (except current)
  async revokeAllSessions(req, res) {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          error: 'AuthenticationRequired',
          message: 'Authentication required'
        });
      }

      const tokenService = require('../services/tokenService');
      const blacklistedCount = await tokenService.blacklistAllUserTokens(req.user.id, 'User initiated logout all');

      logger.info('All user sessions revoked', {
        userId: req.user.id,
        blacklistedCount
      });

      res.json({
        success: true,
        message: 'All sessions revoked successfully',
        data: {
          revokedSessions: blacklistedCount
        }
      });

    } catch (error) {
      logger.error('Failed to revoke all sessions:', error);
      res.status(500).json({
        success: false,
        error: 'RevokeAllSessionsError',
        message: 'Failed to revoke all sessions'
      });
    }
  }
}

module.exports = new UserController();