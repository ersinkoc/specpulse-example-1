# Authentication System Integration Guide

## Overview

This guide helps developers integrate the authentication system into their applications. It covers setup, configuration, common integration patterns, and troubleshooting.

## Prerequisites

- Node.js 16+
- PostgreSQL database
- OAuth2 provider credentials (Google, GitHub) - optional
- SMTP server for email verification - optional

## Quick Start

### 1. Install Dependencies

```bash
npm install bcrypt cors express express-rate-limit express-session
npm install helmet joi jsonwebtoken passport passport-google-oauth20 passport-github2
npm install pg socket.io uuid
```

### 2. Environment Configuration

Create a `.env` file based on `.env.example`:

```env
# Server Configuration
NODE_ENV=development
PORT=3000
HOST=localhost

# Database Configuration
DB_HOST=localhost
DB_PORT=5432
DB_NAME=specpulse_auth
DB_USER=postgres
DB_PASSWORD=your_password_here

# JWT Configuration
JWT_ACCESS_SECRET=your_super_long_jwt_access_secret_key_here_minimum_256_bits
JWT_REFRESH_SECRET=your_super_long_jwt_refresh_secret_key_here_minimum_256_bits
JWT_ACCESS_EXPIRES_IN=1h
JWT_REFRESH_EXPIRES_IN=7d

# OAuth2 Provider Configuration
GOOGLE_CLIENT_ID=your_google_client_id_here
GOOGLE_CLIENT_SECRET=your_google_client_secret_here
GOOGLE_CALLBACK_URL=http://localhost:3000/oauth/google/callback

GITHUB_CLIENT_ID=your_github_client_id_here
GITHUB_CLIENT_SECRET=your_github_client_secret_here
GITHUB_CALLBACK_URL=http://localhost:3000/oauth/github/callback

# Email Configuration (Optional)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your_email@gmail.com
SMTP_PASS=your_app_password
FROM_EMAIL=noreply@yourapp.com
```

### 3. Database Setup

Create PostgreSQL database and run migrations:

```sql
-- Create database
CREATE DATABASE specpulse_auth;

-- Run migrations (automatically handled by the application)
```

### 4. Start the Server

```bash
npm start
```

The authentication server will start on `http://localhost:3000`

## OAuth2 Provider Setup

### Google OAuth2

1. **Create Google Cloud Project**
   - Go to [Google Cloud Console](https://console.cloud.google.com/)
   - Create a new project or select existing one

2. **Enable APIs**
   - Enable Google+ API
   - Enable Google People API (optional, for extended profile data)

3. **Create OAuth2 Credentials**
   - Go to APIs & Services → Credentials
   - Click "Create Credentials" → "OAuth 2.0 Client IDs"
   - Select "Web application"
   - Add authorized redirect URI: `http://localhost:3000/oauth/google/callback`
   - Copy Client ID and Client Secret

4. **Configure Environment**
   ```env
   GOOGLE_CLIENT_ID=your_google_client_id
   GOOGLE_CLIENT_SECRET=your_google_client_secret
   GOOGLE_CALLBACK_URL=http://localhost:3000/oauth/google/callback
   ```

### GitHub OAuth2

1. **Create GitHub OAuth App**
   - Go to GitHub Settings → Developer settings → OAuth Apps
   - Click "New OAuth App"
   - Fill in application details
   - Authorization callback URL: `http://localhost:3000/oauth/github/callback`

2. **Configure Environment**
   ```env
   GITHUB_CLIENT_ID=your_github_client_id
   GITHUB_CLIENT_SECRET=your_github_client_secret
   GITHUB_CALLBACK_URL=http://localhost:3000/oauth/github/callback
   ```

## Integration Patterns

### 1. Client-Side Integration

#### JavaScript/Fetch API

```javascript
class AuthClient {
  constructor(baseUrl) {
    this.baseUrl = baseUrl;
    this.accessToken = null;
    this.refreshToken = null;
  }

  async register(userData) {
    const response = await fetch(`${this.baseUrl}/auth/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(userData)
    });

    const data = await response.json();
    if (data.success) {
      this.setTokens(data.data.tokens);
    }
    return data;
  }

  async login(credentials) {
    const response = await fetch(`${this.baseUrl}/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(credentials)
    });

    const data = await response.json();
    if (data.success) {
      this.setTokens(data.data.tokens);
    }
    return data;
  }

  async getProfile() {
    const response = await fetch(`${this.baseUrl}/user/me`, {
      headers: {
        'Authorization': `Bearer ${this.accessToken}`
      }
    });

    return await response.json();
  }

  setTokens(tokens) {
    this.accessToken = tokens.accessToken;
    this.refreshToken = tokens.refreshToken;

    // Store tokens securely (httpOnly cookies recommended)
    localStorage.setItem('accessToken', this.accessToken);
    localStorage.setItem('refreshToken', this.refreshToken);
  }

  async refreshTokens() {
    const response = await fetch(`${this.baseUrl}/auth/refresh`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        refreshToken: this.refreshToken
      })
    });

    const data = await response.json();
    if (data.success) {
      this.setTokens(data.data.tokens);
    }
    return data;
  }

  async logout() {
    const response = await fetch(`${this.baseUrl}/auth/logout`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.accessToken}`
      }
    });

    this.clearTokens();
    return await response.json();
  }

  clearTokens() {
    this.accessToken = null;
    this.refreshToken = null;
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
  }
}

// Usage example
const authClient = new AuthClient('http://localhost:3000');

// Register user
authClient.register({
  email: 'user@example.com',
  password: 'Password123!',
  name: 'John Doe'
}).then(data => {
  if (data.success) {
    console.log('Registration successful');
  }
});
```

#### React Hook Example

```javascript
import { useState, useEffect, createContext, useContext } from 'react';

const AuthContext = createContext();

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const initAuth = async () => {
      const token = localStorage.getItem('accessToken');
      if (token) {
        try {
          const response = await fetch('/user/me', {
            headers: {
              'Authorization': `Bearer ${token}`
            }
          });
          const data = await response.json();
          if (data.success) {
            setUser(data.data.user);
          } else {
            localStorage.removeItem('accessToken');
            localStorage.removeItem('refreshToken');
          }
        } catch (error) {
          console.error('Auth initialization failed:', error);
        }
      }
      setLoading(false);
    };

    initAuth();
  }, []);

  const login = async (credentials) => {
    const response = await fetch('/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(credentials)
    });

    const data = await response.json();
    if (data.success) {
      setUser(data.data.user);
      localStorage.setItem('accessToken', data.data.tokens.accessToken);
      localStorage.setItem('refreshToken', data.data.tokens.refreshToken);
    }
    return data;
  };

  const logout = async () => {
    try {
      await fetch('/auth/logout', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('accessToken')}`
        }
      });
    } catch (error) {
      console.error('Logout error:', error);
    } finally {
      setUser(null);
      localStorage.removeItem('accessToken');
      localStorage.removeItem('refreshToken');
    }
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
};
```

### 2. Server-Side Integration

#### Express.js Middleware

```javascript
const authMiddleware = (req, res, next) => {
  const token = req.headers.authorization?.replace('Bearer ', '');

  if (!token) {
    return res.status(401).json({
      success: false,
      error: {
        code: 'TOKEN_REQUIRED',
        message: 'Authentication token is required'
      }
    });
  }

  try {
    const jwt = require('jsonwebtoken');
    const decoded = jwt.verify(token, process.env.JWT_ACCESS_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      error: {
        code: 'INVALID_TOKEN',
        message: 'Invalid or expired token'
      }
    });
  }
};

// Apply to protected routes
app.use('/api/protected', authMiddleware, protectedRoutes);
```

#### Custom API Integration

```javascript
const axios = require('axios');

class AuthService {
  constructor(authServiceUrl) {
    this.authServiceUrl = authServiceUrl;
    this.httpClient = axios.create({
      baseURL: authServiceUrl
    });

    // Add request interceptor for authentication
    this.httpClient.interceptors.request.use((config) => {
      const token = this.getAccessToken();
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
      return config;
    });

    // Add response interceptor for token refresh
    this.httpClient.interceptors.response.use(
      (response) => response,
      async (error) => {
        if (error.response?.status === 401 && error.config?.url !== '/auth/refresh') {
          try {
            await this.refreshTokens();
            return this.httpClient.request(error.config);
          } catch (refreshError) {
            // Refresh failed, redirect to login
            this.clearTokens();
            throw refreshError;
          }
        }
        throw error;
      }
    );
  }

  async register(userData) {
    const response = await this.httpClient.post('/auth/register', userData);
    return response.data;
  }

  async login(credentials) {
    const response = await this.httpClient.post('/auth/login', credentials);
    if (response.data.success) {
      this.setTokens(response.data.data.tokens);
    }
    return response.data;
  }

  async getUser() {
    const response = await this.httpClient.get('/user/me');
    return response.data;
  }

  async refreshTokens() {
    const refreshToken = this.getRefreshToken();
    if (!refreshToken) {
      throw new Error('No refresh token available');
    }

    const response = await this.httpClient.post('/auth/refresh', {
      refreshToken
    });

    if (response.data.success) {
      this.setTokens(response.data.data.tokens);
    }

    return response.data;
  }

  setTokens(tokens) {
    // Store tokens securely
    process.env.ACCESS_TOKEN = tokens.accessToken;
    process.env.REFRESH_TOKEN = tokens.refreshToken;
  }

  getAccessToken() {
    return process.env.ACCESS_TOKEN;
  }

  getRefreshToken() {
    return process.env.REFRESH_TOKEN;
  }

  clearTokens() {
    delete process.env.ACCESS_TOKEN;
    delete process.env.REFRESH_TOKEN;
  }
}

// Usage
const authService = new AuthService('http://localhost:3000');

// In your Express routes
app.get('/api/user/profile', async (req, res) => {
  try {
    const userResponse = await authService.getUser();
    res.json(userResponse);
  } catch (error) {
    res.status(401).json({
      success: false,
      error: {
        code: 'AUTHENTICATION_FAILED',
        message: 'User not authenticated'
      }
    });
  }
});
```

## OAuth2 Integration

### Frontend OAuth2 Flow

```javascript
class OAuth2Client {
  constructor(authBaseUrl) {
    this.authBaseUrl = authBaseUrl;
  }

  initiateOAuth2(provider, redirectUri) {
    const params = new URLSearchParams({
      redirect_uri: redirectUri || window.location.origin + '/auth/callback'
    });

    const authUrl = `${this.authBaseUrl}/oauth/${provider}?${params.toString()}`;
    window.location.href = authUrl;
  }

  async handleCallback(provider, code, state) {
    const response = await fetch(`${this.authBaseUrl}/oauth/${provider}/callback?code=${code}&state=${state}`);
    const data = await response.json();

    if (data.success) {
      this.setTokens(data.data.tokens);
      return data.data.user;
    } else {
      throw new Error(data.error.message);
    }
  }

  setTokens(tokens) {
    localStorage.setItem('accessToken', tokens.accessToken);
    localStorage.setItem('refreshToken', tokens.refreshToken);
  }
}

// Usage in React component
const oauth2Client = new OAuth2Client('http://localhost:3000');

const GoogleLoginButton = () => (
  <button onClick={() => oauth2Client.initiateOAuth2('google')}>
    Login with Google
  </button>
);

const GitHubLoginButton = () => (
  <button onClick={() => oauth2Client.initiateOAuth2('github')}>
    Login with GitHub
  </button>
);

// Callback handling component
const AuthCallback = () => {
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get('code');
    const state = urlParams.get('state');
    const provider = window.location.pathname.split('/').pop();

    if (code) {
      oauth2Client.handleCallback(provider, code, state)
        .then(user => {
          // Redirect to dashboard or home
          window.location.href = '/dashboard';
        })
        .catch(error => {
          console.error('OAuth2 callback error:', error);
          window.location.href = '/login?error=auth_failed';
        });
    }
  }, []);

  return <div>Completing authentication...</div>;
};
```

## WebSocket Integration

### Authentication Middleware for WebSocket

```javascript
const jwt = require('jsonwebtoken');

const socketAuthMiddleware = (socket, next) => {
  const token = socket.handshake.auth.token;

  if (!token) {
    return next(new Error('Authentication token required'));
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_ACCESS_SECRET);
    socket.user = decoded;
    next();
  } catch (error) {
    next(new Error('Invalid authentication token'));
  }
};

// Socket.IO server setup
const io = require('socket.io')(server, {
  cors: {
    origin: process.env.CORS_ORIGIN,
    credentials: true
  }
});

io.use(socketAuthMiddleware);

io.on('connection', (socket) => {
  console.log(`User ${socket.user.sub} connected`);

  socket.on('join-user-room', () => {
    socket.join(`user-${socket.user.sub}`);
  });

  socket.on('disconnect', () => {
    console.log(`User ${socket.user.sub} disconnected`);
  });
});
```

## Security Best Practices

### 1. Token Storage

**Recommended:** Use httpOnly cookies
```javascript
// In Express server
app.use('/auth/login', (req, res) => {
  // After successful authentication
  res.cookie('accessToken', tokens.accessToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 60 * 60 * 1000 // 1 hour
  });

  res.cookie('refreshToken', tokens.refreshToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
  });

  res.json({ success: true, data: { user } });
});
```

**Alternative:** LocalStorage (less secure)
```javascript
// Only use localStorage if httpOnly cookies are not feasible
localStorage.setItem('accessToken', token);
```

### 2. CORS Configuration

```javascript
const cors = require('cors');

app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:3001',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));
```

### 3. Rate Limiting

```javascript
const rateLimit = require('express-rate-limit');

// General API rate limiting
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: {
    success: false,
    error: {
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many requests, please try again later.'
    }
  }
});

// Authentication endpoints stricter limiting
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // limit each IP to 5 auth requests per windowMs
  skipSuccessfulRequests: true
});

app.use('/api/', apiLimiter);
app.use('/auth/', authLimiter);
```

### 4. Input Validation

```javascript
const Joi = require('joi');

const registrationSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().min(8).pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/).required(),
  name: Joi.string().min(2).max(50).required()
});

app.post('/auth/register', (req, res, next) => {
  const { error } = registrationSchema.validate(req.body);
  if (error) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: error.details[0].message
      }
    });
  }
  next();
});
```

## Testing Integration

### Unit Tests

```javascript
// tests/authClient.test.js
const AuthClient = require('../src/authClient');

describe('AuthClient', () => {
  let authClient;
  let fetchMock;

  beforeEach(() => {
    global.fetch = jest.fn();
    fetchMock = global.fetch;
    authClient = new AuthClient('http://localhost:3000');
  });

  afterEach(() => {
    localStorage.clear();
    jest.clearAllMocks();
  });

  describe('login', () => {
    it('should login successfully and store tokens', async () => {
      const mockResponse = {
        success: true,
        data: {
          user: { id: '1', email: 'test@example.com' },
          tokens: {
            accessToken: 'access_token',
            refreshToken: 'refresh_token'
          }
        }
      };

      fetchMock.mockResolvedValueOnce({
        json: () => Promise.resolve(mockResponse)
      });

      const result = await authClient.login({
        email: 'test@example.com',
        password: 'password123'
      });

      expect(result).toEqual(mockResponse);
      expect(localStorage.getItem('accessToken')).toBe('access_token');
      expect(localStorage.getItem('refreshToken')).toBe('refresh_token');
    });
  });
});
```

### Integration Tests

```javascript
// tests/integration/auth.test.js
const request = require('supertest');
const app = require('../src/app');

describe('Authentication Integration', () => {
  describe('POST /auth/register', () => {
    it('should register user and return tokens', async () => {
      const userData = {
        email: 'integration@test.com',
        password: 'Password123!',
        name: 'Integration Test'
      };

      const response = await request(app)
        .post('/auth/register')
        .send(userData)
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data.user.email).toBe(userData.email);
      expect(response.body.data.tokens.accessToken).toBeDefined();
    });
  });
});
```

## Troubleshooting

### Common Issues

1. **CORS Errors**
   ```javascript
   // Ensure CORS is properly configured
   app.use(cors({
     origin: 'http://your-frontend-domain.com',
     credentials: true
   }));
   ```

2. **Token Not Found Errors**
   ```javascript
   // Check token storage and retrieval
   const token = localStorage.getItem('accessToken');
   if (!token) {
     // Redirect to login
   }
   ```

3. **Database Connection Issues**
   ```bash
   # Check PostgreSQL is running
   pg_isready -h localhost -p 5432

   # Check database exists
   psql -h localhost -U postgres -l
   ```

4. **OAuth2 Callback Issues**
   - Verify callback URLs match exactly in provider settings
   - Check environment variables are correctly set
   - Ensure server is accessible from the internet (OAuth providers need to reach callback URL)

### Debug Mode

Enable debug logging:
```env
DEBUG=auth:*
NODE_ENV=development
```

### Health Check

Check if authentication service is running:
```bash
curl http://localhost:3000/health
```

### Test Credentials

For development, you can create test users:
```javascript
// In your development setup
const testUser = {
  email: 'test@example.com',
  password: 'TestPassword123!',
  name: 'Test User'
};
```

## Production Deployment

### Environment Variables

Ensure all production environment variables are set:

```env
NODE_ENV=production
JWT_ACCESS_SECRET=your_production_secret_256_bits_minimum
JWT_REFRESH_SECRET=your_production_refresh_secret_256_bits_minimum
DB_SSL=true
CORS_ORIGIN=https://your-production-domain.com
```

### Security Headers

The application includes security headers via Helmet middleware:
- X-Content-Type-Options: nosniff
- X-Frame-Options: DENY
- X-XSS-Protection: 1; mode=block
- Strict-Transport-Security (in production)

### Monitoring

Monitor authentication endpoints for:
- High failure rates (possible attacks)
- Token refresh patterns
- OAuth2 provider response times
- Database connection health

## Support

For integration issues:

1. Check the [API Documentation](./api/authentication.md)
2. Review error codes and messages
3. Enable debug logging for detailed information
4. Test with provided test suites
5. Check network connectivity and firewall settings

For additional support, create an issue with:
- Environment details
- Error messages and logs
- Steps to reproduce the issue
- Expected vs actual behavior