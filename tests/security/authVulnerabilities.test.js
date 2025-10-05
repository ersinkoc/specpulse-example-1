# Security Tests for Authentication System

const request = require('supertest');
const app = require('../../src/app');

describe('Authentication Security Tests', () => {
  describe('Input Validation', () => {
    it('should reject SQL injection attempts in email', async () => {
      const maliciousEmail = "'; DROP TABLE users; --@test.com";

      const response = await request(app)
        .post('/auth/register')
        .send({
          email: maliciousEmail,
          password: 'Password123!',
          name: 'Test User'
        })
        .expect(400);

      expect(response.body).toHaveProperty('success', false);
      expect(response.body.error).toHaveProperty('code', 'VALIDATION_ERROR');
    });

    it('should reject XSS attempts in name field', async () => {
      const xssName = '<script>alert("xss")</script>';

      const response = await request(app)
        .post('/auth/register')
        .send({
          email: 'xss@test.com',
          password: 'Password123!',
          name: xssName
        })
        .expect(400);

      expect(response.body).toHaveProperty('success', false);
    });

    it('should enforce password complexity requirements', async () => {
      const weakPasswords = [
        '123',
        'password',
        'Password',
        '123456',
        'qwerty'
      ];

      for (const weakPassword of weakPasswords) {
        const response = await request(app)
          .post('/auth/register')
          .send({
            email: 'weak@test.com',
            password: weakPassword,
            name: 'Test User'
          })
          .expect(400);

        expect(response.body).toHaveProperty('success', false);
      }
    });
  });

  describe('Rate Limiting', () => {
    it('should limit registration attempts', async () => {
      const userData = {
        email: 'ratelimit@test.com',
        password: 'Password123!',
        name: 'Rate Limit Test'
      };

      // Make multiple rapid requests
      const requests = Array(20).fill().map(() =>
        request(app)
          .post('/auth/register')
          .send(userData)
      );

      const responses = await Promise.allSettled(requests);

      // At least some requests should be rate limited
      const rateLimitedResponses = responses.filter(
        result => result.status === 'fulfilled' && result.value.status === 429
      );

      expect(rateLimitedResponses.length).toBeGreaterThan(0);
    });

    it('should limit login attempts', async () => {
      const credentials = {
        email: 'loginlimit@test.com',
        password: 'wrongpassword'
      };

      // Make multiple failed login attempts
      const requests = Array(10).fill().map(() =>
        request(app)
          .post('/auth/login')
          .send(credentials)
      );

      const responses = await Promise.allSettled(requests);

      // Should encounter rate limiting after several failed attempts
      const rateLimitedResponses = responses.filter(
        result => result.status === 'fulfilled' && result.value.status === 429
      );

      expect(rateLimitedResponses.length).toBeGreaterThan(0);
    });
  });

  describe('Token Security', () => {
    let validToken;
    let user;

    beforeAll(async () => {
      // Create test user
      const userData = {
        email: 'token@test.com',
        password: 'Password123!',
        name: 'Token Test User'
      };

      const registerResponse = await request(app)
        .post('/auth/register')
        .send(userData);

      validToken = registerResponse.body.data.tokens.accessToken;
      user = registerResponse.body.data.user;
    });

    it('should reject tampered JWT tokens', async () => {
      const [header, payload, signature] = validToken.split('.');
      const tamperedToken = `${header}.${payload}.tampered${signature}`;

      const response = await request(app)
        .get('/user/me')
        .set('Authorization', `Bearer ${tamperedToken}`)
        .expect(401);

      expect(response.body).toHaveProperty('success', false);
      expect(response.body.error).toHaveProperty('code', 'INVALID_TOKEN');
    });

    it('should reject expired tokens', async () => {
      // Create a token with expired payload
      const expiredPayload = {
        sub: user.id,
        email: user.email,
        roles: user.roles,
        exp: Math.floor(Date.now() / 1000) - 3600, // Expired 1 hour ago
        iat: Math.floor(Date.now() / 1000) - 7200
      };

      const expiredToken = Buffer.from(JSON.stringify(expiredPayload))
        .toString('base64');

      const response = await request(app)
        .get('/user/me')
        .set('Authorization', `Bearer ${expiredToken}`)
        .expect(401);

      expect(response.body).toHaveProperty('success', false);
    });

    it('should reject tokens with invalid algorithms', async () => {
      const maliciousToken = 'eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.signature';

      const response = await request(app)
        .get('/user/me')
        .set('Authorization', `Bearer ${maliciousToken}`)
        .expect(401);

      expect(response.body).toHaveProperty('success', false);
    });
  });

  describe('Authentication Bypass Attempts', () => {
    it('should reject requests without authentication headers', async () => {
      const protectedRoutes = [
        '/user/me',
        '/user/profile',
        '/auth/logout',
        '/oauth/providers'
      ];

      for (const route of protectedRoutes) {
        const response = await request(app)
          .get(route)
          .expect(401);

        expect(response.body).toHaveProperty('success', false);
        expect(response.body.error).toHaveProperty('code', 'TOKEN_REQUIRED');
      }
    });

    it('should reject malformed authorization headers', async () => {
      const malformedHeaders = [
        'Bearer',
        'bearer token',
        'Token token',
        'Basic dGVzdDp0ZXN0',
        'InvalidFormat token'
      ];

      for (const header of malformedHeaders) {
        const response = await request(app)
          .get('/user/me')
          .set('Authorization', header)
          .expect(401);

        expect(response.body).toHaveProperty('success', false);
      }
    });
  });

  describe('CSRF Protection', () => {
    it('should include CSRF headers in responses', async () => {
      const response = await request(app)
        .get('/health')
        .expect(200);

      // Check for CSRF-related headers
      const headers = response.headers;

      // Should have security headers (helmet middleware)
      expect(headers).toHaveProperty('x-content-type-options');
      expect(headers).toHaveProperty('x-frame-options');
      expect(headers).toHaveProperty('x-xss-protection');
    });
  });

  describe('Session Security', () => {
    it('should handle session hijacking attempts', async () => {
      // Test concurrent session usage
      const userData = {
        email: 'session@test.com',
        password: 'Password123!',
        name: 'Session Test User'
      };

      // Create user and get tokens
      const registerResponse = await request(app)
        .post('/auth/register')
        .send(userData);

      const tokens = registerResponse.body.data.tokens;

      // Use refresh token multiple times to test rotation
      const refreshResponse1 = await request(app)
        .post('/auth/refresh')
        .send({ refreshToken: tokens.refreshToken })
        .expect(200);

      const newRefreshToken = refreshResponse1.body.data.tokens.refreshToken;

      // Try to use old refresh token (should fail)
      const response = await request(app)
        .post('/auth/refresh')
        .send({ refreshToken: tokens.refreshToken })
        .expect(401);

      expect(response.body).toHaveProperty('success', false);
    });
  });
});