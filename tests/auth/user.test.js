const request = require('supertest');
const app = require('../../src/app');
const { testPool, cleanupTestData } = require('../setup');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const config = require('../../src/shared/config/environment');

describe('User Management Endpoints', () => {
  let testUser, accessToken;

  beforeEach(async () => {
    await cleanupTestData();

    // Create test user
    const hashedPassword = await bcrypt.hash('testpassword123', 12);
    const result = await testPool.query(
      `INSERT INTO users (email, email_verified, password_hash, name, roles, is_active)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      ['test@example.com', true, hashedPassword, 'Test User', JSON.stringify(['user']), true]
    );

    testUser = result.rows[0];

    // Generate access token for test user
    accessToken = jwt.sign(
      {
        sub: testUser.id,
        email: testUser.email,
        roles: ['user'],
        type: 'access',
        iat: Math.floor(Date.now() / 1000),
        iss: 'specpulse',
        aud: 'specpulse-users'
      },
      config.jwt.accessSecret,
      { expiresIn: '1h' }
    );
  });

  describe('GET /user/profile', () => {
    it('should return user profile', async () => {
      const response = await request(app)
        .get('/user/profile')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.user.email).toBe(testUser.email);
      expect(response.body.user.name).toBe(testUser.name);
      expect(response.body.user.providers).toBeDefined();
      expect(response.body.user.activeSessions).toBeDefined();
    });

    it('should return error without authentication', async () => {
      const response = await request(app)
        .get('/user/profile')
        .expect(401);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('AuthenticationRequired');
    });
  });

  describe('PUT /user/profile', () => {
    it('should update user profile successfully', async () => {
      const updateData = {
        name: 'Updated Name',
        bio: 'This is my updated bio'
      };

      const response = await request(app)
        .put('/user/profile')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(updateData)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.user.name).toBe(updateData.name);
      expect(response.body.message).toContain('Profile updated successfully');
    });

    it('should return error for invalid name format', async () => {
      const updateData = {
        name: '123InvalidName'
      };

      const response = await request(app)
        .put('/user/profile')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(updateData)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('ValidationError');
    });

    it('should return error for empty name', async () => {
      const updateData = {
        name: ''
      };

      const response = await request(app)
        .put('/user/profile')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(updateData)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('ValidationError');
    });

    it('should return error for invalid avatar URL', async () => {
      const updateData = {
        avatar_url: 'invalid-url'
      };

      const response = await request(app)
        .put('/user/profile')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(updateData)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('ValidationError');
    });
  });

  describe('GET /user/preferences', () => {
    it('should return user preferences', async () => {
      const response = await request(app)
        .get('/user/preferences')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.preferences.theme).toBe('light');
      expect(response.body.preferences.language).toBe('en');
      expect(response.body.preferences.notifications).toBeDefined();
      expect(response.body.preferences.privacy).toBeDefined();
    });

    it('should return error without authentication', async () => {
      const response = await request(app)
        .get('/user/preferences')
        .expect(401);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('AuthenticationRequired');
    });
  });

  describe('PUT /user/preferences', () => {
    it('should update user preferences successfully', async () => {
      const preferencesData = {
        preferences: {
          theme: 'dark',
          language: 'es',
          notifications: {
            email: false,
            push: true,
            security: true
          },
          privacy: {
            showEmail: true,
            showProfile: false
          }
        }
      };

      const response = await request(app)
        .put('/user/preferences')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(preferencesData)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.preferences.theme).toBe('dark');
      expect(response.body.preferences.language).toBe('es');
      expect(response.body.message).toContain('Preferences updated successfully');
    });

    it('should return error for invalid theme', async () => {
      const preferencesData = {
        preferences: {
          theme: 'invalid-theme'
        }
      };

      const response = await request(app)
        .put('/user/preferences')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(preferencesData)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('ValidationError');
    });

    it('should return error for missing preferences object', async () => {
      const response = await request(app)
        .put('/user/preferences')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({})
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('ValidationError');
    });
  });

  describe('POST /user/change-password', () => {
    it('should change password successfully', async () => {
      const passwordData = {
        currentPassword: 'testpassword123',
        newPassword: 'newpassword456',
        confirmPassword: 'newpassword456'
      };

      const response = await request(app)
        .post('/user/change-password')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(passwordData)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toContain('Password changed successfully');
    });

    it('should return error for incorrect current password', async () => {
      const passwordData = {
        currentPassword: 'wrongpassword',
        newPassword: 'newpassword456',
        confirmPassword: 'newpassword456'
      };

      const response = await request(app)
        .post('/user/change-password')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(passwordData)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('IncorrectPassword');
    });

    it('should return error for password mismatch', async () => {
      const passwordData = {
        currentPassword: 'testpassword123',
        newPassword: 'newpassword456',
        confirmPassword: 'differentpassword'
      };

      const response = await request(app)
        .post('/user/change-password')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(passwordData)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('ValidationError');
    });

    it('should return error for weak password', async () => {
      const passwordData = {
        currentPassword: 'testpassword123',
        newPassword: '123',
        confirmPassword: '123'
      };

      const response = await request(app)
        .post('/user/change-password')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(passwordData)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('WeakPassword');
    });
  });

  describe('DELETE /user/sessions', () => {
    beforeEach(async () => {
      // Create refresh token for test user
      const sessionId = 'test-session-' + Date.now();
      const refreshToken = jwt.sign(
        {
          sub: testUser.id,
          email: testUser.email,
          type: 'refresh',
          sessionId: sessionId,
          iat: Math.floor(Date.now() / 1000),
          iss: 'specpulse',
          aud: 'specpulse-users'
        },
        config.jwt.refreshSecret,
        { expiresIn: '7d', jwtid: sessionId }
      );

      // Store refresh token in database
      await testPool.query(
        `INSERT INTO refresh_tokens
         (user_id, token, device_info, ip_address, user_agent, is_active, created_at, expires_at, last_used_at)
         VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP, $7, CURRENT_TIMESTAMP)`,
        [
          testUser.id,
          refreshToken,
          JSON.stringify({ type: 'test' }),
          '127.0.0.1',
          'test-agent',
          true,
          new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
        ]
      );
    });

    it('should revoke all user sessions successfully', async () => {
      const response = await request(app)
        .delete('/user/sessions')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toContain('All sessions revoked successfully');
      expect(response.body.revokedSessions).toBeGreaterThanOrEqual(0);
    });

    it('should return error without authentication', async () => {
      const response = await request(app)
        .delete('/user/sessions')
        .expect(401);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('AuthenticationRequired');
    });
  });

  describe('DELETE /user/account', () => {
    it('should delete user account successfully', async () => {
      const deleteData = {
        password: 'testpassword123',
        confirmation: 'DELETE'
      };

      const response = await request(app)
        .delete('/user/account')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(deleteData)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toContain('Account deleted successfully');
    });

    it('should return error for incorrect password', async () => {
      const deleteData = {
        password: 'wrongpassword',
        confirmation: 'DELETE'
      };

      const response = await request(app)
        .delete('/user/account')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(deleteData)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('IncorrectPassword');
    });

    it('should return error for invalid confirmation', async () => {
      const deleteData = {
        password: 'testpassword123',
        confirmation: 'DELETEME'
      };

      const response = await request(app)
        .delete('/user/account')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(deleteData)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('ValidationError');
    });

    it('should return error for missing password', async () => {
      const deleteData = {
        confirmation: 'DELETE'
      };

      const response = await request(app)
        .delete('/user/account')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(deleteData)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('ValidationError');
    });

    it('should return error for missing confirmation', async () => {
      const deleteData = {
        password: 'testpassword123'
      };

      const response = await request(app)
        .delete('/user/account')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(deleteData)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('ValidationError');
    });

    it('should return error without authentication', async () => {
      const deleteData = {
        password: 'testpassword123',
        confirmation: 'DELETE'
      };

      const response = await request(app)
        .delete('/user/account')
        .send(deleteData)
        .expect(401);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('AuthenticationRequired');
    });
  });
});