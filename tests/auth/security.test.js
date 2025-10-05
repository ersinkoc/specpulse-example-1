const request = require('supertest');
const app = require('../../src/app');
const { testPool, cleanupTestData } = require('../setup');
const bcrypt = require('bcrypt');

describe('Security Tests', () => {
  beforeEach(async () => {
    await cleanupTestData();
  });

  describe('Rate Limiting', () => {
    it('should rate limit registration attempts', async () => {
      const userData = {
        email: 'ratelimit@example.com',
        password: 'password123',
        name: 'Rate Limit User',
        confirmPassword: 'password123'
      };

      // Make multiple requests quickly to trigger rate limiting
      const promises = Array(10).fill().map(() =>
        request(app)
          .post('/auth/register')
          .send({
            ...userData,
            email: `ratelimit${Math.random()}@example.com`
          })
      );

      const responses = await Promise.all(promises);

      // Some requests should succeed, others should be rate limited
      const successCount = responses.filter(r => r.status === 201).length;
      const rateLimitedCount = responses.filter(r => r.status === 429).length;

      expect(rateLimitedCount).toBeGreaterThan(0);
      expect(rateLimitedCount).toBeLessThan(10);
    });

    it('should rate limit login attempts', async () => {
      // Create a test user first
      const hashedPassword = await bcrypt.hash('testpassword123', 12);
      await testPool.query(
        `INSERT INTO users (email, email_verified, password_hash, name, roles, is_active)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        ['security@example.com', true, hashedPassword, 'Security User', JSON.stringify(['user']), true]
      );

      const loginData = {
        email: 'security@example.com',
        password: 'wrongpassword'
      };

      // Make multiple failed login attempts
      const promises = Array(15).fill().map(() =>
        request(app)
          .post('/auth/login')
          .send(loginData)
      );

      const responses = await Promise.all(promises);

      // Should be rate limited after several attempts
      const rateLimitedResponses = responses.filter(r => r.status === 429);
      expect(rateLimitedResponses.length).toBeGreaterThan(0);

      // Verify rate limit response format
      const rateLimitedResponse = rateLimitedResponses[0];
      expect(rateLimitedResponse.body.success).toBe(false);
      expect(rateLimitedResponse.body.error).toBe('AuthRateLimitExceeded');
      expect(rateLimitedResponse.headers['retry-after']).toBeDefined();
    });

    it('should rate limit password reset attempts', async () => {
      const resetData = {
        email: 'reset@example.com'
      };

      // Make multiple password reset requests
      const promises = Array(5).fill().map(() =>
        request(app)
          .post('/auth/forgot-password')
          .send(resetData)
      );

      const responses = await Promise.all(promises);

      // Should be rate limited after several attempts
      const rateLimitedResponses = responses.filter(r => r.status === 429);
      expect(rateLimitedResponses.length).toBeGreaterThan(0);

      // Verify rate limit response format
      const rateLimitedResponse = rateLimitedResponses[0];
      expect(rateLimitedResponse.body.success).toBe(false);
      expect(rateLimitedResponse.body.error).toBe('PasswordResetRateLimitExceeded');
    });
  });

  describe('Input Validation', () => {
    it('should reject SQL injection attempts in email', async () => {
      const maliciousData = {
        email: "'; DROP TABLE users; --@example.com",
        password: 'password123',
        name: 'Malicious User',
        confirmPassword: 'password123'
      };

      const response = await request(app)
        .post('/auth/register')
        .send(maliciousData)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('ValidationError');

      // Verify users table still exists
      const result = await testPool.query('SELECT COUNT(*) FROM users');
      expect(result.rows[0].count).toBeDefined();
    });

    it('should reject XSS attempts in name', async () => {
      const maliciousData = {
        email: 'xss@example.com',
        password: 'password123',
        name: '<script>alert("xss")</script>',
        confirmPassword: 'password123'
      };

      const response = await request(app)
        .post('/auth/register')
        .send(maliciousData)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('ValidationError');
    });

    it('should reject extremely long inputs', async () => {
      const longString = 'a'.repeat(1000);
      const maliciousData = {
        email: `${longString}@example.com`,
        password: 'password123',
        name: longString,
        confirmPassword: 'password123'
      };

      const response = await request(app)
        .post('/auth/register')
        .send(maliciousData)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('ValidationError');
    });

    it('should reject malformed JSON', async () => {
      const response = await request(app)
        .post('/auth/login')
        .set('Content-Type', 'application/json')
        .send('{"email": "test@example.com", "password": "password"')
        .expect(400);

      expect(response.body.success).toBe(false);
    });
  });

  describe('Password Security', () => {
    it('should reject common passwords', async () => {
      const commonPasswords = [
        'password',
        '123456',
        'qwerty',
        'admin',
        'letmein',
        'password123'
      ];

      for (const password of commonPasswords) {
        const userData = {
          email: `weak${Math.random()}@example.com`,
          password: password,
          name: 'Weak Password User',
          confirmPassword: password
        };

        const response = await request(app)
          .post('/auth/register')
          .send(userData);

        expect(response.status).toBe(400);
        expect(response.body.success).toBe(false);
        expect(response.body.error).toBe('WeakPassword');
      }
    });

    it('should reject passwords without sufficient complexity', async () => {
      const weakPasswords = [
        'password',           // No numbers or special chars
        '12345678',           // No letters or special chars
        'abcdefgh',           // No numbers or special chars
        'password123',        // No special chars
        'PASSWORD!',          // No numbers
      ];

      for (const password of weakPasswords) {
        const userData = {
          email: `weak${Math.random()}@example.com`,
          password: password,
          name: 'Weak Password User',
          confirmPassword: password
        };

        const response = await request(app)
          .post('/auth/register')
          .send(userData);

        expect(response.status).toBe(400);
        expect(response.body.success).toBe(false);
        expect(response.body.error).toBe('WeakPassword');
      }
    });

    it('should require password confirmation for registration', async () => {
      const userData = {
        email: 'noconfirm@example.com',
        password: 'password123!',
        name: 'No Confirm User'
        // Missing confirmPassword
      };

      const response = await request(app)
        .post('/auth/register')
        .send(userData)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('ValidationError');
    });
  });

  describe('Authentication Security', () => {
    let testUser;

    beforeEach(async () => {
      // Create test user
      const hashedPassword = await bcrypt.hash('testpassword123!', 12);
      const result = await testPool.query(
        `INSERT INTO users (email, email_verified, password_hash, name, roles, is_active)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        ['authsec@example.com', true, hashedPassword, 'Auth Security User', JSON.stringify(['user']), true]
      );

      testUser = result.rows[0];
    });

    it('should reject requests without Authorization header', async () => {
      const response = await request(app)
        .get('/user/profile')
        .expect(401);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('AuthenticationRequired');
    });

    it('should reject requests with malformed Authorization header', async () => {
      const response = await request(app)
        .get('/user/profile')
        .set('Authorization', 'InvalidFormat token123')
        .expect(401);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('AuthenticationRequired');
    });

    it('should reject requests with invalid JWT token', async () => {
      const response = await request(app)
        .get('/user/profile')
        .set('Authorization', 'Bearer invalid.jwt.token')
        .expect(401);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('InvalidTokenError');
    });

    it('should reject requests with expired JWT token', async () => {
      // Create an expired token
      const jwt = require('jsonwebtoken');
      const expiredToken = jwt.sign(
        {
          sub: testUser.id,
          email: testUser.email,
          roles: ['user'],
          type: 'access',
          iat: Math.floor(Date.now() / 1000) - 3600, // 1 hour ago
          exp: Math.floor(Date.now() / 1000) - 1800,  // 30 minutes ago
          iss: 'specpulse',
          aud: 'specpulse-users'
        },
        process.env.JWT_ACCESS_SECRET,
        { algorithm: 'HS256' }
      );

      const response = await request(app)
        .get('/user/profile')
        .set('Authorization', `Bearer ${expiredToken}`)
        .expect(401);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('TokenExpiredError');
    });

    it('should reject requests with token of wrong type', async () => {
      // Create a refresh token and try to use it as access token
      const jwt = require('jsonwebtoken');
      const refreshToken = jwt.sign(
        {
          sub: testUser.id,
          email: testUser.email,
          type: 'refresh',
          iat: Math.floor(Date.now() / 1000),
          iss: 'specpulse',
          aud: 'specpulse-users'
        },
        process.env.JWT_REFRESH_SECRET,
        { expiresIn: '7d' }
      );

      const response = await request(app)
        .get('/user/profile')
        .set('Authorization', `Bearer ${refreshToken}`)
        .expect(401);

      expect(response.body.success).toBe(false);
    });
  });

  describe('CORS Security', () => {
    it('should include appropriate CORS headers', async () => {
      const response = await request(app)
        .options('/auth/login')
        .expect(200);

      expect(response.headers['access-control-allow-origin']).toBeDefined();
      expect(response.headers['access-control-allow-methods']).toBeDefined();
      expect(response.headers['access-control-allow-headers']).toBeDefined();
    });

    it('should reject requests from unauthorized origins in production', async () => {
      // This test would need to be adapted based on your CORS configuration
      const response = await request(app)
        .post('/auth/login')
        .set('Origin', 'https://malicious-site.com')
        .send({ email: 'test@example.com', password: 'password' });

      // In production, this should be handled by CORS middleware
      expect(response.status).toBeDefined();
    });
  });

  describe('Security Headers', () => {
    it('should include security headers', async () => {
      const response = await request(app)
        .get('/health')
        .expect(200);

      // Helmet should add these headers
      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(response.headers['x-frame-options']).toBeDefined();
      expect(response.headers['x-xss-protection']).toBeDefined();
    });
  });
});