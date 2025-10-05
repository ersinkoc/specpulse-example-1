const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const config = require('../../shared/config/environment');
const { config: securityConfig } = require('../../shared/config/security');
const logger = require('../../shared/utils/logger');
const RefreshToken = require('../models/RefreshToken');
const dbConnection = require('../../database/connection');

class TokenService {
  constructor() {
    this.blacklistedTokens = new Map(); // In production, use Redis or database
  }

  // Generate JWT access token
  generateAccessToken(user) {
    try {
      const payload = {
        sub: user.id,
        email: user.email,
        roles: user.roles,
        type: 'access',
        iat: Math.floor(Date.now() / 1000),
        iss: securityConfig.jwt.issuer,
        aud: securityConfig.jwt.audience
      };

      const token = jwt.sign(payload, config.jwt.accessSecret, {
        algorithm: securityConfig.jwt.algorithm,
        expiresIn: config.jwt.accessExpiresIn
      });

      logger.debug('Access token generated', { userId: user.id });
      return token;

    } catch (error) {
      logger.error('Failed to generate access token:', error);
      throw new Error('Token generation failed');
    }
  }

  // Generate JWT refresh token
  async generateRefreshToken(user, metadata = {}) {
    try {
      const sessionId = this.generateSessionId();
      const payload = {
        sub: user.id,
        email: user.email,
        type: 'refresh',
        sessionId: sessionId,
        iat: Math.floor(Date.now() / 1000),
        iss: securityConfig.jwt.issuer,
        aud: securityConfig.jwt.audience
      };

      const token = jwt.sign(payload, config.jwt.refreshSecret, {
        algorithm: securityConfig.jwt.algorithm,
        expiresIn: config.jwt.refreshExpiresIn,
        jwtid: sessionId // Include jti claim for database storage
      });

      // Store refresh token in database
      const refreshToken = new RefreshToken({
        userId: user.id,
        token: token,
        deviceInfo: metadata.deviceInfo || {},
        ipAddress: metadata.ipAddress,
        userAgent: metadata.userAgent,
        expiresAt: new Date(Date.now() + this.parseExpirationTime(config.jwt.refreshExpiresIn))
      });

      await this.saveRefreshToken(refreshToken);

      logger.debug('Refresh token generated and stored', { userId: user.id, sessionId });
      return token;

    } catch (error) {
      logger.error('Failed to generate refresh token:', error);
      throw new Error('Refresh token generation failed');
    }
  }

  // Generate token pair
  async generateTokenPair(user, metadata = {}) {
    const accessToken = this.generateAccessToken(user);
    const refreshToken = await this.generateRefreshToken(user, metadata);

    return {
      accessToken,
      refreshToken,
      expiresIn: config.jwt.accessExpiresIn,
      tokenType: 'Bearer'
    };
  }

  // Verify and decode JWT token
  verifyToken(token, tokenType = 'access') {
    try {
      const secret = tokenType === 'refresh' ? config.jwt.refreshSecret : config.jwt.accessSecret;

      const decoded = jwt.verify(token, secret, {
        algorithms: [securityConfig.jwt.algorithm],
        issuer: securityConfig.jwt.issuer,
        audience: securityConfig.jwt.audience
      });

      // Check if token is blacklisted
      if (this.isTokenBlacklisted(token)) {
        throw new Error('Token has been blacklisted');
      }

      // Verify token type
      if (decoded.type !== tokenType) {
        throw new Error(`Invalid token type. Expected ${tokenType}, got ${decoded.type}`);
      }

      return decoded;

    } catch (error) {
      logger.error('Token verification failed:', { error: error.message, tokenType });

      if (error.name === 'TokenExpiredError') {
        throw new Error('Token has expired');
      } else if (error.name === 'JsonWebTokenError') {
        throw new Error('Invalid token');
      } else {
        throw error;
      }
    }
  }

  // Refresh access token using refresh token
  async refreshAccessToken(refreshToken, metadata = {}) {
    try {
      // Verify refresh token
      const decoded = this.verifyToken(refreshToken, 'refresh');

      // Check if refresh token exists in database and is valid
      const storedToken = await this.getRefreshToken(refreshToken);
      if (!storedToken || !storedToken.isValid()) {
        throw new Error('Invalid or expired refresh token');
      }

      // Get user information
      const user = {
        id: decoded.sub,
        email: decoded.email,
        roles: decoded.roles || ['user']
      };

      // Generate new access token
      const newAccessToken = this.generateAccessToken(user);

      // Rotate refresh token (security best practice)
      const newRefreshToken = await this.generateRefreshToken(user, metadata);

      // Revoke old refresh token
      await this.revokeRefreshToken(storedToken.id, 'Token rotation');

      // Update last used timestamp for the old token
      await this.updateRefreshTokenLastUsed(storedToken.id);

      logger.info('Token refresh successful', {
        userId: user.id,
        oldTokenId: storedToken.id,
        newTokenId: decoded.jti
      });

      return {
        accessToken: newAccessToken,
        refreshToken: newRefreshToken,
        expiresIn: config.jwt.accessExpiresIn,
        tokenType: 'Bearer'
      };

    } catch (error) {
      logger.error('Token refresh failed:', error);
      throw new Error('Token refresh failed');
    }
  }

  // Add token to blacklist
  blacklistToken(token) {
    try {
      const decoded = jwt.decode(token);
      if (decoded && decoded.exp) {
        // Store until token expires
        const expiryTime = decoded.exp * 1000 - Date.now();
        if (expiryTime > 0) {
          this.blacklistedTokens.set(token, {
            blacklistedAt: Date.now(),
            expiresAt: decoded.exp * 1000,
            reason: 'logout'
          });

          // Clean up expired tokens periodically
          setTimeout(() => {
            this.blacklistedTokens.delete(token);
          }, expiryTime + 60000); // Extra minute buffer
        }
      }
    } catch (error) {
      logger.error('Failed to blacklist token:', error);
    }
  }

  // Check if token is blacklisted
  isTokenBlacklisted(token) {
    const blacklisted = this.blacklistedTokens.has(token);
    if (blacklisted) {
      const tokenData = this.blacklistedTokens.get(token);
      // Remove expired tokens
      if (Date.now() > tokenData.expiresAt) {
        this.blacklistedTokens.delete(token);
        return false;
      }
    }
    return blacklisted;
  }

  // Blacklist all user tokens
  async blacklistAllUserTokens(userId, reason = 'User logout') {
    try {
      const query = `
        UPDATE refresh_tokens
        SET is_active = false,
            revoked_at = CURRENT_TIMESTAMP,
            revoked_reason = $1
        WHERE user_id = $2
        AND is_active = true
        AND revoked_at IS NULL
        RETURNING id
      `;

      const result = await dbConnection.query(query, [reason, userId]);
      const blacklistedCount = result.rowCount;

      logger.info(`Blacklisted tokens for user: ${userId}`, { blacklistedCount });
      return blacklistedCount;

    } catch (error) {
      logger.error('Failed to blacklist user tokens:', error);
      throw error;
    }
  }

  // Extract token from Authorization header
  extractTokenFromHeader(authHeader) {
    if (!authHeader) {
      return null;
    }

    const parts = authHeader.split(' ');
    if (parts.length !== 2 || parts[0] !== 'Bearer') {
      return null;
    }

    return parts[1];
  }

  // Generate session ID for refresh tokens
  generateSessionId() {
    return crypto.randomBytes(16).toString('hex');
  }

  // Validate token payload structure
  validateTokenPayload(payload) {
    const required = ['sub', 'email', 'iat', 'iss', 'aud'];
    const missing = required.filter(field => !payload[field]);

    if (missing.length > 0) {
      throw new Error(`Invalid token payload. Missing: ${missing.join(', ')}`);
    }

    return true;
  }

  // Get token expiration time
  getTokenExpiration(token) {
    try {
      const decoded = jwt.decode(token);
      return decoded ? new Date(decoded.exp * 1000) : null;
    } catch (error) {
      return null;
    }
  }

  // Check if token is close to expiration (within 5 minutes)
  isTokenExpiringSoon(token, bufferMinutes = 5) {
    const expiration = this.getTokenExpiration(token);
    if (!expiration) {
      return false;
    }

    const bufferTime = bufferMinutes * 60 * 1000;
    return Date.now() >= (expiration.getTime() - bufferTime);
  }

  // Clean up expired blacklisted tokens
  cleanupExpiredTokens() {
    const now = Date.now();
    let cleanedCount = 0;

    for (const [token, data] of this.blacklistedTokens.entries()) {
      if (now > data.expiresAt) {
        this.blacklistedTokens.delete(token);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      logger.debug(`Cleaned up ${cleanedCount} expired blacklisted tokens`);
    }

    return cleanedCount;
  }

  // Get blacklisted tokens count
  getBlacklistedTokensCount() {
    return this.blacklistedTokens.size;
  }

  // Create token for email verification
  createEmailVerificationToken(user) {
    try {
      const payload = {
        sub: user.id,
        email: user.email,
        type: 'email_verification',
        iat: Math.floor(Date.now() / 1000),
        iss: securityConfig.jwt.issuer,
        aud: securityConfig.jwt.audience
      };

      const token = jwt.sign(payload, config.jwt.accessSecret, {
        algorithm: securityConfig.jwt.algorithm,
        expiresIn: securityConfig.email.verificationToken.expiresIn
      });

      return token;

    } catch (error) {
      logger.error('Failed to create email verification token:', error);
      throw new Error('Email verification token creation failed');
    }
  }

  // Create token for password reset
  createPasswordResetToken(user) {
    try {
      const payload = {
        sub: user.id,
        email: user.email,
        type: 'password_reset',
        iat: Math.floor(Date.now() / 1000),
        iss: securityConfig.jwt.issuer,
        aud: securityConfig.jwt.audience
      };

      const token = jwt.sign(payload, config.jwt.accessSecret, {
        algorithm: securityConfig.jwt.algorithm,
        expiresIn: securityConfig.email.passwordResetToken.expiresIn
      });

      return token;

    } catch (error) {
      logger.error('Failed to create password reset token:', error);
      throw new Error('Password reset token creation failed');
    }
  }

  // Verify special purpose tokens (email verification, password reset)
  verifySpecialToken(token, expectedType) {
    try {
      const decoded = this.verifyToken(token, 'access');

      if (decoded.type !== expectedType) {
        throw new Error(`Invalid token type. Expected ${expectedType}, got ${decoded.type}`);
      }

      return decoded;

    } catch (error) {
      logger.error('Special token verification failed:', error);
      throw error;
    }
  }

  // Helper method to parse expiration time string
  parseExpirationTime(timeString) {
    const timeMap = {
      's': 1000,
      'm': 60 * 1000,
      'h': 60 * 60 * 1000,
      'd': 24 * 60 * 60 * 1000
    };

    const match = timeString.match(/^(\d+)([smhd])$/);
    if (!match) {
      return 7 * 24 * 60 * 60 * 1000; // Default to 7 days
    }

    const [, amount, unit] = match;
    return parseInt(amount) * timeMap[unit];
  }

  // Save refresh token to database
  async saveRefreshToken(refreshToken) {
    try {
      const query = `
        INSERT INTO refresh_tokens (
          user_id, token, device_info, ip_address, user_agent,
          is_active, created_at, expires_at, last_used_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING id, created_at, expires_at
      `;

      const values = [
        refreshToken.userId,
        refreshToken.token,
        JSON.stringify(refreshToken.deviceInfo),
        refreshToken.ipAddress,
        refreshToken.userAgent,
        refreshToken.isActive,
        refreshToken.createdAt,
        refreshToken.expiresAt,
        refreshToken.lastUsedAt
      ];

      const result = await dbConnection.query(query, values);
      return result.rows[0];

    } catch (error) {
      logger.error('Failed to save refresh token:', error);
      throw error;
    }
  }

  // Get refresh token by token string
  async getRefreshToken(token) {
    try {
      const query = `
        SELECT id, user_id, token, device_info, ip_address, user_agent,
               is_active, created_at, expires_at, last_used_at,
               revoked_at, revoked_reason
        FROM refresh_tokens
        WHERE token = $1
        LIMIT 1
      `;

      const result = await dbConnection.query(query, [token]);

      if (result.rows.length === 0) {
        return null;
      }

      return RefreshToken.fromDBRow(result.rows[0]);

    } catch (error) {
      logger.error('Failed to get refresh token:', error);
      throw error;
    }
  }

  // Update refresh token last used timestamp
  async updateRefreshTokenLastUsed(tokenId) {
    try {
      const query = `
        UPDATE refresh_tokens
        SET last_used_at = CURRENT_TIMESTAMP
        WHERE id = $1
      `;

      await dbConnection.query(query, [tokenId]);

    } catch (error) {
      logger.error('Failed to update refresh token last used:', error);
      // Don't throw error as this is not critical
    }
  }

  // Revoke refresh token
  async revokeRefreshToken(tokenId, reason = 'Token rotation') {
    try {
      const query = `
        UPDATE refresh_tokens
        SET is_active = false,
            revoked_at = CURRENT_TIMESTAMP,
            revoked_reason = $1
        WHERE id = $2
        RETURNING id
      `;

      const result = await dbConnection.query(query, [reason, tokenId]);
      return result.rowCount > 0;

    } catch (error) {
      logger.error('Failed to revoke refresh token:', error);
      throw error;
    }
  }

  // Get all active refresh tokens for user
  async getUserActiveRefreshTokens(userId) {
    try {
      const query = `
        SELECT id, user_id, token, device_info, ip_address, user_agent,
               is_active, created_at, expires_at, last_used_at,
               revoked_at, revoked_reason
        FROM refresh_tokens
        WHERE user_id = $1
        AND is_active = true
        AND expires_at > CURRENT_TIMESTAMP
        AND revoked_at IS NULL
        ORDER BY last_used_at DESC
      `;

      const result = await dbConnection.query(query, [userId]);
      return result.rows.map(row => RefreshToken.fromDBRow(row));

    } catch (error) {
      logger.error('Failed to get user refresh tokens:', error);
      throw error;
    }
  }

  // Cleanup expired refresh tokens
  async cleanupExpiredRefreshTokens() {
    try {
      const query = `
        DELETE FROM refresh_tokens
        WHERE expires_at < CURRENT_TIMESTAMP - INTERVAL '1 day'
        OR (is_active = false AND revoked_at < CURRENT_TIMESTAMP - INTERVAL '7 days')
        RETURNING id
      `;

      const result = await dbConnection.query(query);
      const cleanedCount = result.rowCount;

      if (cleanedCount > 0) {
        logger.info(`Cleaned up ${cleanedCount} expired refresh tokens`);
      }

      return cleanedCount;

    } catch (error) {
      logger.error('Failed to cleanup expired refresh tokens:', error);
      return 0;
    }
  }

  // Health check for token service
  healthCheck() {
    return {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      blacklistedTokens: this.getBlacklistedTokensCount(),
      secretsConfigured: !!(config.jwt.accessSecret && config.jwt.refreshSecret)
    };
  }
}

// Create singleton instance
const tokenService = new TokenService();

// Clean up expired tokens every hour
setInterval(() => {
  tokenService.cleanupExpiredTokens();
  tokenService.cleanupExpiredTokens();
}, 60 * 60 * 1000);

module.exports = tokenService;