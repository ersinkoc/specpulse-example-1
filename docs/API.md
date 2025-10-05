# User Authentication API Documentation

## Overview

This API provides comprehensive user authentication and management features including:
- User registration and login
- JWT-based authentication with refresh tokens
- OAuth2 integration (Google, GitHub)
- Password reset and email verification
- User profile management
- Role-based access control
- Security features (rate limiting, input validation, etc.)

## Base URL

```
http://localhost:3000
```

## Authentication

The API uses JWT (JSON Web Tokens) for authentication. Include the token in the Authorization header:

```
Authorization: Bearer <access_token>
```

## Rate Limiting

All endpoints are protected with rate limiting:
- General API: 100 requests per 15 minutes per IP
- Authentication endpoints: 10 requests per 15 minutes per email/IP
- Sensitive operations: 5 requests per 15 minutes per IP
- Password reset: 3 requests per hour per email

## Error Handling

All API responses follow a consistent format:

### Success Response
```json
{
  "success": true,
  "data": { ... },
  "message": "Operation completed successfully"
}
```

### Error Response
```json
{
  "success": false,
  "error": "ErrorCode",
  "message": "Human-readable error message",
  "details": "Additional error details (optional)"
}
```

## Endpoints

### Authentication Endpoints

#### Register User
```http
POST /auth/register
```

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "securePassword123!",
  "name": "John Doe",
  "confirmPassword": "securePassword123!"
}
```

**Response (201):**
```json
{
  "success": true,
  "message": "Registration successful. Please check your email for verification instructions.",
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "name": "John Doe",
    "emailVerified": false,
    "roles": ["user"],
    "createdAt": "2023-01-01T00:00:00.000Z"
  }
}
```

**Validation Requirements:**
- Email: Valid email format, unique
- Password: Minimum 8 characters, must contain 3 of: uppercase, lowercase, numbers, special characters
- Name: 1-100 characters, letters, spaces, hyphens, apostrophes only
- Passwords must match

#### Login User
```http
POST /auth/login
```

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "securePassword123!"
}
```

**Response (200):**
```json
{
  "success": true,
  "message": "Login successful",
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "name": "John Doe",
    "emailVerified": true,
    "roles": ["user"]
  },
  "tokens": {
    "accessToken": "jwt_access_token",
    "refreshToken": "jwt_refresh_token",
    "expiresIn": "1h",
    "tokenType": "Bearer"
  }
}
```

#### Logout User
```http
POST /auth/logout
```

**Headers:**
```
Authorization: Bearer <access_token>
```

**Response (200):**
```json
{
  "success": true,
  "message": "Logout successful"
}
```

#### Logout All Sessions
```http
POST /auth/logout-all
```

**Headers:**
```
Authorization: Bearer <access_token>
```

**Response (200):**
```json
{
  "success": true,
  "message": "All sessions logged out successfully",
  "revokedSessions": 3
}
```

#### Refresh Access Token
```http
POST /auth/refresh-token
```

**Request Body:**
```json
{
  "refreshToken": "jwt_refresh_token"
}
```

**Response (200):**
```json
{
  "success": true,
  "accessToken": "new_jwt_access_token",
  "refreshToken": "new_jwt_refresh_token",
  "expiresIn": "1h",
  "tokenType": "Bearer"
}
```

#### Get Current User
```http
GET /auth/me
```

**Headers:**
```
Authorization: Bearer <access_token>
```

**Response (200):**
```json
{
  "success": true,
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "name": "John Doe",
    "emailVerified": true,
    "roles": ["user"],
    "avatarUrl": "https://example.com/avatar.jpg",
    "createdAt": "2023-01-01T00:00:00.000Z",
    "lastLoginAt": "2023-01-01T12:00:00.000Z"
  }
}
```

### Password Management

#### Forgot Password
```http
POST /auth/forgot-password
```

**Request Body:**
```json
{
  "email": "user@example.com"
}
```

**Response (200):**
```json
{
  "success": true,
  "message": "If an account with this email exists, you will receive password reset instructions."
}
```

#### Reset Password
```http
POST /auth/reset-password
```

**Request Body:**
```json
{
  "token": "password_reset_token",
  "newPassword": "newSecurePassword123!",
  "confirmPassword": "newSecurePassword123!"
}
```

**Response (200):**
```json
{
  "success": true,
  "message": "Password reset successfully. You can now login with your new password."
}
```

#### Change Password
```http
POST /auth/change-password
```

**Headers:**
```
Authorization: Bearer <access_token>
```

**Request Body:**
```json
{
  "currentPassword": "oldPassword123!",
  "newPassword": "newSecurePassword456!",
  "confirmPassword": "newSecurePassword456!"
}
```

**Response (200):**
```json
{
  "success": true,
  "message": "Password changed successfully."
}
```

### Email Verification

#### Verify Email
```http
POST /auth/verify-email
```

**Request Body:**
```json
{
  "token": "email_verification_token"
}
```

**Response (200):**
```json
{
  "success": true,
  "message": "Email verified successfully. You can now login to your account.",
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "emailVerified": true
  }
}
```

#### Resend Verification
```http
POST /auth/resend-verification
```

**Request Body:**
```json
{
  "email": "user@example.com"
}
```

**Response (200):**
```json
{
  "success": true,
  "message": "Verification email sent successfully."
}
```

### User Profile Management

#### Get User Profile
```http
GET /user/profile
```

**Headers:**
```
Authorization: Bearer <access_token>
```

**Response (200):**
```json
{
  "success": true,
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "name": "John Doe",
    "emailVerified": true,
    "roles": ["user"],
    "avatarUrl": "https://example.com/avatar.jpg",
    "bio": "Software developer",
    "providers": [
      {
        "providerName": "google",
        "providerId": "google_user_id",
        "createdAt": "2023-01-01T00:00:00.000Z"
      }
    ],
    "activeSessions": [
      {
        "id": "session_uuid",
        "deviceInfo": {
          "type": "desktop",
          "os": "windows",
          "browser": "chrome"
        },
        "ipAddress": "192.168.1.1",
        "userAgent": "Mozilla/5.0...",
        "createdAt": "2023-01-01T00:00:00.000Z",
        "lastUsedAt": "2023-01-01T12:00:00.000Z",
        "expiresAt": "2023-01-08T00:00:00.000Z"
      }
    ]
  }
}
```

#### Update User Profile
```http
PUT /user/profile
```

**Headers:**
```
Authorization: Bearer <access_token>
```

**Request Body:**
```json
{
  "name": "John Smith",
  "avatar_url": "https://example.com/new-avatar.jpg",
  "bio": "Senior Software Developer"
}
```

**Response (200):**
```json
{
  "success": true,
  "message": "Profile updated successfully",
  "user": {
    "id": "uuid",
    "name": "John Smith",
    "avatarUrl": "https://example.com/new-avatar.jpg",
    "bio": "Senior Software Developer"
  }
}
```

#### Upload Avatar
```http
POST /user/profile/avatar
```

**Headers:**
```
Authorization: Bearer <access_token>
Content-Type: multipart/form-data
```

**Request Body:**
```
avatar: <image_file>
```

**Response (200):**
```json
{
  "success": true,
  "message": "Avatar uploaded successfully",
  "avatarUrl": "/uploads/avatars/avatar-uuid-1234567890.jpg",
  "user": {
    "id": "uuid",
    "avatarUrl": "/uploads/avatars/avatar-uuid-1234567890.jpg"
  }
}
```

### User Preferences

#### Get User Preferences
```http
GET /user/preferences
```

**Headers:**
```
Authorization: Bearer <access_token>
```

**Response (200):**
```json
{
  "success": true,
  "preferences": {
    "theme": "light",
    "language": "en",
    "notifications": {
      "email": true,
      "push": false,
      "security": true
    },
    "privacy": {
      "showEmail": false,
      "showProfile": true
    }
  }
}
```

#### Update User Preferences
```http
PUT /user/preferences
```

**Headers:**
```
Authorization: Bearer <access_token>
```

**Request Body:**
```json
{
  "preferences": {
    "theme": "dark",
    "language": "es",
    "notifications": {
      "email": false,
      "push": true,
      "security": true
    }
  }
}
```

**Response (200):**
```json
{
  "success": true,
  "message": "Preferences updated successfully",
  "preferences": {
    "theme": "dark",
    "language": "es",
    "notifications": {
      "email": false,
      "push": true,
      "security": true
    },
    "privacy": {
      "showEmail": false,
      "showProfile": true
    }
  }
}
```

### Session Management

#### Revoke Specific Session
```http
DELETE /user/sessions/:sessionId
```

**Headers:**
```
Authorization: Bearer <access_token>
```

**Response (200):**
```json
{
  "success": true,
  "message": "Session revoked successfully"
}
```

#### Revoke All Sessions
```http
DELETE /user/sessions
```

**Headers:**
```
Authorization: Bearer <access_token>
```

**Response (200):**
```json
{
  "success": true,
  "message": "All sessions revoked successfully",
  "revokedSessions": 3
}
```

### Account Management

#### Delete Account
```http
DELETE /user/account
```

**Headers:**
```
Authorization: Bearer <access_token>
```

**Request Body:**
```json
{
  "password": "currentPassword123!",
  "confirmation": "DELETE"
}
```

**Response (200):**
```json
{
  "success": true,
  "message": "Account deleted successfully"
}
```

### OAuth2 Authentication

#### Google OAuth Initiation
```http
GET /oauth/google?returnUrl=/dashboard
```

**Response:** Redirect to Google OAuth authorization page

#### Google OAuth Callback
```http
GET /oauth/google/callback?code=auth_code&state=random_state
```

**Response:** Redirect to frontend with tokens

#### GitHub OAuth Initiation
```http
GET /oauth/github?returnUrl=/dashboard
```

**Response:** Redirect to GitHub OAuth authorization page

#### GitHub OAuth Callback
```http
GET /oauth/github/callback?code=auth_code&state=random_state
```

**Response:** Redirect to frontend with tokens

#### Get Linked OAuth Providers
```http
GET /oauth/providers
```

**Headers:**
```
Authorization: Bearer <access_token>
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "providers": [
      {
        "providerName": "google",
        "providerId": "google_user_id",
        "createdAt": "2023-01-01T00:00:00.000Z"
      }
    ]
  }
}
```

#### Unlink OAuth Provider
```http
DELETE /oauth/providers/:providerName
```

**Headers:**
```
Authorization: Bearer <access_token>
```

**Response (200):**
```json
{
  "success": true,
  "message": "Google account unlinked successfully"
}
```

## Error Codes

| Error Code | Description | HTTP Status |
|------------|-------------|-------------|
| `AuthenticationRequired` | Authentication is required | 401 |
| `InvalidTokenError` | Invalid or expired token | 401 |
| `TokenExpiredError` | Token has expired | 401 |
| `EmailExistsError` | Email already exists | 400 |
| `UserNotFound` | User not found | 404 |
| `InvalidCredentials` | Invalid email or password | 401 |
| `WeakPassword` | Password doesn't meet security requirements | 400 |
| `ValidationError` | Input validation failed | 400 |
| `RateLimitExceeded` | Too many requests | 429 |
| `AuthorizationError` | Insufficient permissions | 403 |
| `InsufficientPermissions` | User lacks required permissions | 403 |
| `AccountDeactivated` | User account is deactivated | 401 |
| `EmailNotVerified` | Email address not verified | 401 |

## Security Features

### Rate Limiting
- IP-based rate limiting with Redis backend
- Different limits for different endpoint types
- Automatic IP blocking for suspicious activity

### Input Validation
- All inputs validated using Zod schemas
- Protection against SQL injection and XSS
- File upload restrictions and validation

### Password Security
- Minimum 8 characters
- Complexity requirements (3 of 4 character types)
- Common password detection
- Bcrypt hashing with 12 rounds

### Token Security
- JWT access tokens (1 hour expiry)
- Refresh tokens with rotation (7 days expiry)
- Token blacklisting on logout
- Secure token storage in database

### CSRF Protection
- CSRF tokens for state-changing requests
- SameSite cookie attributes
- Secure cookie settings

### Security Headers
- Helmet.js for security headers
- CORS configuration
- Content Security Policy
- X-Frame-Options, X-Content-Type-Options

## Development

### Running Tests
```bash
npm test
npm run test:watch
npm run test:coverage
```

### Environment Setup
Create a `.env` file with the following variables:

```env
# Database
DB_HOST=localhost
DB_PORT=5432
DB_NAME=auth_db
DB_USER=postgres
DB_PASSWORD=password

# JWT Secrets
JWT_ACCESS_SECRET=your_access_secret_here
JWT_REFRESH_SECRET=your_refresh_secret_here

# OAuth2
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
GOOGLE_CALLBACK_URL=http://localhost:3000/oauth/google/callback

GITHUB_CLIENT_ID=your_github_client_id
GITHUB_CLIENT_SECRET=your_github_client_secret
GITHUB_CALLBACK_URL=http://localhost:3000/oauth/github/callback

# Email
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your_email@gmail.com
SMTP_PASS=your_app_password
EMAIL_FROM=noreply@yourapp.com

# Security
SESSION_SECRET=your_session_secret_here
BCRYPT_ROUNDS=12

# Redis (for rate limiting)
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=your_redis_password

# File Uploads
MAX_FILE_SIZE=5242880
UPLOAD_PATH=uploads/avatars

# Frontend
FRONTEND_URL=http://localhost:3000
```

## Support

For API support and questions, please contact the development team or refer to the project documentation.