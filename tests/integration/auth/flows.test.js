# Integration Tests for Authentication Flows

const request = require('supertest');
const app = require('../../../src/app');

describe('Authentication Integration Tests', () => {
  describe('POST /auth/register', () => {
    it('should register a new user and return tokens', async () => {
      const userData = {
        email: 'integration@test.com',
        password: 'Password123!',
        name: 'Integration Test User'
      };

      const response = await request(app)
        .post('/auth/register')
        .send(userData)
        .expect(201);

      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('data');
      expect(response.body.data).toHaveProperty('user');
      expect(response.body.data).toHaveProperty('tokens');
      expect(response.body.data.user.email).toBe(userData.email);
      expect(response.body.data.user.name).toBe(userData.name);
    });

    it('should return error for duplicate email', async () => {
      const userData = {
        email: 'duplicate@test.com',
        password: 'Password123!',
        name: 'Duplicate User'
      };

      // First registration
      await request(app)
        .post('/auth/register')
        .send(userData)
        .expect(201);

      // Second registration with same email
      const response = await request(app)
        .post('/auth/register')
        .send(userData)
        .expect(400);

      expect(response.body).toHaveProperty('success', false);
      expect(response.body.error).toHaveProperty('code', 'EMAIL_EXISTS');
    });
  });

  describe('POST /auth/login', () => {
    let userToken;

    beforeAll(async () => {
      // Create a test user for login tests
      const userData = {
        email: 'login@test.com',
        password: 'Password123!',
        name: 'Login Test User'
      };

      const response = await request(app)
        .post('/auth/register')
        .send(userData);

      userToken = response.body.data.tokens.accessToken;
    });

    it('should login with valid credentials', async () => {
      const credentials = {
        email: 'login@test.com',
        password: 'Password123!'
      };

      const response = await request(app)
        .post('/auth/login')
        .send(credentials)
        .expect(200);

      expect(response.body).toHaveProperty('success', true);
      expect(response.body.data).toHaveProperty('user');
      expect(response.body.data).toHaveProperty('tokens');
    });

    it('should return error for invalid credentials', async () => {
      const credentials = {
        email: 'login@test.com',
        password: 'wrongpassword'
      };

      const response = await request(app)
        .post('/auth/login')
        .send(credentials)
        .expect(401);

      expect(response.body).toHaveProperty('success', false);
      expect(response.body.error).toHaveProperty('code', 'INVALID_CREDENTIALS');
    });
  });

  describe('GET /user/me', () => {
    let userToken;

    beforeAll(async () => {
      // Create and login a user
      const userData = {
        email: 'profile@test.com',
        password: 'Password123!',
        name: 'Profile Test User'
      };

      await request(app)
        .post('/auth/register')
        .send(userData);

      const loginResponse = await request(app)
        .post('/auth/login')
        .send({
          email: userData.email,
          password: userData.password
        });

      userToken = loginResponse.body.data.tokens.accessToken;
    });

    it('should return user profile with valid token', async () => {
      const response = await request(app)
        .get('/user/me')
        .set('Authorization', `Bearer ${userToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('success', true);
      expect(response.body.data).toHaveProperty('user');
      expect(response.body.data.user.email).toBe('profile@test.com');
    });

    it('should return error without token', async () => {
      const response = await request(app)
        .get('/user/me')
        .expect(401);

      expect(response.body).toHaveProperty('success', false);
      expect(response.body.error).toHaveProperty('code', 'TOKEN_REQUIRED');
    });

    it('should return error with invalid token', async () => {
      const response = await request(app)
        .get('/user/me')
        .set('Authorization', 'Bearer invalid.token.here')
        .expect(401);

      expect(response.body).toHaveProperty('success', false);
      expect(response.body.error).toHaveProperty('code', 'INVALID_TOKEN');
    });
  });

  describe('POST /auth/refresh', () => {
    let refreshToken;

    beforeAll(async () => {
      // Create and login a user
      const userData = {
        email: 'refresh@test.com',
        password: 'Password123!',
        name: 'Refresh Test User'
      };

      await request(app)
        .post('/auth/register')
        .send(userData);

      const loginResponse = await request(app)
        .post('/auth/login')
        .send({
          email: userData.email,
          password: userData.password
        });

      refreshToken = loginResponse.body.data.tokens.refreshToken;
    });

    it('should refresh tokens with valid refresh token', async () => {
      const response = await request(app)
        .post('/auth/refresh')
        .send({ refreshToken })
        .expect(200);

      expect(response.body).toHaveProperty('success', true);
      expect(response.body.data).toHaveProperty('tokens');
      expect(response.body.data.tokens).toHaveProperty('accessToken');
      expect(response.body.data.tokens).toHaveProperty('refreshToken');
    });

    it('should return error with invalid refresh token', async () => {
      const response = await request(app)
        .post('/auth/refresh')
        .send({ refreshToken: 'invalid.refresh.token' })
        .expect(401);

      expect(response.body).toHaveProperty('success', false);
      expect(response.body.error).toHaveProperty('code', 'INVALID_REFRESH_TOKEN');
    });
  });
});