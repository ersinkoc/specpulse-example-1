const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');
const config = require('../../shared/config/environment');
const { utils: securityUtils } = require('../../shared/config/security');
const logger = require('../../shared/utils/logger');

class User {
  constructor(data = {}) {
    this.id = data.id || uuidv4();
    this.email = data.email?.toLowerCase().trim();
    this.emailVerified = data.emailVerified || false;
    this.passwordHash = data.passwordHash || null;
    this.name = data.name?.trim();
    this.avatarUrl = data.avatarUrl || null;
    this.roles = data.roles || ['user'];
    this.isActive = data.isActive !== false; // default true
    this.createdAt = data.createdAt || new Date();
    this.updatedAt = data.updatedAt || new Date();
    this.lastLoginAt = data.lastLoginAt || null;
  }

  // Static method to create user from database row
  static fromDBRow(row) {
    return new User({
      id: row.id,
      email: row.email,
      emailVerified: row.email_verified,
      passwordHash: row.password_hash,
      name: row.name,
      avatarUrl: row.avatar_url,
      roles: row.roles,
      isActive: row.is_active,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      lastLoginAt: row.last_login_at
    });
  }

  // Hash password
  async hashPassword(password) {
    if (!password || typeof password !== 'string') {
      throw new Error('Password must be a non-empty string');
    }

    const passwordValidation = securityUtils.validatePasswordStrength(password);
    if (!passwordValidation.isValid) {
      throw new Error(`Password does not meet security requirements. Missing: ${passwordValidation.missing.join(', ')}`);
    }

    try {
      this.passwordHash = await bcrypt.hash(password, config.security.bcryptRounds);
      return this.passwordHash;
    } catch (error) {
      logger.error('Failed to hash password:', error);
      throw new Error('Failed to secure password');
    }
  }

  // Verify password
  async verifyPassword(password) {
    if (!this.passwordHash || !password) {
      return false;
    }

    try {
      return await bcrypt.compare(password, this.passwordHash);
    } catch (error) {
      logger.error('Failed to verify password:', error);
      return false;
    }
  }

  // Update last login time
  updateLastLogin() {
    this.lastLoginAt = new Date();
    this.updatedAt = new Date();
  }

  // Add role
  addRole(role) {
    if (!this.roles.includes(role)) {
      this.roles.push(role);
      this.updatedAt = new Date();
    }
  }

  // Remove role
  removeRole(role) {
    const index = this.roles.indexOf(role);
    if (index > -1) {
      this.roles.splice(index, 1);
      this.updatedAt = new Date();
    }
  }

  // Check if user has role
  hasRole(role) {
    return this.roles.includes(role);
  }

  // Check if user has any of the specified roles
  hasAnyRole(roles) {
    return roles.some(role => this.roles.includes(role));
  }

  // Deactivate user
  deactivate() {
    this.isActive = false;
    this.updatedAt = new Date();
  }

  // Activate user
  activate() {
    this.isActive = true;
    this.updatedAt = new Date();
  }

  // Verify email
  verifyEmail() {
    this.emailVerified = true;
    this.updatedAt = new Date();
  }

  // Update profile
  updateProfile(data) {
    if (data.name && typeof data.name === 'string') {
      this.name = data.name.trim();
    }

    if (data.avatarUrl && typeof data.avatarUrl === 'string') {
      this.avatarUrl = data.avatarUrl.trim();
    }

    this.updatedAt = new Date();
  }

  // Convert to database-friendly object
  toDBRow() {
    return {
      id: this.id,
      email: this.email,
      email_verified: this.emailVerified,
      password_hash: this.passwordHash,
      name: this.name,
      avatar_url: this.avatarUrl,
      roles: this.roles,
      is_active: this.isActive,
      created_at: this.createdAt,
      updated_at: this.updatedAt,
      last_login_at: this.lastLoginAt
    };
  }

  // Convert to safe JSON (exclude sensitive data)
  toJSON() {
    return {
      id: this.id,
      email: this.email,
      emailVerified: this.emailVerified,
      name: this.name,
      avatarUrl: this.avatarUrl,
      roles: this.roles,
      isActive: this.isActive,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      lastLoginAt: this.lastLoginAt
    };
  }

  // Validate user data
  validate() {
    const errors = [];

    // Email validation
    if (!this.email) {
      errors.push('Email is required');
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(this.email)) {
      errors.push('Invalid email format');
    }

    // Name validation
    if (!this.name) {
      errors.push('Name is required');
    } else if (this.name.length < 1 || this.name.length > 255) {
      errors.push('Name must be between 1 and 255 characters');
    }

    // Roles validation
    if (!Array.isArray(this.roles) || this.roles.length === 0) {
      errors.push('At least one role is required');
    } else if (this.roles.some(role => typeof role !== 'string')) {
      errors.push('All roles must be strings');
    }

    // Password validation (only for local auth users)
    if (this.passwordHash === null && !this.emailVerified) {
      // OAuth2 users can have null password hash
      // But if this is a local user, password should be set
      // This validation depends on context (registration vs OAuth2)
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  // Static validation methods
  static validateEmail(email) {
    if (!email || typeof email !== 'string') {
      return false;
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email.toLowerCase().trim());
  }

  static validateName(name) {
    if (!name || typeof name !== 'string') {
      return false;
    }
    const trimmedName = name.trim();
    return trimmedName.length >= 1 && trimmedName.length <= 255;
  }

  static validateRoles(roles) {
    if (!Array.isArray(roles) || roles.length === 0) {
      return false;
    }
    return roles.every(role => typeof role === 'string' && role.length > 0);
  }
}

module.exports = User;