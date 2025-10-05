const request = require('supertest');
const app = require('../../src/app');
const { testPool, cleanupTestData } = require('../setup');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const config = require('../../src/shared/config/environment');

describe('Authentication Endpoints', () => {
  let testUser;

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
  });

  describe('POST /auth/register', () => {
    it('should register a new user successfully', async () => {
      const userData = {
        email: 'newuser@example.com',
        password: 'newpassword123',
        name: 'New User',
        confirmPassword: 'newpassword123'
      };

      const response = await request(app)
        .post('/auth/register')
        .send(userData)
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toContain('Registration successful');
      expect(response.body.user.email).toBe(userData.email);
      expect(response.body.user.name).toBe(userData.name);
      expect(response.body.user.emailVerified).toBe(false);
    });

    it('should return error for duplicate email', async () => {
      const userData = {
        email: 'test@example.com',
        password: 'password123',
        name: 'Duplicate User',
        confirmPassword: 'password123'
      };

      const response = await request(app)
        .post('/auth/register')
        .send(userData)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('EmailExistsError');
    });

    it('should return error for weak password', async () => {
      const userData = {
        email: 'weak@example.com',
        password: '123',
        name: 'Weak User',
        confirmPassword: '123'
      };

      const response = await request(app)
        .post('/auth/register')
        .send(userData)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('WeakPassword');
    });

    it('should return error for invalid email', async () => {
      const userData = {
        email: 'invalid-email',
        password: 'password123',
        name: 'Invalid Email User',
        confirmPassword: 'password123'
      };

      const response = await request(app)
        .post('/auth/register')
        .send(userData)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('ValidationError');
    });

    it('should return error for password mismatch', async () => {
      const userData = {
        email: 'mismatch@example.com',
        password: 'password123',
        name: 'Mismatch User',
        confirmPassword: 'differentpassword'
      };

      const response = await request(app)
        .post('/auth/register')
        .send(userData)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('ValidationError');
    });
  });

  describe('POST /auth/login', () => {
    it('should login user successfully', async () => {
      const loginData = {
        email: 'test@example.com',
        password: 'testpassword123'
      };

      const response = await request(app)
        .post('/auth/login')
        .send(loginData)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.user.email).toBe(testUser.email);
      expect(response.body.tokens.accessToken).toBeDefined();
      expect(response.body.tokens.refreshToken).toBeDefined();
      expect(response.body.tokens.tokenType).toBe('Bearer');
    });

    it('should return error for invalid credentials', async () => {
      const loginData = {
        email: 'test@example.com',
        password: 'wrongpassword'
      };

      const response = await request(app)
        .post('/auth/login')
        .send(loginData)
        .expect(401);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('AuthenticationError');
    });

    it('should return error for non-existent user', async () => {
      const loginData = {
        email: 'nonexistent@example.com',
        password: 'password123'
      };

      const response = await request(app)
        .post('/auth/login')
        .send(loginData)
        .expect(401);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('AuthenticationError');
    });

    it('should return error for missing email', async () => {
      const loginData = {
        password: 'testpassword123'
      };

      const response = await request(app)
        .post('/auth/login')
        .send(loginData)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('ValidationError');
    });
  });

  describe('POST /auth/logout', () => {
    let accessToken;

    beforeEach(async () => {
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

    it('should logout user successfully', async () => {
      const response = await request(app)
        .post('/auth/logout')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toContain('Logout successful');
    });

    it('should return error without authentication', async () => {
      const response = await request(app)
        .post('/auth/logout')
        .expect(401);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('AuthenticationRequired');
    });

    it('should return error with invalid token', async () => {
      const response = await request(app)
        .post('/auth/logout')
        .set('Authorization', 'Bearer invalid-token')
        .expect(401);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('InvalidTokenError');
    });
  });

  describe('POST /auth/refresh-token', () => {
    let refreshToken;

    beforeEach(async () => {
      // Create refresh token for test user
      const sessionId = 'test-session-' + Date.now();
      refreshToken = jwt.sign(
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

    it('should refresh access token successfully', async () => {
      const response = await request(app)
        .post('/auth/refresh-token')
        .send({ refreshToken })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.accessToken).toBeDefined();
      expect(response.body.refreshToken).toBeDefined();
      expect(response.body.tokenType).toBe('Bearer');
    });

    it('should return error for invalid refresh token', async () => {
      const response = await request(app)
        .post('/auth/refresh-token')
        .send({ refreshToken: 'invalid-refresh-token' })
        .expect(401);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('TokenRefreshFailed');
    });

    it('should return error for missing refresh token', async () => {
      const response = await request(app)
        .post('/auth/refresh-token')
        .send({})
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('ValidationError');
    });
  });

  describe('POST /auth/forgot-password', () => {
    it('should send password reset email for existing user', async () => {
      const response = await request(app)
        .post('/auth/forgot-password')
        .send({ email: 'test@example.com' })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toContain('password reset instructions');
    });

    it('should return success message for non-existent user (security)', async () => {
      const response = await request(app)
        .post('/auth/forgot-password')
        .send({ email: 'nonexistent@example.com' })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toContain('password reset instructions');
    });

    it('should return error for invalid email format', async () => {
      const response = await request(app)
        .post('/auth/forgot-password')
        .send({ email: 'invalid-email' })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('ValidationError');
    });
  });

  describe('GET /auth/me', () => {
    let accessToken;

    beforeEach(async () => {
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

    it('should return current user data', async () => {
      const response = await request(app)
        .get('/auth/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.user.email).toBe(testUser.email);
      expect(response.body.user.name).toBe(testUser.name);
    });

    it('should return error without authentication', async () => {
      const response = await request(app)
        .get('/auth/me')
        .expect(401);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('AuthenticationRequired');
    });
  });

  describe('POST /auth/change-password', () => {
    let accessToken;

    beforeEach(async () => {
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

    it('should change password successfully', async () => {
      const passwordData = {
        currentPassword: 'testpassword123',
        newPassword: 'newpassword456',
        confirmPassword: 'newpassword456'
      };

      const response = await request(app)
        .post('/auth/change-password')
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
        .post('/auth/change-password')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(passwordData)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('IncorrectPassword');
    });

    it('should return error for weak new password', async () => {
      const passwordData = {
        currentPassword: 'testpassword123',
        newPassword: '123',
        confirmPassword: '123'
      };

      const response = await request(app)
        .post('/auth/change-password')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(passwordData)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('WeakPassword');
    });
  });
});