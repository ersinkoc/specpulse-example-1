# Authentication API Documentation

## Overview

This document provides comprehensive API documentation for the authentication system, including local authentication, OAuth2 integration, user management, and security features.

## Base URL

```
http://localhost:3000
```

## Authentication

All protected endpoints require authentication via JWT tokens. Include the token in the Authorization header:

```
Authorization: Bearer <access_token>
```

## Response Format

All API responses follow this consistent format:

### Success Response
```json
{
  "success": true,
  "data": {
    // Response data
  },
  "message": "Success message",
  "timestamp": "2025-10-05T14:52:00.000Z"
}
```

### Error Response
```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable error message"
  },
  "timestamp": "2025-10-05T14:52:00.000Z"
}
```

## Rate Limiting

All endpoints are rate-limited to prevent abuse:

- **General API**: 100 requests per 15 minutes per IP
- **Authentication endpoints**: 5 requests per 15 minutes per IP
- **Registration**: 3 requests per hour per IP
- **Password reset**: 3 requests per hour per email

## Endpoints

### Authentication Routes (`/auth`)

#### POST /auth/register
Register a new user account.

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "Password123!",
  "name": "John Doe"
}
```

**Response (201):**
```json
{
  "success": true,
  "data": {
    "user": {
      "id": "uuid",
      "email": "user@example.com",
      "name": "John Doe",
      "emailVerified": false,
      "roles": ["user"],
      "createdAt": "2025-10-05T14:52:00.000Z"
    },
    "tokens": {
      "accessToken": "jwt_access_token",
      "refreshToken": "jwt_refresh_token"
    }
  }
}
```

**Error Codes:**
- `VALIDATION_ERROR` - Invalid input data
- `EMAIL_EXISTS` - Email already registered
- `RATE_LIMIT_EXCEEDED` - Too many registration attempts

---

#### POST /auth/login
Authenticate with email and password.

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "Password123!"
}
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "user": {
      "id": "uuid",
      "email": "user@example.com",
      "name": "John Doe",
      "roles": ["user"]
    },
    "tokens": {
      "accessToken": "jwt_access_token",
      "refreshToken": "jwt_refresh_token"
    }
  }
}
```

**Error Codes:**
- `VALIDATION_ERROR` - Invalid input data
- `INVALID_CREDENTIALS` - Email or password incorrect
- `ACCOUNT_LOCKED` - Account temporarily locked due to failed attempts
- `RATE_LIMIT_EXCEEDED` - Too many login attempts

---

#### POST /auth/refresh
Refresh access token using refresh token.

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
  "data": {
    "tokens": {
      "accessToken": "new_jwt_access_token",
      "refreshToken": "new_jwt_refresh_token"
    }
  }
}
```

**Error Codes:**
- `VALIDATION_ERROR` - Missing or invalid refresh token
- `INVALID_REFRESH_TOKEN` - Refresh token invalid or expired
- `TOKEN_REVOKED` - Refresh token has been revoked

---

#### POST /auth/logout
Logout and invalidate current session.

**Headers:**
```
Authorization: Bearer <access_token>
```

**Response (200):**
```json
{
  "success": true,
  "message": "Logged out successfully"
}
```

**Error Codes:**
- `TOKEN_REQUIRED` - Authentication token required
- `INVALID_TOKEN` - Token invalid or expired

---

#### POST /auth/forgot-password
Initiate password reset process.

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
  "message": "Password reset instructions sent to email"
}
```

**Error Codes:**
- `VALIDATION_ERROR` - Invalid email format
- `USER_NOT_FOUND` - No account with this email
- `RATE_LIMIT_EXCEEDED` - Too many reset requests

---

#### POST /auth/reset-password
Reset password using reset token.

**Request Body:**
```json
{
  "token": "reset_token",
  "newPassword": "NewPassword123!"
}
```

**Response (200):**
```json
{
  "success": true,
  "message": "Password reset successfully"
}
```

**Error Codes:**
- `VALIDATION_ERROR` - Invalid input data
- `INVALID_TOKEN` - Reset token invalid or expired
- `WEAK_PASSWORD` - Password does not meet security requirements

---

#### POST /auth/verify-email
Verify email address using verification token.

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
  "message": "Email verified successfully"
}
```

**Error Codes:**
- `INVALID_TOKEN` - Verification token invalid or expired
- `ALREADY_VERIFIED` - Email already verified

---

### OAuth2 Routes (`/oauth`)

#### GET /oauth/providers
Get list of available OAuth2 providers.

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
        "name": "google",
        "displayName": "Google",
        "enabled": true,
        "authUrl": "/oauth/google"
      },
      {
        "name": "github",
        "displayName": "GitHub",
        "enabled": true,
        "authUrl": "/oauth/github"
      }
    ]
  }
}
```

---

#### GET /oauth/:provider
Initiate OAuth2 authentication with specified provider.

**URL Parameters:**
- `provider` - OAuth2 provider name (google, github)

**Query Parameters:**
- `redirect_uri` - URL to redirect after authentication (optional)

**Response (302):**
Redirects to OAuth2 provider's authorization page.

**Error Codes:**
- `INVALID_PROVIDER` - Provider not supported or disabled
- `OAUTH_ERROR` - OAuth2 initialization failed

---

#### GET /oauth/:provider/callback
Handle OAuth2 callback from provider.

**URL Parameters:**
- `provider` - OAuth2 provider name

**Query Parameters:**
- `code` - Authorization code from provider
- `state` - CSRF protection state parameter
- `error` - Error returned by provider (if any)

**Response (200):**
```json
{
  "success": true,
  "data": {
    "user": {
      "id": "uuid",
      "email": "user@example.com",
      "name": "John Doe",
      "roles": ["user"]
    },
    "tokens": {
      "accessToken": "jwt_access_token",
      "refreshToken": "jwt_refresh_token"
    },
    "provider": {
      "name": "google",
      "providerId": "google_user_id"
    }
  }
}
```

**Error Codes:**
- `OAUTH_ERROR` - OAuth2 flow failed
- `ACCOUNT_CONFLICT` - OAuth2 account conflicts with existing account
- `INVALID_STATE` - CSRF state parameter invalid

---

#### POST /oauth/link
Link OAuth2 provider to existing account.

**Headers:**
```
Authorization: Bearer <access_token>
```

**Request Body:**
```json
{
  "provider": "google",
  "providerToken": "oauth2_provider_token"
}
```

**Response (200):**
```json
{
  "success": true,
  "message": "Provider linked successfully"
}
```

**Error Codes:**
- `PROVIDER_ALREADY_LINKED` - Provider already linked to account
- `ACCOUNT_CONFLICT` - Provider linked to different account
- `INVALID_TOKEN` - OAuth2 provider token invalid

---

#### DELETE /oauth/unlink
Unlink OAuth2 provider from account.

**Headers:**
```
Authorization: Bearer <access_token>
```

**Request Body:**
```json
{
  "provider": "google"
}
```

**Response (200):**
```json
{
  "success": true,
  "message": "Provider unlinked successfully"
}
```

**Error Codes:**
- `PROVIDER_NOT_LINKED` - Provider not linked to account
- `LAST_PROVIDER` - Cannot unlink last authentication method
- `INVALID_PROVIDER` - Provider not supported

---

### User Routes (`/user`)

#### GET /user/me
Get current user profile.

**Headers:**
```
Authorization: Bearer <access_token>
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "user": {
      "id": "uuid",
      "email": "user@example.com",
      "name": "John Doe",
      "avatar": "https://example.com/avatar.jpg",
      "emailVerified": true,
      "roles": ["user"],
      "providers": [
        {
          "provider": "google",
          "providerId": "google_user_id",
          "createdAt": "2025-10-05T14:52:00.000Z"
        }
      ],
      "createdAt": "2025-10-05T14:52:00.000Z",
      "updatedAt": "2025-10-05T14:52:00.000Z"
    }
  }
}
```

---

#### PUT /user/profile
Update user profile.

**Headers:**
```
Authorization: Bearer <access_token>
```

**Request Body:**
```json
{
  "name": "John Updated",
  "avatar": "https://example.com/new-avatar.jpg"
}
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "user": {
      "id": "uuid",
      "email": "user@example.com",
      "name": "John Updated",
      "avatar": "https://example.com/new-avatar.jpg",
      "updatedAt": "2025-10-05T14:55:00.000Z"
    }
  }
}
```

**Error Codes:**
- `VALIDATION_ERROR` - Invalid profile data
- `AVATAR_TOO_LARGE` - Avatar file exceeds size limit
- `INVALID_FORMAT` - Avatar format not supported

---

#### POST /user/change-password
Change user password.

**Headers:**
```
Authorization: Bearer <access_token>
```

**Request Body:**
```json
{
  "currentPassword": "CurrentPassword123!",
  "newPassword": "NewPassword123!"
}
```

**Response (200):**
```json
{
  "success": true,
  "message": "Password changed successfully"
}
```

**Error Codes:**
- `VALIDATION_ERROR` - Invalid password format
- `INVALID_CURRENT_PASSWORD` - Current password incorrect
- `WEAK_PASSWORD` - New password does not meet requirements

---

#### DELETE /user/account
Delete user account.

**Headers:**
```
Authorization: Bearer <access_token>
```

**Request Body:**
```json
{
  "password": "Password123!",
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

**Error Codes:**
- `VALIDATION_ERROR` - Invalid confirmation
- `INVALID_PASSWORD` - Password incorrect
- `ACCOUNT_HAS_DEPENDENCIES` - Account cannot be deleted (has active subscriptions, etc.)

---

## Token Management

### Access Token
- **Type**: JWT
- **Expiration**: 1 hour
- **Usage**: API authentication
- **Format**: `Bearer <access_token>`

### Refresh Token
- **Type**: JWT
- **Expiration**: 7 days
- **Usage**: Token refresh
- **Rotation**: New refresh token issued on each refresh

### Token Payload
```json
{
  "sub": "user_uuid",
  "email": "user@example.com",
  "roles": ["user"],
  "iat": 1644096000,
  "exp": 1644099600,
  "iss": "your-app-domain",
  "aud": "your-app-audience"
}
```

## Error Codes Reference

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `VALIDATION_ERROR` | 400 | Request validation failed |
| `EMAIL_EXISTS` | 400 | Email already registered |
| `INVALID_CREDENTIALS` | 401 | Authentication failed |
| `TOKEN_REQUIRED` | 401 | Authentication token required |
| `INVALID_TOKEN` | 401 | Token invalid or expired |
| `ACCOUNT_LOCKED` | 423 | Account temporarily locked |
| `RATE_LIMIT_EXCEEDED` | 429 | Rate limit exceeded |
| `USER_NOT_FOUND` | 404 | User not found |
| `OAUTH_ERROR` | 400 | OAuth2 flow failed |
| `PROVIDER_NOT_SUPPORTED` | 400 | OAuth2 provider not supported |

## Security Considerations

1. **HTTPS Required**: All authentication endpoints must use HTTPS in production
2. **Token Storage**: Store tokens securely (httpOnly cookies recommended)
3. **Password Security**: Enforce strong password requirements
4. **Rate Limiting**: Implement rate limiting on all authentication endpoints
5. **CSRF Protection**: Use CSRF tokens for state-changing operations
6. **Input Validation**: Validate and sanitize all input data
7. **Audit Logging**: Log all authentication attempts and security events

## Integration Examples

### JavaScript (Fetch API)
```javascript
// Register new user
const registerResponse = await fetch('/auth/register', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    email: 'user@example.com',
    password: 'Password123!',
    name: 'John Doe'
  })
});

const registerData = await registerResponse.json();
const { accessToken, refreshToken } = registerData.data.tokens;

// Use access token for authenticated requests
const profileResponse = await fetch('/user/me', {
  headers: {
    'Authorization': `Bearer ${accessToken}`
  }
});
```

### cURL Examples
```bash
# Register user
curl -X POST http://localhost:3000/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "Password123!",
    "name": "John Doe"
  }'

# Login user
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "Password123!"
  }'

# Get user profile
curl -X GET http://localhost:3000/user/me \
  -H "Authorization: Bearer <access_token>"
```

## Testing

Use the provided test suites to validate authentication functionality:

- **Unit Tests**: `npm test -- tests/unit/auth/`
- **Integration Tests**: `npm test -- tests/integration/auth/`
- **Security Tests**: `npm test -- tests/security/authVulnerabilities.test.js`

## Support

For issues with the authentication API, please check:

1. Error codes and messages in API responses
2. Server logs for detailed error information
3. Network connectivity and CORS configuration
4. JWT token expiration and validity