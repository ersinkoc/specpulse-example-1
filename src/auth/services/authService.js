const User = require('../models/User');
const dbConnection = require('../../database/connection');
const emailService = require('./emailService');
const tokenService = require('./tokenService');
const { utils: securityUtils } = require('../../shared/config/security');
const logger = require('../../shared/utils/logger');

class AuthService {
  constructor() {
    this.verificationTokens = new Map(); // In development, use Map for token storage
    this.passwordResetTokens = new Map(); // In production, use database
  }

  // Register new user
  async register(userData) {
    const client = await dbConnection.getClient();
    try {
      await client.query('BEGIN');

      // Check if user already exists
      const existingUserQuery = 'SELECT id FROM users WHERE email = $1';
      const existingUserResult = await client.query(existingUserQuery, [userData.email.toLowerCase()]);

      if (existingUserResult.rows.length > 0) {
        throw new Error('User with this email already exists');
      }

      // Create new user
      const user = new User(userData);

      // Hash password
      await user.hashPassword(userData.password);

      // Insert user into database
      const insertUserQuery = `
        INSERT INTO users (email, email_verified, password_hash, name, roles, is_active)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id, email, email_verified, name, roles, created_at, updated_at
      `;

      const userResult = await client.query(insertUserQuery, [
        user.email,
        user.emailVerified,
        user.passwordHash,
        user.name,
        JSON.stringify(user.roles),
        user.isActive
      ]);

      const createdUser = User.fromDBRow(userResult.rows[0]);

      // Generate email verification token
      const verificationToken = tokenService.createEmailVerificationToken(createdUser);
      this.verificationTokens.set(verificationToken, {
        userId: createdUser.id,
        email: createdUser.email,
        expiresAt: Date.now() + securityConfig.email.verificationToken.expiresIn
      });

      // Send verification email
      await emailService.sendVerificationEmail(createdUser, verificationToken);

      await client.query('COMMIT');

      logger.info('User registered successfully', { userId: createdUser.id, email: createdUser.email });

      return {
        success: true,
        user: createdUser.toJSON(),
        message: 'Registration successful. Please check your email for verification instructions.'
      };

    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('User registration failed:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  // Login user
  async login(email, password) {
    try {
      // Find user by email
      const userQuery = `
        SELECT id, email, email_verified, password_hash, name, roles, is_active, last_login_at, created_at, updated_at
        FROM users
        WHERE email = $1 AND is_active = true
      `;

      const userResult = await dbConnection.query(userQuery, [email.toLowerCase()]);

      if (userResult.rows.length === 0) {
        throw new Error('Invalid email or password');
      }

      const user = User.fromDBRow(userResult.rows[0]);

      // Verify password
      const isValidPassword = await user.verifyPassword(password);
      if (!isValidPassword) {
        throw new Error('Invalid email or password');
      }

      // Check if email is verified (optional - some systems allow login without verification)
      if (!user.emailVerified) {
        logger.warn('Unverified user attempted login', { userId: user.id, email: user.email });
        // You might want to allow login but show a verification reminder
      }

      // Update last login time
      await this.updateLastLogin(user.id);

      // Generate JWT tokens
      const tokens = await tokenService.generateTokenPair(user, {
        deviceInfo: req.deviceInfo || {},
        ipAddress: req.ip,
        userAgent: req.get('User-Agent')
      });

      logger.info('User logged in successfully', { userId: user.id, email: user.email });

      return {
        success: true,
        user: user.toJSON(),
        tokens,
        requiresEmailVerification: !user.emailVerified
      };

    } catch (error) {
      logger.error('User login failed:', { email, error: error.message });
      throw error;
    }
  }

  // Verify email
  async verifyEmail(token) {
    try {
      // Use JWT verification instead of Map lookup
      const decoded = tokenService.verifySpecialToken(token, 'email_verification');

      // Check if token is still valid (not already used)
      const existingTokenData = this.verificationTokens.get(token);
      if (!existingTokenData) {
        throw new Error('Invalid or expired verification token');
      }

      if (Date.now() > existingTokenData.expiresAt) {
        this.verificationTokens.delete(token);
        throw new Error('Verification token has expired');
      }

      if (!tokenData) {
        throw new Error('Invalid or expired verification token');
      }

      if (Date.now() > tokenData.expiresAt) {
        this.verificationTokens.delete(token);
        throw new Error('Verification token has expired');
      }

      // Update user email verification status
      const updateQuery = `
        UPDATE users
        SET email_verified = true, updated_at = CURRENT_TIMESTAMP
        WHERE id = $1 AND email = $2
        RETURNING id, email, email_verified, name
      `;

      const result = await dbConnection.query(updateQuery, [decoded.sub, decoded.email]);

      if (result.rows.length === 0) {
        throw new Error('User not found or email mismatch');
      }

      const user = User.fromDBRow(result.rows[0]);

      // Clean up token
      this.verificationTokens.delete(token);

      // Send welcome email
      await emailService.sendWelcomeEmail(user);

      logger.info('Email verified successfully', { userId: user.id, email: user.email });

      return {
        success: true,
        user: user.toJSON(),
        message: 'Email verified successfully. You can now login to your account.'
      };

    } catch (error) {
      logger.error('Email verification failed:', { token, error: error.message });
      throw error;
    }
  }

  // Request password reset
  async requestPasswordReset(email) {
    try {
      // Find user by email
      const userQuery = `
        SELECT id, email, name, email_verified
        FROM users
        WHERE email = $1 AND is_active = true
      `;

      const userResult = await dbConnection.query(userQuery, [email.toLowerCase()]);

      if (userResult.rows.length === 0) {
        // Don't reveal if user exists or not for security
        return {
          success: true,
          message: 'If an account with this email exists, you will receive password reset instructions.'
        };
      }

      const user = User.fromDBRow(userResult.rows[0]);

      // Generate password reset token
      const resetToken = tokenService.createPasswordResetToken(user);
      this.passwordResetTokens.set(resetToken, {
        userId: user.id,
        email: user.email,
        expiresAt: Date.now() + securityConfig.email.passwordResetToken.expiresIn
      });

      // Send password reset email
      await emailService.sendPasswordResetEmail(user, resetToken);

      logger.info('Password reset requested', { userId: user.id, email: user.email });

      return {
        success: true,
        message: 'If an account with this email exists, you will receive password reset instructions.'
      };

    } catch (error) {
      logger.error('Password reset request failed:', { email, error: error.message });
      throw error;
    }
  }

  // Reset password
  async resetPassword(token, newPassword) {
    const client = await dbConnection.getClient();
    try {
      await client.query('BEGIN');

      // Verify JWT token
      const decoded = tokenService.verifySpecialToken(token, 'password_reset');

      // Check if token is still valid (not already used)
      const existingTokenData = this.passwordResetTokens.get(token);
      if (!existingTokenData) {
        throw new Error('Invalid or expired reset token');
      }

      if (Date.now() > existingTokenData.expiresAt) {
        this.passwordResetTokens.delete(token);
        throw new Error('Reset token has expired');
      }

      // Create temporary user object to hash password
      const tempUser = new User();
      await tempUser.hashPassword(newPassword);

      // Update user password
      const updateQuery = `
        UPDATE users
        SET password_hash = $1, updated_at = CURRENT_TIMESTAMP
        WHERE id = $2 AND email = $3
        RETURNING id, email, name
      `;

      const result = await client.query(updateQuery, [tempUser.passwordHash, decoded.sub, decoded.email]);

      if (result.rows.length === 0) {
        throw new Error('User not found or email mismatch');
      }

      const user = User.fromDBRow(result.rows[0]);

      // Clean up token
      this.passwordResetTokens.delete(token);

      // Send security alert
      await emailService.sendSecurityAlert(user, 'PASSWORD_CHANGED', {
        method: 'email_reset',
        time: new Date().toISOString()
      });

      await client.query('COMMIT');

      logger.info('Password reset successfully', { userId: user.id, email: user.email });

      return {
        success: true,
        message: 'Password reset successfully. You can now login with your new password.'
      };

    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Password reset failed:', { token, error: error.message });
      throw error;
    } finally {
      client.release();
    }
  }

  // Change password
  async changePassword(userId, currentPassword, newPassword) {
    try {
      // Get user with current password
      const userQuery = `
        SELECT id, email, password_hash, name
        FROM users
        WHERE id = $1 AND is_active = true
      `;

      const userResult = await dbConnection.query(userQuery, [userId]);

      if (userResult.rows.length === 0) {
        throw new Error('User not found');
      }

      const user = User.fromDBRow(userResult.rows[0]);

      // Verify current password
      const isValidPassword = await user.verifyPassword(currentPassword);
      if (!isValidPassword) {
        throw new Error('Current password is incorrect');
      }

      // Hash new password
      await user.hashPassword(newPassword);

      // Update password
      const updateQuery = `
        UPDATE users
        SET password_hash = $1, updated_at = CURRENT_TIMESTAMP
        WHERE id = $2
        RETURNING id, email, name
      `;

      await dbConnection.query(updateQuery, [user.passwordHash, userId]);

      // Send security alert
      await emailService.sendSecurityAlert(user, 'PASSWORD_CHANGED', {
        method: 'user_initiated',
        time: new Date().toISOString()
      });

      logger.info('Password changed successfully', { userId, email: user.email });

      return {
        success: true,
        message: 'Password changed successfully.'
      };

    } catch (error) {
      logger.error('Password change failed:', { userId, error: error.message });
      throw error;
    }
  }

  // Get user by email
  async getUserByEmail(email) {
    try {
      const userQuery = `
        SELECT id, email, email_verified, name, avatar_url, roles, is_active, last_login_at, created_at, updated_at
        FROM users
        WHERE email = $1 AND is_active = true
      `;

      const userResult = await dbConnection.query(userQuery, [email.toLowerCase()]);

      if (userResult.rows.length === 0) {
        return null;
      }

      return User.fromDBRow(userResult.rows[0]);

    } catch (error) {
      logger.error('Failed to get user by email:', { email, error: error.message });
      throw error;
    }
  }

  // Get user by ID
  async getUserById(userId) {
    try {
      const userQuery = `
        SELECT id, email, email_verified, name, avatar_url, roles, is_active, last_login_at, created_at, updated_at
        FROM users
        WHERE id = $1 AND is_active = true
      `;

      const userResult = await dbConnection.query(userQuery, [userId]);

      if (userResult.rows.length === 0) {
        return null;
      }

      return User.fromDBRow(userResult.rows[0]);

    } catch (error) {
      logger.error('Failed to get user by ID:', { userId, error: error.message });
      throw error;
    }
  }

  // Update user profile
  async updateProfile(userId, profileData) {
    try {
      const user = await this.getUserById(userId);
      if (!user) {
        throw new Error('User not found');
      }

      // Update allowed fields
      const allowedFields = ['name', 'avatar_url'];
      const updates = [];
      const values = [];
      let paramIndex = 1;

      for (const [key, value] of Object.entries(profileData)) {
        if (allowedFields.includes(key) && value !== undefined) {
          updates.push(`${key} = $${paramIndex}`);
          values.push(value);
          paramIndex++;
        }
      }

      if (updates.length === 0) {
        throw new Error('No valid fields to update');
      }

      // Add updated_at and user ID
      updates.push(`updated_at = CURRENT_TIMESTAMP`);
      values.push(userId);

      const updateQuery = `
        UPDATE users
        SET ${updates.join(', ')}
        WHERE id = $${paramIndex}
        RETURNING id, email, email_verified, name, avatar_url, roles, updated_at
      `;

      const result = await dbConnection.query(updateQuery, values);

      if (result.rows.length === 0) {
        throw new Error('Failed to update profile');
      }

      const updatedUser = User.fromDBRow(result.rows[0]);

      logger.info('User profile updated', { userId, fields: Object.keys(profileData) });

      return {
        success: true,
        user: updatedUser.toJSON()
      };

    } catch (error) {
      logger.error('Profile update failed:', { userId, error: error.message });
      throw error;
    }
  }

  // Update last login time
  async updateLastLogin(userId) {
    try {
      const updateQuery = `
        UPDATE users
        SET last_login_at = CURRENT_TIMESTAMP
        WHERE id = $1
      `;

      await dbConnection.query(updateQuery, [userId]);

    } catch (error) {
      logger.error('Failed to update last login:', { userId, error: error.message });
      // Don't throw error as this is not critical
    }
  }

  // Clean up expired tokens (should be run periodically)
  cleanupExpiredTokens() {
    const now = Date.now();

    // Clean up verification tokens
    for (const [token, data] of this.verificationTokens.entries()) {
      if (now > data.expiresAt) {
        this.verificationTokens.delete(token);
      }
    }

    // Clean up password reset tokens
    for (const [token, data] of this.passwordResetTokens.entries()) {
      if (now > data.expiresAt) {
        this.passwordResetTokens.delete(token);
      }
    }

    logger.debug('Token cleanup completed');
  }

  // Get user statistics
  async getUserStats() {
    try {
      const statsQuery = `
        SELECT
          COUNT(*) as total_users,
          COUNT(*) FILTER (WHERE email_verified = true) as verified_users,
          COUNT(*) FILTER (WHERE is_active = true) as active_users,
          COUNT(*) FILTER (WHERE last_login_at > CURRENT_DATE - INTERVAL '7 days') as active_last_week,
          COUNT(*) FILTER (WHERE last_login_at > CURRENT_DATE - INTERVAL '30 days') as active_last_month
        FROM users
      `;

      const result = await dbConnection.query(statsQuery);
      return result.rows[0];

    } catch (error) {
      logger.error('Failed to get user stats:', error);
      throw error;
    }
  }
}

// Create singleton instance
const authService = new AuthService();

module.exports = authService;