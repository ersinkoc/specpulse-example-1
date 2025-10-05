const { v4: uuidv4 } = require('uuid');

class RefreshToken {
  constructor(data = {}) {
    this.id = data.id || uuidv4();
    this.userId = data.userId;
    this.token = data.token;
    this.deviceInfo = data.deviceInfo || {};
    this.ipAddress = data.ipAddress;
    this.userAgent = data.userAgent;
    this.isActive = data.isActive !== false;
    this.createdAt = data.createdAt || new Date();
    this.expiresAt = data.expiresAt || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
    this.lastUsedAt = data.lastUsedAt || new Date();
    this.revokedAt = data.revokedAt || null;
    this.revokedReason = data.revokedReason || null;
  }

  // Static method to create from database row
  static fromDBRow(row) {
    return new RefreshToken({
      id: row.id,
      userId: row.user_id,
      token: row.token,
      deviceInfo: row.device_info || {},
      ipAddress: row.ip_address,
      userAgent: row.user_agent,
      isActive: row.is_active,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      lastUsedAt: row.last_used_at,
      revokedAt: row.revoked_at,
      revokedReason: row.revoked_reason
    });
  }

  // Convert to database-friendly object
  toDBRow() {
    return {
      id: this.id,
      user_id: this.userId,
      token: this.token,
      device_info: JSON.stringify(this.deviceInfo),
      ip_address: this.ipAddress,
      user_agent: this.userAgent,
      is_active: this.isActive,
      created_at: this.createdAt,
      expires_at: this.expiresAt,
      last_used_at: this.lastUsedAt,
      revoked_at: this.revokedAt,
      revoked_reason: this.revokedReason
    };
  }

  // Check if token is expired
  isExpired() {
    return new Date() > this.expiresAt;
  }

  // Check if token is revoked
  isRevoked() {
    return this.revokedAt !== null;
  }

  // Check if token is valid (not expired and not revoked)
  isValid() {
    return !this.isExpired() && !this.isRevoked() && this.isActive;
  }

  // Revoke token
  revoke(reason = 'User logout') {
    this.revokedAt = new Date();
    this.revokedReason = reason;
    this.isActive = false;
  }

  // Update last used timestamp
  updateLastUsed() {
    this.lastUsedAt = new Date();
  }

  // Check if token is close to expiring (within 24 hours)
  isExpiringSoon(bufferHours = 24) {
    const bufferTime = bufferHours * 60 * 60 * 1000;
    return new Date() >= (this.expiresAt.getTime() - bufferTime);
  }

  // Get remaining time in milliseconds
  getRemainingTime() {
    const now = new Date();
    if (this.expiresAt <= now) {
      return 0;
    }
    return this.expiresAt.getTime() - now.getTime();
  }

  // Get device description
  getDeviceDescription() {
    if (this.deviceInfo && this.deviceInfo.description) {
      return this.deviceInfo.description;
    }

    // Parse user agent for basic device info
    if (this.userAgent) {
      const ua = this.userAgent.toLowerCase();
      if (ua.includes('mobile') || ua.includes('android') || ua.includes('iphone')) {
        return 'Mobile Device';
      } else if (ua.includes('tablet') || ua.includes('ipad')) {
        return 'Tablet Device';
      } else {
        return 'Desktop Device';
      }
    }

    return 'Unknown Device';
  }

  // Convert to safe JSON (exclude sensitive data)
  toJSON(includeToken = false) {
    const data = {
      id: this.id,
      userId: this.userId,
      deviceInfo: this.deviceInfo,
      ipAddress: this.ipAddress,
      deviceDescription: this.getDeviceDescription(),
      isActive: this.isActive,
      createdAt: this.createdAt,
      expiresAt: this.expiresAt,
      lastUsedAt: this.lastUsedAt,
      revokedAt: this.revokedAt,
      revokedReason: this.revokedReason,
      isExpired: this.isExpired(),
      isRevoked: this.isRevoked(),
      isValid: this.isValid(),
      isExpiringSoon: this.isExpiringSoon()
    };

    if (includeToken) {
      data.token = this.token;
    }

    return data;
  }

  // Validate token data
  validate() {
    const errors = [];

    if (!this.userId) {
      errors.push('User ID is required');
    }

    if (!this.token) {
      errors.push('Token is required');
    }

    if (!this.expiresAt || !(this.expiresAt instanceof Date)) {
      errors.push('Valid expiration date is required');
    }

    if (this.expiresAt <= new Date()) {
      errors.push('Expiration date must be in the future');
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  // Create from JWT payload
  static fromJWTPayload(payload, metadata = {}) {
    return new RefreshToken({
      userId: payload.sub,
      token: payload.jti || payload.token,
      deviceInfo: metadata.deviceInfo || {},
      ipAddress: metadata.ipAddress,
      userAgent: metadata.userAgent,
      expiresAt: new Date(payload.exp * 1000),
      sessionId: payload.sessionId
    });
  }

  // Get token age in days
  getAgeInDays() {
    const now = new Date();
    const diffTime = Math.abs(now - this.createdAt);
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  }

  // Get token usage frequency (times used per day)
  getUsageFrequency() {
    const ageInDays = Math.max(1, this.getAgeInDays());
    // This would be calculated from database usage logs
    // For now, return a placeholder
    return Math.floor(ageInDays / 2); // Placeholder calculation
  }
}

module.exports = RefreshToken;