const nodemailer = require('nodemailer');
const config = require('../../shared/config/environment');
const logger = require('../../shared/utils/logger');
const { utils: securityUtils } = require('../../shared/config/security');

class EmailService {
  constructor() {
    this.transporter = null;
    this.isConfigured = false;
  }

  async initialize() {
    try {
      // Create transporter with SMTP configuration
      this.transporter = nodemailer.createTransporter({
        host: config.email.host,
        port: config.email.port,
        secure: config.email.secure,
        auth: {
          user: config.email.auth.user,
          pass: config.email.auth.pass
        },
        // Add debugging in development
        ...(config.server.nodeEnv === 'development' && {
          logger: true,
          debug: true
        })
      });

      // Verify connection
      await this.transporter.verify();
      this.isConfigured = true;
      logger.info('Email service initialized successfully');

    } catch (error) {
      logger.error('Failed to initialize email service:', error);
      this.isConfigured = false;
      // In development, we can continue without email service
      if (config.server.nodeEnv === 'production') {
        throw new Error('Email service is required in production');
      } else {
        logger.warn('Email service not available in development mode');
      }
    }
  }

  // Send verification email
  async sendVerificationEmail(user, verificationToken) {
    if (!this.isConfigured) {
      logger.warn('Email service not configured, skipping verification email');
      return { success: false, reason: 'Email service not configured' };
    }

    const verificationUrl = `${config.server.nodeEnv === 'production' ? 'https://yourdomain.com' : 'http://localhost:3000'}/auth/verify-email?token=${verificationToken}`;

    const mailOptions = {
      from: config.email.from,
      to: user.email,
      subject: 'Verify your email address',
      html: this.getVerificationEmailTemplate(user.name, verificationUrl)
    };

    try {
      const result = await this.transporter.sendMail(mailOptions);
      logger.info('Verification email sent successfully', {
        to: user.email,
        messageId: result.messageId
      });
      return { success: true, messageId: result.messageId };
    } catch (error) {
      logger.error('Failed to send verification email:', error);
      return { success: false, error: error.message };
    }
  }

  // Send password reset email
  async sendPasswordResetEmail(user, resetToken) {
    if (!this.isConfigured) {
      logger.warn('Email service not configured, skipping password reset email');
      return { success: false, reason: 'Email service not configured' };
    }

    const resetUrl = `${config.server.nodeEnv === 'production' ? 'https://yourdomain.com' : 'http://localhost:3000'}/auth/reset-password?token=${resetToken}`;

    const mailOptions = {
      from: config.email.from,
      to: user.email,
      subject: 'Reset your password',
      html: this.getPasswordResetEmailTemplate(user.name, resetUrl)
    };

    try {
      const result = await this.transporter.sendMail(mailOptions);
      logger.info('Password reset email sent successfully', {
        to: user.email,
        messageId: result.messageId
      });
      return { success: true, messageId: result.messageId };
    } catch (error) {
      logger.error('Failed to send password reset email:', error);
      return { success: false, error: error.message };
    }
  }

  // Send welcome email
  async sendWelcomeEmail(user) {
    if (!this.isConfigured) {
      logger.warn('Email service not configured, skipping welcome email');
      return { success: false, reason: 'Email service not configured' };
    }

    const mailOptions = {
      from: config.email.from,
      to: user.email,
      subject: 'Welcome to our application!',
      html: this.getWelcomeEmailTemplate(user.name)
    };

    try {
      const result = await this.transporter.sendMail(mailOptions);
      logger.info('Welcome email sent successfully', {
        to: user.email,
        messageId: result.messageId
      });
      return { success: true, messageId: result.messageId };
    } catch (error) {
      logger.error('Failed to send welcome email:', error);
      return { success: false, error: error.message };
    }
  }

  // Send security alert email
  async sendSecurityAlert(user, alertType, details = {}) {
    if (!this.isConfigured) {
      logger.warn('Email service not configured, skipping security alert');
      return { success: false, reason: 'Email service not configured' };
    }

    const mailOptions = {
      from: config.email.from,
      to: user.email,
      subject: 'Security Alert - Account Activity',
      html: this.getSecurityAlertTemplate(user.name, alertType, details)
    };

    try {
      const result = await this.transporter.sendMail(mailOptions);
      logger.info('Security alert email sent successfully', {
        to: user.email,
        alertType,
        messageId: result.messageId
      });
      return { success: true, messageId: result.messageId };
    } catch (error) {
      logger.error('Failed to send security alert email:', error);
      return { success: false, error: error.message };
    }
  }

  // Email templates
  getVerificationEmailTemplate(userName, verificationUrl) {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>Verify Your Email</title>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #4a90e2; color: white; padding: 20px; text-align: center; }
          .content { padding: 20px; background: #f9f9f9; }
          .button { display: inline-block; padding: 12px 24px; background: #4a90e2; color: white; text-decoration: none; border-radius: 4px; margin: 20px 0; }
          .footer { padding: 20px; text-align: center; font-size: 12px; color: #666; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Verify Your Email Address</h1>
          </div>
          <div class="content">
            <p>Hi ${userName},</p>
            <p>Thank you for signing up! Please click the button below to verify your email address and activate your account.</p>
            <div style="text-align: center;">
              <a href="${verificationUrl}" class="button">Verify Email</a>
            </div>
            <p>Or copy and paste this link into your browser:</p>
            <p style="word-break: break-all; background: #eee; padding: 10px; border-radius: 4px;">${verificationUrl}</p>
            <p><strong>Note:</strong> This link will expire in 24 hours.</p>
          </div>
          <div class="footer">
            <p>If you didn't create an account, please ignore this email.</p>
            <p>&copy; 2025 Your Application. All rights reserved.</p>
          </div>
        </div>
      </body>
      </html>
    `;
  }

  getPasswordResetEmailTemplate(userName, resetUrl) {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>Reset Your Password</title>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #e74c3c; color: white; padding: 20px; text-align: center; }
          .content { padding: 20px; background: #f9f9f9; }
          .button { display: inline-block; padding: 12px 24px; background: #e74c3c; color: white; text-decoration: none; border-radius: 4px; margin: 20px 0; }
          .footer { padding: 20px; text-align: center; font-size: 12px; color: #666; }
          .warning { background: #fff3cd; border: 1px solid #ffeaa7; padding: 10px; border-radius: 4px; margin: 20px 0; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Reset Your Password</h1>
          </div>
          <div class="content">
            <p>Hi ${userName},</p>
            <p>We received a request to reset the password for your account. Click the button below to set a new password.</p>
            <div style="text-align: center;">
              <a href="${resetUrl}" class="button">Reset Password</a>
            </div>
            <p>Or copy and paste this link into your browser:</p>
            <p style="word-break: break-all; background: #eee; padding: 10px; border-radius: 4px;">${resetUrl}</p>
            <div class="warning">
              <strong>Security Notice:</strong>
              <ul>
                <li>This link will expire in 1 hour</li>
                <li>If you didn't request this password reset, please ignore this email</li>
                <li>Your password will not change until you click the link and create a new one</li>
              </ul>
            </div>
          </div>
          <div class="footer">
            <p>&copy; 2025 Your Application. All rights reserved.</p>
          </div>
        </div>
      </body>
      </html>
    `;
  }

  getWelcomeEmailTemplate(userName) {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>Welcome!</title>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #27ae60; color: white; padding: 20px; text-align: center; }
          .content { padding: 20px; background: #f9f9f9; }
          .button { display: inline-block; padding: 12px 24px; background: #27ae60; color: white; text-decoration: none; border-radius: 4px; margin: 20px 0; }
          .footer { padding: 20px; text-align: center; font-size: 12px; color: #666; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Welcome to Our Application!</h1>
          </div>
          <div class="content">
            <p>Hi ${userName},</p>
            <p>Thank you for joining us! Your account has been successfully created and verified.</p>
            <p>You can now:</p>
            <ul>
              <li>Access all features of our application</li>
              <li>Manage your profile settings</li>
              <li>Connect with other services</li>
              <li>Get updates and notifications</li>
            </ul>
            <div style="text-align: center;">
              <a href="${config.server.nodeEnv === 'production' ? 'https://yourdomain.com' : 'http://localhost:3000'}/dashboard" class="button">Go to Dashboard</a>
            </div>
            <p>If you have any questions, feel free to contact our support team.</p>
          </div>
          <div class="footer">
            <p>&copy; 2025 Your Application. All rights reserved.</p>
          </div>
        </div>
      </body>
      </html>
    `;
  }

  getSecurityAlertTemplate(userName, alertType, details) {
    const alerts = {
      'LOGIN_NEW_DEVICE': {
        title: 'New Device Login',
        message: 'We detected a login to your account from a new device.',
        details: `Device: ${details.device || 'Unknown'}<br>Location: ${details.location || 'Unknown'}<br>Time: ${new Date().toLocaleString()}`
      },
      'PASSWORD_CHANGED': {
        title: 'Password Changed',
        message: 'Your account password was recently changed.',
        details: `If you didn't make this change, please contact support immediately.<br>Time: ${new Date().toLocaleString()}`
      },
      'ACCOUNT_LOCKED': {
        title: 'Account Locked',
        message: 'Your account has been temporarily locked due to multiple failed login attempts.',
        details: `If this wasn't you, please reset your password immediately.<br>Time: ${new Date().toLocaleString()}`
      }
    };

    const alert = alerts[alertType] || alerts['LOGIN_NEW_DEVICE'];

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>Security Alert</title>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #e67e22; color: white; padding: 20px; text-align: center; }
          .content { padding: 20px; background: #f9f9f9; }
          .alert { background: #fff3cd; border: 1px solid #ffeaa7; padding: 15px; border-radius: 4px; margin: 20px 0; }
          .footer { padding: 20px; text-align: center; font-size: 12px; color: #666; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>🔒 Security Alert</h1>
          </div>
          <div class="content">
            <p>Hi ${userName},</p>
            <div class="alert">
              <h3>${alert.title}</h3>
              <p>${alert.message}</p>
              <p><strong>Details:</strong></p>
              <p>${alert.details}</p>
            </div>
            <p>If you don't recognize this activity, please:</p>
            <ol>
              <li>Change your password immediately</li>
              <li>Review your account settings</li>
              <li>Contact our support team</li>
            </ol>
            <div style="text-align: center;">
              <a href="${config.server.nodeEnv === 'production' ? 'https://yourdomain.com' : 'http://localhost:3000'}/account/security" class="button" style="background: #e67e22;">Review Account Security</a>
            </div>
          </div>
          <div class="footer">
            <p>&copy; 2025 Your Application. All rights reserved.</p>
          </div>
        </div>
      </body>
      </html>
    `;
  }

  // Health check
  async healthCheck() {
    if (!this.isConfigured) {
      return { status: 'unhealthy', reason: 'Email service not configured' };
    }

    try {
      await this.transporter.verify();
      return { status: 'healthy', timestamp: new Date().toISOString() };
    } catch (error) {
      return { status: 'unhealthy', reason: error.message, timestamp: new Date().toISOString() };
    }
  }
}

// Create singleton instance
const emailService = new EmailService();

module.exports = emailService;