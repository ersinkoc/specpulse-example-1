# User Authentication API

A comprehensive, secure, and scalable user authentication system built with Node.js, Express, and PostgreSQL. This API provides OAuth2 integration, JWT-based authentication, role-based access control, and extensive security features.

## 🚀 Features

### Authentication & Authorization
- **JWT-based authentication** with access and refresh tokens
- **OAuth2 integration** (Google, GitHub)
- **Role-based access control (RBAC)** with hierarchical permissions
- **Email verification** and password reset functionality
- **Session management** with device tracking
- **Multi-provider authentication** linking

### Security Features
- **Rate limiting** with Redis backend
- **Input validation** using Zod schemas
- **Password strength requirements**
- **CSRF protection**
- **Security headers** with Helmet.js
- **IP blocking** for suspicious activity
- **SQL injection and XSS protection**

### User Management
- **Profile management** with avatar uploads
- **User preferences** system
- **Account deletion** with confirmation
- **Session revocation** (individual or all)
- **OAuth provider management**

### Development Features
- **Comprehensive testing suite** with Jest
- **API documentation** with detailed examples
- **Docker support** for containerization
- **Environment-based configuration**
- **Structured logging**
- **Health checks** and monitoring

## 📋 Prerequisites

- Node.js 16.0.0 or higher
- PostgreSQL 12.0 or higher
- Redis 6.0 or higher (for rate limiting)
- npm or yarn package manager

## 🛠️ Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/your-username/user-authentication-api.git
   cd user-authentication-api
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up environment variables**
   ```bash
   cp .env.example .env
   # Edit .env with your configuration
   ```

4. **Set up the database**
   ```bash
   # Create database
   createdb auth_db

   # Run migrations
   npm run migrate
   ```

5. **Start the application**
   ```bash
   # Development
   npm run dev

   # Production
   npm start
   ```

## ⚙️ Configuration

Create a `.env` file with the following variables:

```env
# Database
DB_HOST=localhost
DB_PORT=5432
DB_NAME=auth_db
DB_USER=postgres
DB_PASSWORD=your_password

# JWT Secrets
JWT_ACCESS_SECRET=your_access_secret_here
JWT_REFRESH_SECRET=your_refresh_secret_here

# OAuth2
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
GITHUB_CLIENT_ID=your_github_client_id
GITHUB_CLIENT_SECRET=your_github_client_secret

# Email
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your_email@gmail.com
SMTP_PASS=your_app_password

# Security
SESSION_SECRET=your_session_secret_here
BCRYPT_ROUNDS=12

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379
```

## 📚 API Documentation

### Base URL
```
http://localhost:3000
```

### Authentication Endpoints

#### Register User
```http
POST /auth/register
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "securePassword123!",
  "name": "John Doe",
  "confirmPassword": "securePassword123!"
}
```

#### Login User
```http
POST /auth/login
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "securePassword123!"
}
```

#### Get Current User
```http
GET /auth/me
Authorization: Bearer <access_token>
```

### User Profile Endpoints

#### Get Profile
```http
GET /user/profile
Authorization: Bearer <access_token>
```

#### Update Profile
```http
PUT /user/profile
Authorization: Bearer <access_token>
Content-Type: application/json

{
  "name": "Updated Name",
  "bio": "Software developer"
}
```

### OAuth2 Endpoints

#### Google OAuth
```http
GET /oauth/google
```

#### GitHub OAuth
```http
GET /oauth/github
```

For complete API documentation, see [docs/API.md](docs/API.md).

## 🧪 Testing

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Generate coverage report
npm run test:coverage

# Run specific test file
npm test -- tests/auth/auth.test.js
```

The test suite includes:
- Unit tests for authentication endpoints
- Integration tests for user management
- Security tests for rate limiting and validation
- OAuth flow testing

## 🐳 Docker Deployment

### Using Docker Compose

1. **Build and start services**
   ```bash
   docker-compose up -d
   ```

2. **Run database migrations**
   ```bash
   docker-compose exec app npm run migrate
   ```

3. **View logs**
   ```bash
   docker-compose logs -f app
   ```

### Using Dockerfile

```bash
# Build image
docker build -t auth-api .

# Run container
docker run -p 3000:3000 --env-file .env auth-api
```

## 📊 Monitoring

### Health Check

```http
GET /health
```

Response:
```json
{
  "status": "healthy",
  "timestamp": "2023-01-01T00:00:00.000Z",
  "uptime": 3600,
  "database": "connected",
  "redis": "connected"
}
```

### Logging

The application uses structured logging with different levels:
- `error`: Error conditions
- `warn`: Warning conditions
- `info`: Informational messages
- `debug`: Debug information

Logs are written to:
- Console (development)
- Files (production)
- External services (configurable)

## 🔒 Security

### Authentication
- JWT access tokens (1 hour expiry)
- Refresh tokens with rotation (7 days expiry)
- Secure token storage in database
- Token blacklisting on logout

### Rate Limiting
- General API: 100 requests per 15 minutes
- Authentication: 10 requests per 15 minutes
- Password reset: 3 requests per hour
- Sensitive operations: 5 requests per 15 minutes

### Input Validation
- All inputs validated using Zod schemas
- Protection against SQL injection and XSS
- File upload restrictions
- Email format validation

### Password Security
- Minimum 8 characters
- Complexity requirements
- Common password detection
- Bcrypt hashing with 12 rounds

## 🚀 Deployment

### Production Deployment

For detailed deployment instructions, see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

### Quick Start with PM2

```bash
# Install PM2
npm install -g pm2

# Start application
pm2 start ecosystem.config.js --env production

# Save PM2 configuration
pm2 save

# Setup startup script
pm2 startup
```

### Environment Variables

Production requires additional security considerations:

```env
NODE_ENV=production
PORT=3000
CORS_ORIGIN=https://yourdomain.com
FRONTEND_URL=https://yourdomain.com
```

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
   ```bash
   git checkout -b feature/amazing-feature
   ```
3. Commit your changes
   ```bash
   git commit -m 'Add amazing feature'
   ```
4. Push to the branch
   ```bash
   git push origin feature/amazing-feature
   ```
5. Open a Pull Request

### Development Guidelines

- Follow the existing code style
- Add tests for new features
- Update documentation
- Ensure all tests pass
- Follow semantic versioning

## 📝 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🆘 Support

For support and questions:

- Create an issue on GitHub
- Check the [documentation](docs/)
- Review the [API documentation](docs/API.md)

## 🗺️ Roadmap

- [ ] Add more OAuth providers (Facebook, Twitter)
- [ ] Implement two-factor authentication
- [ ] Add user role management API
- [ ] Implement audit logging
- [ ] Add API rate limiting per user
- [ ] Create admin dashboard
- [ ] Add WebSocket support for real-time notifications
- [ ] Implement passwordless authentication

## 📈 Performance

- Response time: < 100ms (average)
- Throughput: 1000+ requests/second
- Database optimization: Indexed queries
- Caching: Redis for rate limiting
- Compression: Gzip enabled

## 🔧 Tools and Technologies

- **Runtime**: Node.js 18+
- **Framework**: Express.js
- **Database**: PostgreSQL 12+
- **Cache**: Redis 6+
- **Authentication**: JWT, Passport.js
- **Validation**: Zod
- **Testing**: Jest, Supertest
- **Security**: Helmet.js, bcrypt
- **Documentation**: Markdown
- **Containerization**: Docker
- **Process Management**: PM2

---

**Built with ❤️ for secure and scalable user authentication**