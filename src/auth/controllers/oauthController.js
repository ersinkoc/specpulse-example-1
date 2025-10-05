const oAuthService = require('../services/oAuthService');
const tokenService = require('../services/tokenService');
const authService = require('../services/authService');
const logger = require('../../shared/utils/logger');
const config = require('../../shared/config/environment');

class OAuthController {
  // Initialize OAuth flow for Google
  async googleAuth(req, res) {
    try {
      // Generate and store state for security
      const state = oAuthService.generateOAuthState();
      req.session.oauthState = state;

      // Store return URL if provided
      if (req.query.returnUrl) {
        req.session.returnUrl = req.query.returnUrl;
      }

      logger.debug('Google OAuth initiated', {
        state,
        ip: req.ip,
        userAgent: req.get('User-Agent')
      });

      // Redirect to Google OAuth
      const authorizationUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
        `client_id=${config.oauth.google.clientId}&` +
        `redirect_uri=${encodeURIComponent(config.oauth.google.callbackUrl)}&` +
        `response_type=code&` +
        `scope=profile email&` +
        `state=${state}&` +
        `access_type=offline&` +
        `prompt=consent`;

      res.redirect(authorizationUrl);

    } catch (error) {
      logger.error('Google OAuth initiation failed:', error);
      res.status(500).json({
        success: false,
        error: 'OAuthInitiationError',
        message: 'Failed to initiate Google OAuth'
      });
    }
  }

  // Handle Google OAuth callback
  async googleCallback(req, res) {
    try {
      const { code, state, error } = req.query;

      // Check for OAuth errors
      if (error) {
        logger.warn('Google OAuth error', { error, state });
        return res.redirect(`${config.frontend.url}/auth/error?provider=google&error=${error}`);
      }

      // Verify state for security
      if (!state || !req.session.oauthState || state !== req.session.oauthState) {
        logger.warn('Invalid OAuth state', {
          receivedState: state,
          sessionState: req.session.oauthState
        });
        return res.redirect(`${config.frontend.url}/auth/error?provider=google&error=invalid_state`);
      }

      // Clear state from session
      delete req.session.oauthState;

      // Exchange authorization code for tokens and authenticate user
      passport.authenticate('google', { session: false }, async (err, user, info) => {
        if (err) {
          logger.error('Google authentication error:', err);
          return res.redirect(`${config.frontend.url}/auth/error?provider=google&error=authentication_failed`);
        }

        if (!user) {
          logger.warn('Google authentication failed', info);
          return res.redirect(`${config.frontend.url}/auth/error?provider=google&error=authentication_failed`);
        }

        try {
          // Generate JWT tokens
          const tokens = await tokenService.generateTokenPair(user, {
            deviceInfo: req.deviceInfo || {},
            ipAddress: req.ip,
            userAgent: req.get('User-Agent')
          });

          logger.info('Google authentication successful', {
            userId: user.id,
            email: user.email,
            ip: req.ip
          });

          // Get return URL or default
          const returnUrl = req.session.returnUrl || `${config.frontend.url}/dashboard`;
          delete req.session.returnUrl;

          // Redirect with tokens (or use a more secure method in production)
          const redirectUrl = new URL(returnUrl);
          redirectUrl.searchParams.set('accessToken', tokens.accessToken);
          redirectUrl.searchParams.set('refreshToken', tokens.refreshToken);
          redirectUrl.searchParams.set('expiresIn', tokens.expiresIn);
          redirectUrl.searchParams.set('user', JSON.stringify(user.toJSON()));

          res.redirect(redirectUrl.toString());

        } catch (tokenError) {
          logger.error('Token generation failed during Google callback:', tokenError);
          res.redirect(`${config.frontend.url}/auth/error?provider=google&error=token_generation_failed`);
        }
      })(req, res);

    } catch (error) {
      logger.error('Google OAuth callback error:', error);
      res.redirect(`${config.frontend.url}/auth/error?provider=google&error=callback_failed`);
    }
  }

  // Initialize OAuth flow for GitHub
  async githubAuth(req, res) {
    try {
      // Generate and store state for security
      const state = oAuthService.generateOAuthState();
      req.session.oauthState = state;

      // Store return URL if provided
      if (req.query.returnUrl) {
        req.session.returnUrl = req.query.returnUrl;
      }

      logger.debug('GitHub OAuth initiated', {
        state,
        ip: req.ip,
        userAgent: req.get('User-Agent')
      });

      // Redirect to GitHub OAuth
      const authorizationUrl = `https://github.com/login/oauth/authorize?` +
        `client_id=${config.oauth.github.clientId}&` +
        `redirect_uri=${encodeURIComponent(config.oauth.github.callbackUrl)}&` +
        `scope=user:email&` +
        `state=${state}`;

      res.redirect(authorizationUrl);

    } catch (error) {
      logger.error('GitHub OAuth initiation failed:', error);
      res.status(500).json({
        success: false,
        error: 'OAuthInitiationError',
        message: 'Failed to initiate GitHub OAuth'
      });
    }
  }

  // Handle GitHub OAuth callback
  async githubCallback(req, res) {
    try {
      const { code, state, error } = req.query;

      // Check for OAuth errors
      if (error) {
        logger.warn('GitHub OAuth error', { error, state });
        return res.redirect(`${config.frontend.url}/auth/error?provider=github&error=${error}`);
      }

      // Verify state for security
      if (!state || !req.session.oauthState || state !== req.session.oauthState) {
        logger.warn('Invalid OAuth state', {
          receivedState: state,
          sessionState: req.session.oauthState
        });
        return res.redirect(`${config.frontend.url}/auth/error?provider=github&error=invalid_state`);
      }

      // Clear state from session
      delete req.session.oauthState;

      // Exchange authorization code for tokens and authenticate user
      passport.authenticate('github', { session: false }, async (err, user, info) => {
        if (err) {
          logger.error('GitHub authentication error:', err);
          return res.redirect(`${config.frontend.url}/auth/error?provider=github&error=authentication_failed`);
        }

        if (!user) {
          logger.warn('GitHub authentication failed', info);
          return res.redirect(`${config.frontend.url}/auth/error?provider=github&error=authentication_failed`);
        }

        try {
          // Generate JWT tokens
          const tokens = await tokenService.generateTokenPair(user, {
            deviceInfo: req.deviceInfo || {},
            ipAddress: req.ip,
            userAgent: req.get('User-Agent')
          });

          logger.info('GitHub authentication successful', {
            userId: user.id,
            email: user.email,
            ip: req.ip
          });

          // Get return URL or default
          const returnUrl = req.session.returnUrl || `${config.frontend.url}/dashboard`;
          delete req.session.returnUrl;

          // Redirect with tokens (or use a more secure method in production)
          const redirectUrl = new URL(returnUrl);
          redirectUrl.searchParams.set('accessToken', tokens.accessToken);
          redirectUrl.searchParams.set('refreshToken', tokens.refreshToken);
          redirectUrl.searchParams.set('expiresIn', tokens.expiresIn);
          redirectUrl.searchParams.set('user', JSON.stringify(user.toJSON()));

          res.redirect(redirectUrl.toString());

        } catch (tokenError) {
          logger.error('Token generation failed during GitHub callback:', tokenError);
          res.redirect(`${config.frontend.url}/auth/error?provider=github&error=token_generation_failed`);
        }
      })(req, res);

    } catch (error) {
      logger.error('GitHub OAuth callback error:', error);
      res.redirect(`${config.frontend.url}/auth/error?provider=github&error=callback_failed`);
    }
  }

  // Get user's linked OAuth providers
  async getProviders(req, res) {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          error: 'AuthenticationRequired',
          message: 'Authentication required'
        });
      }

      const providers = await oAuthService.getUserProviders(req.user.id);

      res.json({
        success: true,
        data: {
          providers: providers.map(provider => ({
            providerName: provider.provider_name,
            providerId: provider.provider_id,
            createdAt: provider.created_at,
            updatedAt: provider.updated_at
          }))
        }
      });

    } catch (error) {
      logger.error('Failed to get user providers:', error);
      res.status(500).json({
        success: false,
        error: 'GetProvidersError',
        message: 'Failed to retrieve OAuth providers'
      });
    }
  }

  // Unlink OAuth provider
  async unlinkProvider(req, res) {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          error: 'AuthenticationRequired',
          message: 'Authentication required'
        });
      }

      const { providerName } = req.params;

      if (!providerName || !['google', 'github'].includes(providerName)) {
        return res.status(400).json({
          success: false,
          error: 'InvalidProvider',
          message: 'Invalid provider name'
        });
      }

      // Check if user has password (required if unlinking the only OAuth provider)
      const user = await authService.getUserById(req.user.id);
      if (!user.passwordHash) {
        // Check if user has other OAuth providers linked
        const providers = await oAuthService.getUserProviders(req.user.id);
        if (providers.length <= 1) {
          return res.status(400).json({
            success: false,
            error: 'CannotUnlinkLastProvider',
            message: 'You must set a password before unlinking your only OAuth provider'
          });
        }
      }

      await oAuthService.unlinkProvider(req.user.id, providerName);

      logger.info('OAuth provider unlinked successfully', {
        userId: req.user.id,
        providerName
      });

      res.json({
        success: true,
        message: `${providerName} account unlinked successfully`
      });

    } catch (error) {
      logger.error('Failed to unlink provider:', error);
      res.status(500).json({
        success: false,
        error: 'UnlinkProviderError',
        message: 'Failed to unlink OAuth provider'
      });
    }
  }

  // OAuth error handler
  oauthError(req, res) {
    const { provider, error } = req.query;

    logger.warn('OAuth error occurred', {
      provider,
      error,
      ip: req.ip
    });

    res.status(400).json({
      success: false,
      error: 'OAuthError',
      message: `OAuth authentication failed: ${error}`,
      provider,
      details: error
    });
  }

  // OAuth success handler (alternative redirect method)
  oauthSuccess(req, res) {
    try {
      const { accessToken, refreshToken, expiresIn, user } = req.query;

      logger.info('OAuth success redirect', {
        provider: req.query.provider,
        userId: user ? JSON.parse(user).id : null
      });

      // In a real application, you might want to set secure HTTP-only cookies
      // instead of passing tokens in the URL for better security

      res.json({
        success: true,
        message: 'OAuth authentication successful',
        data: {
          accessToken,
          refreshToken,
          expiresIn,
          user: user ? JSON.parse(user) : null
        }
      });

    } catch (error) {
      logger.error('OAuth success handler error:', error);
      res.status(500).json({
        success: false,
        error: 'OAuthSuccessError',
        message: 'Failed to process OAuth success'
      });
    }
  }
}

module.exports = new OAuthController();