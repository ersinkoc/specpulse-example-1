const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const GitHubStrategy = require('passport-github2').Strategy;
const authService = require('./authService');
const { config: securityConfig } = require('../../shared/config/security');
const logger = require('../../shared/utils/logger');
const config = require('../../shared/config/environment');
const User = require('../models/User');
const dbConnection = require('../../database/connection');

class OAuthService {
  constructor() {
    this.initializeStrategies();
  }

  // Initialize Passport strategies
  initializeStrategies() {
    // Google OAuth Strategy
    passport.use(new GoogleStrategy({
      clientID: config.oauth.google.clientId,
      clientSecret: config.oauth.google.clientSecret,
      callbackURL: config.oauth.google.callbackUrl,
      scope: ['profile', 'email'],
      passReqToCallback: true
    }, this.handleGoogleCallback.bind(this)));

    // GitHub OAuth Strategy
    passport.use(new GitHubStrategy({
      clientID: config.oauth.github.clientId,
      clientSecret: config.oauth.github.clientSecret,
      callbackURL: config.oauth.github.callbackUrl,
      scope: ['user:email'],
      passReqToCallback: true
    }, this.handleGitHubCallback.bind(this)));

    // Serialize user for session
    passport.serializeUser((user, done) => {
      done(null, user.id);
    });

    // Deserialize user from session
    passport.deserializeUser(async (id, done) => {
      try {
        const user = await authService.getUserById(id);
        done(null, user);
      } catch (error) {
        logger.error('Failed to deserialize user:', error);
        done(error, null);
      }
    });
  }

  // Handle Google OAuth callback
  async handleGoogleCallback(req, accessToken, refreshToken, profile, done) {
    try {
      logger.info('Google OAuth callback', {
        googleId: profile.id,
        email: profile.emails?.[0]?.value
      });

      // Find user by Google provider ID or email
      let user = await this.findUserByGoogleId(profile.id);

      if (!user) {
        // Check if user exists with same email
        const email = profile.emails?.[0]?.value;
        if (email) {
          user = await authService.getUserByEmail(email);

          if (user) {
            // Link Google account to existing user
            await this.linkGoogleAccount(user.id, profile);
            logger.info('Google account linked to existing user', {
              userId: user.id,
              googleId: profile.id
            });
          } else {
            // Create new user from Google profile
            user = await this.createGoogleUser(profile);
            logger.info('New user created from Google OAuth', {
              userId: user.id,
              email: user.email
            });
          }
        }
      } else {
        // Update last login and sync profile data
        await this.updateGoogleUser(user, profile);
        logger.info('Existing Google user logged in', { userId: user.id });
      }

      return done(null, user);

    } catch (error) {
      logger.error('Google OAuth callback error:', error);
      return done(error, null);
    }
  }

  // Handle GitHub OAuth callback
  async handleGitHubCallback(req, accessToken, refreshToken, profile, done) {
    try {
      logger.info('GitHub OAuth callback', {
        githubId: profile.id,
        username: profile.username
      });

      // Find user by GitHub provider ID
      let user = await this.findUserByGitHubId(profile.id);

      if (!user) {
        // Get primary email from profile (GitHub may have multiple emails)
        const email = profile.emails?.find(email => email.primary)?.value ||
                     profile.emails?.[0]?.value;

        if (email) {
          user = await authService.getUserByEmail(email);

          if (user) {
            // Link GitHub account to existing user
            await this.linkGitHubAccount(user.id, profile);
            logger.info('GitHub account linked to existing user', {
              userId: user.id,
              githubId: profile.id
            });
          } else {
            // Create new user from GitHub profile
            user = await this.createGitHubUser(profile);
            logger.info('New user created from GitHub OAuth', {
              userId: user.id,
              email: user.email
            });
          }
        }
      } else {
        // Update last login and sync profile data
        await this.updateGitHubUser(user, profile);
        logger.info('Existing GitHub user logged in', { userId: user.id });
      }

      return done(null, user);

    } catch (error) {
      logger.error('GitHub OAuth callback error:', error);
      return done(error, null);
    }
  }

  // Find user by Google provider ID
  async findUserByGoogleId(googleId) {
    try {
      const query = `
        SELECT u.* FROM users u
        JOIN oauth_providers op ON u.id = op.user_id
        WHERE op.provider_name = 'google' AND op.provider_id = $1
      `;

      const result = await dbConnection.query(query, [googleId]);
      return result.rows.length > 0 ? User.fromDBRow(result.rows[0]) : null;

    } catch (error) {
      logger.error('Failed to find user by Google ID:', error);
      throw error;
    }
  }

  // Find user by GitHub provider ID
  async findUserByGitHubId(githubId) {
    try {
      const query = `
        SELECT u.* FROM users u
        JOIN oauth_providers op ON u.id = op.user_id
        WHERE op.provider_name = 'github' AND op.provider_id = $1
      `;

      const result = await dbConnection.query(query, [githubId]);
      return result.rows.length > 0 ? User.fromDBRow(result.rows[0]) : null;

    } catch (error) {
      logger.error('Failed to find user by GitHub ID:', error);
      throw error;
    }
  }

  // Create new user from Google profile
  async createGoogleUser(profile) {
    const client = await dbConnection.getClient();
    try {
      await client.query('BEGIN');

      const email = profile.emails?.[0]?.value;
      const name = profile.displayName || profile.name?.givenName + ' ' + profile.name?.familyName;
      const avatarUrl = profile.photos?.[0]?.value;

      // Create user
      const userQuery = `
        INSERT INTO users (email, email_verified, name, avatar_url, roles, is_active)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id, email, email_verified, name, avatar_url, roles, created_at, updated_at
      `;

      const userResult = await client.query(userQuery, [
        email,
        true, // Google emails are verified
        name,
        avatarUrl,
        JSON.stringify(['user']),
        true
      ]);

      const user = User.fromDBRow(userResult.rows[0]);

      // Create OAuth provider record
      const providerQuery = `
        INSERT INTO oauth_providers (user_id, provider_name, provider_id, provider_data)
        VALUES ($1, $2, $3, $4)
        RETURNING id
      `;

      await client.query(providerQuery, [
        user.id,
        'google',
        profile.id,
        JSON.stringify({
          id: profile.id,
          email: email,
          name: name,
          avatarUrl: avatarUrl,
          accessToken: accessToken,
          refreshToken: refreshToken
        })
      ]);

      await client.query('COMMIT');
      return user;

    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Failed to create Google user:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  // Create new user from GitHub profile
  async createGitHubUser(profile) {
    const client = await dbConnection.getClient();
    try {
      await client.query('BEGIN');

      const email = profile.emails?.find(email => email.primary)?.value ||
                   profile.emails?.[0]?.value;
      const name = profile.displayName || profile.username;
      const avatarUrl = profile.photos?.[0]?.value;

      // Create user
      const userQuery = `
        INSERT INTO users (email, email_verified, name, avatar_url, roles, is_active)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id, email, email_verified, name, avatar_url, roles, created_at, updated_at
      `;

      const userResult = await client.query(userQuery, [
        email,
        !!email, // GitHub emails may not be verified
        name,
        avatarUrl,
        JSON.stringify(['user']),
        true
      ]);

      const user = User.fromDBRow(userResult.rows[0]);

      // Create OAuth provider record
      const providerQuery = `
        INSERT INTO oauth_providers (user_id, provider_name, provider_id, provider_data)
        VALUES ($1, $2, $3, $4)
        RETURNING id
      `;

      await client.query(providerQuery, [
        user.id,
        'github',
        profile.id,
        JSON.stringify({
          id: profile.id,
          username: profile.username,
          email: email,
          name: name,
          avatarUrl: avatarUrl,
          accessToken: accessToken,
          refreshToken: refreshToken
        })
      ]);

      await client.query('COMMIT');
      return user;

    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Failed to create GitHub user:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  // Link Google account to existing user
  async linkGoogleAccount(userId, profile) {
    try {
      const query = `
        INSERT INTO oauth_providers (user_id, provider_name, provider_id, provider_data)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (user_id, provider_name) DO UPDATE SET
          provider_id = EXCLUDED.provider_id,
          provider_data = EXCLUDED.provider_data,
          updated_at = CURRENT_TIMESTAMP
      `;

      await dbConnection.query(query, [
        userId,
        'google',
        profile.id,
        JSON.stringify({
          id: profile.id,
          email: profile.emails?.[0]?.value,
          name: profile.displayName,
          avatarUrl: profile.photos?.[0]?.value
        })
      ]);

    } catch (error) {
      logger.error('Failed to link Google account:', error);
      throw error;
    }
  }

  // Link GitHub account to existing user
  async linkGitHubAccount(userId, profile) {
    try {
      const query = `
        INSERT INTO oauth_providers (user_id, provider_name, provider_id, provider_data)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (user_id, provider_name) DO UPDATE SET
          provider_id = EXCLUDED.provider_id,
          provider_data = EXCLUDED.provider_data,
          updated_at = CURRENT_TIMESTAMP
      `;

      await dbConnection.query(query, [
        userId,
        'github',
        profile.id,
        JSON.stringify({
          id: profile.id,
          username: profile.username,
          email: profile.emails?.[0]?.value,
          name: profile.displayName,
          avatarUrl: profile.photos?.[0]?.value
        })
      ]);

    } catch (error) {
      logger.error('Failed to link GitHub account:', error);
      throw error;
    }
  }

  // Update existing Google user
  async updateGoogleUser(user, profile) {
    try {
      // Update user profile if needed
      const email = profile.emails?.[0]?.value;
      const name = profile.displayName || profile.name?.givenName + ' ' + profile.name?.familyName;
      const avatarUrl = profile.photos?.[0]?.value;

      await authService.updateProfile(user.id, {
        name: name,
        avatar_url: avatarUrl
      });

      // Update provider data
      await this.updateProviderData(user.id, 'google', {
        id: profile.id,
        email: email,
        name: name,
        avatarUrl: avatarUrl
      });

      // Update last login
      await authService.updateLastLogin(user.id);

    } catch (error) {
      logger.error('Failed to update Google user:', error);
      throw error;
    }
  }

  // Update existing GitHub user
  async updateGitHubUser(user, profile) {
    try {
      // Update user profile if needed
      const email = profile.emails?.find(email => email.primary)?.value ||
                   profile.emails?.[0]?.value;
      const name = profile.displayName || profile.username;
      const avatarUrl = profile.photos?.[0]?.value;

      await authService.updateProfile(user.id, {
        name: name,
        avatar_url: avatarUrl
      });

      // Update provider data
      await this.updateProviderData(user.id, 'github', {
        id: profile.id,
        username: profile.username,
        email: email,
        name: name,
        avatarUrl: avatarUrl
      });

      // Update last login
      await authService.updateLastLogin(user.id);

    } catch (error) {
      logger.error('Failed to update GitHub user:', error);
      throw error;
    }
  }

  // Update OAuth provider data
  async updateProviderData(userId, providerName, providerData) {
    try {
      const query = `
        UPDATE oauth_providers
        SET provider_data = $1, updated_at = CURRENT_TIMESTAMP
        WHERE user_id = $2 AND provider_name = $3
      `;

      await dbConnection.query(query, [
        JSON.stringify(providerData),
        userId,
        providerName
      ]);

    } catch (error) {
      logger.error('Failed to update provider data:', error);
      throw error;
    }
  }

  // Get user's linked OAuth providers
  async getUserProviders(userId) {
    try {
      const query = `
        SELECT provider_name, provider_id, provider_data, created_at, updated_at
        FROM oauth_providers
        WHERE user_id = $1
        ORDER BY created_at DESC
      `;

      const result = await dbConnection.query(query, [userId]);
      return result.rows;

    } catch (error) {
      logger.error('Failed to get user providers:', error);
      throw error;
    }
  }

  // Unlink OAuth provider
  async unlinkProvider(userId, providerName) {
    try {
      const query = `
        DELETE FROM oauth_providers
        WHERE user_id = $1 AND provider_name = $2
        RETURNING id
      `;

      const result = await dbConnection.query(query, [userId, providerName]);

      if (result.rowCount === 0) {
        throw new Error('Provider not found or already unlinked');
      }

      logger.info('OAuth provider unlinked', { userId, providerName });
      return true;

    } catch (error) {
      logger.error('Failed to unlink provider:', error);
      throw error;
    }
  }

  // Generate OAuth state for security
  generateOAuthState() {
    return require('crypto').randomBytes(32).toString('hex');
  }

  // Verify OAuth state
  verifyOAuthState(state, sessionState) {
    return state && sessionState && state === sessionState;
  }
}

// Create singleton instance
const oAuthService = new OAuthService();

module.exports = oAuthService;