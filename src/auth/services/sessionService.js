const crypto = require('crypto');
const logger = require('../../shared/utils/logger');

/**
 * Session Service
 * Manages user sessions, token blacklisting, and session cleanup
 */
class SessionService {
  constructor() {
    // In-memory session store (in production, use Redis or database)
    this.sessions = new Map(); // sessionId -> session data
    this.blacklistedTokens = new Map(); // jti -> blacklist info
    this.refreshTokens = new Map(); // jti -> refresh token data

    // Configuration
    this.config = {
      sessionTimeout: 24 * 60 * 60 * 1000, // 24 hours
      refreshTokenTimeout: 7 * 24 * 60 * 60 * 1000, // 7 days
      maxSessionsPerUser: 5, // Maximum concurrent sessions per user
      cleanupInterval: 60 * 60 * 1000, // 1 hour
      blacklistCleanupInterval: 24 * 60 * 60 * 1000 // 24 hours
    };

    // Start cleanup intervals
    this.startCleanupServices();
  }

  /**
   * Create a new session
   */
  async createSession(userId, userData = {}) {
    try {
      const sessionId = this.generateSessionId();
      const now = Date.now();

      const session = {
        id: sessionId,
        userId,
        userData,
        createdAt: now,
        lastAccessedAt: now,
        expiresAt: now + this.config.sessionTimeout,
        isActive: true,
        deviceInfo: userData.deviceInfo || {},
        ipAddress: userData.ipAddress || null,
        userAgent: userData.userAgent || null
      };

      // Store session
      this.sessions.set(sessionId, session);

      // Enforce max sessions per user
      await this.enforceMaxSessions(userId);

      logger.info('Session created', {
        sessionId,
        userId,
        deviceInfo: session.deviceInfo,
        ipAddress: session.ipAddress
      });

      return session;

    } catch (error) {
      logger.error('Failed to create session', { error: error.message, userId });
      throw error;
    }
  }

  /**
   * Get session by ID
   */
  async getSession(sessionId) {
    try {
      const session = this.sessions.get(sessionId);

      if (!session) {
        return null;
      }

      // Check if session is expired
      if (Date.now() > session.expiresAt) {
        await this.deleteSession(sessionId);
        return null;
      }

      // Update last accessed time
      session.lastAccessedAt = Date.now();
      this.sessions.set(sessionId, session);

      return session;

    } catch (error) {
      logger.error('Failed to get session', { error: error.message, sessionId });
      return null;
    }
  }

  /**
   * Update session data
   */
  async updateSession(sessionId, updates = {}) {
    try {
      const session = this.sessions.get(sessionId);

      if (!session) {
        return null;
      }

      // Update session with new data
      const updatedSession = {
        ...session,
        ...updates,
        lastAccessedAt: Date.now()
      };

      this.sessions.set(sessionId, updatedSession);

      return updatedSession;

    } catch (error) {
      logger.error('Failed to update session', { error: error.message, sessionId });
      throw error;
    }
  }

  /**
   * Delete session
   */
  async deleteSession(sessionId) {
    try {
      const session = this.sessions.get(sessionId);

      if (session) {
        this.sessions.delete(sessionId);
        logger.info('Session deleted', { sessionId, userId: session.userId });
      }

      return true;

    } catch (error) {
      logger.error('Failed to delete session', { error: error.message, sessionId });
      return false;
    }
  }

  /**
   * Delete all sessions for a user
   */
  async deleteAllUserSessions(userId) {
    try {
      let deletedCount = 0;

      for (const [sessionId, session] of this.sessions) {
        if (session.userId === userId) {
          this.sessions.delete(sessionId);
          deletedCount++;
        }
      }

      logger.info('All user sessions deleted', { userId, deletedCount });

      return deletedCount;

    } catch (error) {
      logger.error('Failed to delete user sessions', { error: error.message, userId });
      return 0;
    }
  }

  /**
   * Get all active sessions for a user
   */
  async getUserSessions(userId) {
    try {
      const userSessions = [];

      for (const [sessionId, session] of this.sessions) {
        if (session.userId === userId && session.isActive && Date.now() < session.expiresAt) {
          userSessions.push({
            id: sessionId,
            createdAt: session.createdAt,
            lastAccessedAt: session.lastAccessedAt,
            expiresAt: session.expiresAt,
            deviceInfo: session.deviceInfo,
            ipAddress: session.ipAddress,
            userAgent: session.userAgent
          });
        }
      }

      // Sort by last accessed time (most recent first)
      userSessions.sort((a, b) => b.lastAccessedAt - a.lastAccessedAt);

      return userSessions;

    } catch (error) {
      logger.error('Failed to get user sessions', { error: error.message, userId });
      return [];
    }
  }

  /**
   * Enforce maximum sessions per user
   */
  async enforceMaxSessions(userId) {
    try {
      const userSessions = await this.getUserSessions(userId);

      if (userSessions.length <= this.config.maxSessionsPerUser) {
        return;
      }

      // Remove oldest sessions to maintain max limit
      const sessionsToRemove = userSessions
        .slice(this.config.maxSessionsPerUser)
        .map(session => session.id);

      for (const sessionId of sessionsToRemove) {
        await this.deleteSession(sessionId);
      }

      logger.info('Enforced max session limit', {
        userId,
        removedCount: sessionsToRemove.length,
        maxAllowed: this.config.maxSessionsPerUser
      });

    } catch (error) {
      logger.error('Failed to enforce max sessions', { error: error.message, userId });
    }
  }

  /**
   * Add token to blacklist
   */
  async blacklistToken(jti, reason = 'User logout', expiresAt = null) {
    try {
      const now = Date.now();
      const defaultExpiry = now + (30 * 24 * 60 * 60 * 1000); // 30 days

      const blacklistInfo = {
        jti,
        reason,
        blacklistedAt: now,
        expiresAt: expiresAt || defaultExpiry
      };

      this.blacklistedTokens.set(jti, blacklistInfo);

      logger.info('Token blacklisted', {
        jti,
        reason,
        blacklistedAt: new Date(blacklistInfo.blacklistedAt).toISOString(),
        expiresAt: new Date(blacklistInfo.expiresAt).toISOString()
      });

      return true;

    } catch (error) {
      logger.error('Failed to blacklist token', { error: error.message, jti });
      return false;
    }
  }

  /**
   * Check if token is blacklisted
   */
  async isTokenBlacklisted(jti) {
    try {
      if (!jti) {
        return false;
      }

      const blacklistInfo = this.blacklistedTokens.get(jti);

      if (!blacklistInfo) {
        return false;
      }

      // Check if blacklist entry has expired
      if (Date.now() > blacklistInfo.expiresAt) {
        this.blacklistedTokens.delete(jti);
        return false;
      }

      return true;

    } catch (error) {
      logger.error('Failed to check token blacklist', { error: error.message, jti });
      return false; // Fail open
    }
  }

  /**
   * Remove token from blacklist
   */
  async removeFromBlacklist(jti) {
    try {
      const removed = this.blacklistedTokens.delete(jti);

      if (removed) {
        logger.info('Token removed from blacklist', { jti });
      }

      return removed;

    } catch (error) {
      logger.error('Failed to remove from blacklist', { error: error.message, jti });
      return false;
    }
  }

  /**
   * Store refresh token
   */
  async storeRefreshToken(jti, userId, expiresAt) {
    try {
      const refreshTokenData = {
        jti,
        userId,
        createdAt: Date.now(),
        expiresAt,
        isRevoked: false
      };

      this.refreshTokens.set(jti, refreshTokenData);

      logger.debug('Refresh token stored', { jti, userId });

      return refreshTokenData;

    } catch (error) {
      logger.error('Failed to store refresh token', { error: error.message, jti });
      throw error;
    }
  }

  /**
   * Get refresh token data
   */
  async getRefreshToken(jti) {
    try {
      const refreshToken = this.refreshTokens.get(jti);

      if (!refreshToken) {
        return null;
      }

      // Check if expired
      if (Date.now() > refreshToken.expiresAt) {
        this.refreshTokens.delete(jti);
        return null;
      }

      return refreshToken;

    } catch (error) {
      logger.error('Failed to get refresh token', { error: error.message, jti });
      return null;
    }
  }

  /**
   * Revoke refresh token
   */
  async revokeRefreshToken(jti, reason = 'Token revoked') {
    try {
      const refreshToken = this.refreshTokens.get(jti);

      if (refreshToken) {
        refreshToken.isRevoked = true;
        refreshToken.revokedAt = Date.now();
        refreshToken.revocationReason = reason;

        this.refreshTokens.set(jti, refreshToken);

        logger.info('Refresh token revoked', { jti, reason });
      }

      return true;

    } catch (error) {
      logger.error('Failed to revoke refresh token', { error: error.message, jti });
      return false;
    }
  }

  /**
   * Revoke all refresh tokens for a user
   */
  async revokeAllUserRefreshTokens(userId, reason = 'Security action') {
    try {
      let revokedCount = 0;

      for (const [jti, refreshToken] of this.refreshTokens) {
        if (refreshToken.userId === userId && !refreshToken.isRevoked) {
          await this.revokeRefreshToken(jti, reason);
          revokedCount++;
        }
      }

      logger.info('All user refresh tokens revoked', {
        userId,
        revokedCount,
        reason
      });

      return revokedCount;

    } catch (error) {
      logger.error('Failed to revoke user refresh tokens', { error: error.message, userId });
      return 0;
    }
  }

  /**
   * Get session statistics
   */
  getStats() {
    try {
      const now = Date.now();
      let activeSessions = 0;
      let expiredSessions = 0;

      for (const session of this.sessions.values()) {
        if (now < session.expiresAt) {
          activeSessions++;
        } else {
          expiredSessions++;
        }
      }

      const activeBlacklistedTokens = Array.from(this.blacklistedTokens.values())
        .filter(token => now < token.expiresAt).length;

      const activeRefreshTokens = Array.from(this.refreshTokens.values())
        .filter(token => !token.isRevoked && now < token.expiresAt).length;

      return {
        sessions: {
          total: this.sessions.size,
          active: activeSessions,
          expired: expiredSessions
        },
        blacklistedTokens: {
          total: this.blacklistedTokens.size,
          active: activeBlacklistedTokens
        },
        refreshTokens: {
          total: this.refreshTokens.size,
          active: activeRefreshTokens
        },
        timestamp: now
      };

    } catch (error) {
      logger.error('Failed to get session stats', { error: error.message });
      return null;
    }
  }

  /**
   * Generate secure session ID
   */
  generateSessionId() {
    return crypto.randomBytes(32).toString('hex');
  }

  /**
   * Start cleanup services
   */
  startCleanupServices() {
    // Clean up expired sessions
    setInterval(() => {
      this.cleanupExpiredSessions();
    }, this.config.cleanupInterval);

    // Clean up expired blacklist entries
    setInterval(() => {
      this.cleanupExpiredBlacklistEntries();
    }, this.config.blacklistCleanupInterval);

    // Clean up expired refresh tokens
    setInterval(() => {
      this.cleanupExpiredRefreshTokens();
    }, this.config.cleanupInterval);

    logger.debug('Session cleanup services started');
  }

  /**
   * Clean up expired sessions
   */
  cleanupExpiredSessions() {
    try {
      const now = Date.now();
      let cleanedCount = 0;

      for (const [sessionId, session] of this.sessions) {
        if (now > session.expiresAt) {
          this.sessions.delete(sessionId);
          cleanedCount++;
        }
      }

      if (cleanedCount > 0) {
        logger.debug('Cleaned up expired sessions', { count: cleanedCount });
      }

    } catch (error) {
      logger.error('Failed to cleanup expired sessions', { error: error.message });
    }
  }

  /**
   * Clean up expired blacklist entries
   */
  cleanupExpiredBlacklistEntries() {
    try {
      const now = Date.now();
      let cleanedCount = 0;

      for (const [jti, blacklistInfo] of this.blacklistedTokens) {
        if (now > blacklistInfo.expiresAt) {
          this.blacklistedTokens.delete(jti);
          cleanedCount++;
        }
      }

      if (cleanedCount > 0) {
        logger.debug('Cleaned up expired blacklist entries', { count: cleanedCount });
      }

    } catch (error) {
      logger.error('Failed to cleanup expired blacklist entries', { error: error.message });
    }
  }

  /**
   * Clean up expired refresh tokens
   */
  cleanupExpiredRefreshTokens() {
    try {
      const now = Date.now();
      let cleanedCount = 0;

      for (const [jti, refreshToken] of this.refreshTokens) {
        if (now > refreshToken.expiresAt) {
          this.refreshTokens.delete(jti);
          cleanedCount++;
        }
      }

      if (cleanedCount > 0) {
        logger.debug('Cleaned up expired refresh tokens', { count: cleanedCount });
      }

    } catch (error) {
      logger.error('Failed to cleanup expired refresh tokens', { error: error.message });
    }
  }

  /**
   * Graceful shutdown
   */
  async shutdown() {
    try {
      logger.info('Shutting down session service');

      // Clear all data
      this.sessions.clear();
      this.blacklistedTokens.clear();
      this.refreshTokens.clear();

      logger.info('Session service shutdown complete');

    } catch (error) {
      logger.error('Error during session service shutdown', { error: error.message });
    }
  }
}

// Create singleton instance
const sessionService = new SessionService();

module.exports = sessionService;