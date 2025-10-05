# Unit Tests for Authentication Services

const authService = require('../../src/auth/services/authService');
const tokenService = require('../../src/auth/services/tokenService');
const User = require('../../src/auth/models/User');

// Mock User model
jest.mock('../../src/auth/models/User');

describe('Authentication Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('register', () => {
    it('should register a new user successfully', async () => {
      const userData = {
        email: 'test@example.com',
        password: 'password123',
        name: 'Test User'
      };

      const mockUser = { id: '1', email: userData.email, name: userData.name };
      User.create.mockResolvedValue(mockUser);

      const result = await authService.register(userData);

      expect(User.create).toHaveBeenCalledWith(userData);
      expect(result).toEqual(mockUser);
    });

    it('should throw error if user already exists', async () => {
      const userData = {
        email: 'test@example.com',
        password: 'password123',
        name: 'Test User'
      };

      User.findByEmail.mockResolvedValue({ id: '1', email: userData.email });

      await expect(authService.register(userData)).rejects.toThrow('User already exists');
    });
  });

  describe('login', () => {
    it('should login user with valid credentials', async () => {
      const credentials = {
        email: 'test@example.com',
        password: 'password123'
      };

      const mockUser = {
        id: '1',
        email: credentials.email,
        password: '$2b$12$hashedpassword',
        comparePassword: jest.fn().mockResolvedValue(true)
      };

      User.findByEmail.mockResolvedValue(mockUser);

      const result = await authService.login(credentials);

      expect(User.findByEmail).toHaveBeenCalledWith(credentials.email);
      expect(mockUser.comparePassword).toHaveBeenCalledWith(credentials.password);
      expect(result).toBeDefined();
    });

    it('should throw error for invalid credentials', async () => {
      const credentials = {
        email: 'test@example.com',
        password: 'wrongpassword'
      };

      User.findByEmail.mockResolvedValue(null);

      await expect(authService.login(credentials)).rejects.toThrow('Invalid credentials');
    });
  });
});

describe('Token Service', () => {
  describe('generateTokens', () => {
    it('should generate access and refresh tokens', () => {
      const user = { id: '1', email: 'test@example.com', roles: ['user'] };

      const tokens = tokenService.generateTokens(user);

      expect(tokens).toHaveProperty('accessToken');
      expect(tokens).toHaveProperty('refreshToken');
      expect(typeof tokens.accessToken).toBe('string');
      expect(typeof tokens.refreshToken).toBe('string');
    });
  });

  describe('verifyToken', () => {
    it('should verify valid token', () => {
      const user = { id: '1', email: 'test@example.com', roles: ['user'] };
      const { accessToken } = tokenService.generateTokens(user);

      const decoded = tokenService.verifyToken(accessToken);

      expect(decoded).toHaveProperty('sub', '1');
      expect(decoded).toHaveProperty('email', 'test@example.com');
      expect(decoded).toHaveProperty('roles', ['user']);
    });

    it('should throw error for invalid token', () => {
      const invalidToken = 'invalid.token.here';

      expect(() => tokenService.verifyToken(invalidToken)).toThrow();
    });
  });
});