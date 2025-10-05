# Profile Management API Documentation

## Overview

The Profile Management API provides comprehensive functionality for creating, managing, and viewing user profiles with avatar support, social media links, privacy controls, and search capabilities.

## Base URL

```
http://localhost:3000/api/profiles
```

## Authentication

All endpoints require JWT authentication. Include the token in the Authorization header:

```
Authorization: Bearer <jwt_token>
```

## Rate Limiting

Different endpoints have different rate limits:
- Profile creation: 5 requests per 15 minutes
- Profile updates: 20 requests per 15 minutes
- Profile viewing: 200 requests per 15 minutes
- Profile search: 50 requests per 15 minutes
- Avatar operations: 10 requests per 15 minutes
- Social link operations: 10 requests per 15 minutes

## Endpoints

### Create Profile

**POST** `/`

Create a new profile for the authenticated user.

#### Request Body

```json
{
  "displayName": "John Doe",
  "bio": "Software developer passionate about clean code",
  "avatarUrl": "https://example.com/avatar.jpg",
  "isPublic": true,
  "privacySettings": {
    "emailVisible": false,
    "bioVisible": true,
    "avatarVisible": true,
    "socialLinksVisible": true,
    "profileSearchable": true
  },
  "socialLinks": [
    {
      "platform": "github",
      "url": "https://github.com/johndoe"
    },
    {
      "platform": "linkedin",
      "url": "https://linkedin.com/in/johndoe"
    }
  ]
}
```

#### Response

```json
{
  "success": true,
  "data": {
    "profile": {
      "id": "uuid",
      "userId": "uuid",
      "displayName": "John Doe",
      "bio": "Software developer passionate about clean code",
      "avatarUrl": "https://example.com/avatar.jpg",
      "profileCompletion": 75,
      "isPublic": true,
      "createdAt": "2025-10-05T12:00:00.000Z"
    },
    "privacySettings": {
      "emailVisible": false,
      "bioVisible": true,
      "avatarVisible": true,
      "socialLinksVisible": true,
      "profileSearchable": true
    },
    "socialLinks": [
      {
        "id": "uuid",
        "platform": "github",
        "url": "https://github.com/johndoe",
        "isVerified": false
      }
    ]
  }
}
```

### Get My Profile

**GET** `/me`

Get the authenticated user's own profile with all details.

#### Response

```json
{
  "success": true,
  "data": {
    "profile": {
      "id": "uuid",
      "userId": "uuid",
      "displayName": "John Doe",
      "bio": "Software developer passionate about clean code",
      "avatarUrl": "https://example.com/avatar.jpg",
      "profileCompletion": 75,
      "isPublic": true,
      "createdAt": "2025-10-05T12:00:00.000Z"
    },
    "privacySettings": {
      "emailVisible": false,
      "bioVisible": true,
      "avatarVisible": true,
      "socialLinksVisible": true,
      "profileSearchable": true
    },
    "socialLinks": [
      {
        "id": "uuid",
        "platform": "github",
        "url": "https://github.com/johndoe",
        "isVerified": false
      }
    ]
  }
}
```

### Get Profile by ID

**GET** `/:profileId`

Get a profile by ID. Privacy settings are respected for non-owners.

#### Response

```json
{
  "success": true,
  "data": {
    "profile": {
      "id": "uuid",
      "displayName": "John Doe",
      "bio": "Software developer passionate about clean code",
      "avatarUrl": "https://example.com/avatar.jpg",
      "profileCompletion": 75,
      "isPublic": true,
      "createdAt": "2025-10-05T12:00:00.000Z"
    },
    "privacySettings": null,
    "socialLinks": [
      {
        "id": "uuid",
        "platform": "github",
        "url": "https://github.com/johndoe",
        "isVerified": false
      }
    ]
  }
}
```

### Update Profile

**PUT** `/:profileId`

Update profile details. Only the profile owner can update.

#### Request Body

```json
{
  "displayName": "John Smith",
  "bio": "Senior Software Developer",
  "avatarUrl": "https://example.com/new-avatar.jpg",
  "isPublic": false,
  "privacySettings": {
    "emailVisible": false,
    "bioVisible": true,
    "avatarVisible": true,
    "socialLinksVisible": false,
    "profileSearchable": false
  },
  "socialLinks": [
    {
      "platform": "github",
      "url": "https://github.com/johnsmith"
    }
  ]
}
```

#### Response

Same format as Get Profile by ID.

### Delete Profile

**DELETE** `/:profileId`

Soft delete a profile. Only the profile owner can delete.

#### Response

```json
{
  "success": true,
  "data": {
    "success": true,
    "message": "Profile deleted successfully"
  }
}
```

### Search Profiles

**GET** `/search?q=searchTerm&limit=20&offset=0`

Search for public profiles by display name or bio.

#### Query Parameters

- `q` (required): Search term
- `limit` (optional): Number of results (default: 20, max: 100)
- `offset` (optional): Offset for pagination (default: 0)

#### Response

```json
{
  "success": true,
  "data": {
    "profiles": [
      {
        "profile": {
          "id": "uuid",
          "displayName": "John Doe",
          "bio": "Software developer passionate about clean code",
          "avatarUrl": "https://example.com/avatar.jpg",
          "profileCompletion": 75,
          "isPublic": true
        },
        "privacySettings": null,
        "socialLinks": []
      }
    ],
    "pagination": {
      "limit": 20,
      "offset": 0,
      "count": 1
    }
  }
}
```

### Get Profile Statistics

**GET** `/:profileId/statistics`

Get profile statistics. Only the profile owner can view.

#### Response

```json
{
  "success": true,
  "data": {
    "completion": 75,
    "isPublic": true,
    "socialLinksCount": 2,
    "verifiedSocialLinksCount": 1,
    "createdAt": "2025-10-05T12:00:00.000Z",
    "updatedAt": "2025-10-05T13:00:00.000Z"
  }
}
```

### Add Social Link

**POST** `/:profileId/social-links`

Add a new social media link to a profile.

#### Request Body

```json
{
  "platform": "twitter",
  "url": "https://twitter.com/johndoe"
}
```

#### Response

```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "profileId": "uuid",
    "platform": "twitter",
    "url": "https://twitter.com/johndoe",
    "isVerified": false,
    "createdAt": "2025-10-05T12:00:00.000Z"
  }
}
```

### Remove Social Link

**DELETE** `/:profileId/social-links/:linkId`

Remove a social media link from a profile.

#### Response

```json
{
  "success": true,
  "data": {
    "success": true
  }
}
```

### Update Avatar

**PUT** `/:profileId/avatar`

Update profile avatar URL.

#### Request Body

```json
{
  "url": "https://example.com/new-avatar.jpg"
}
```

#### Response

```json
{
  "success": true,
  "data": {
    "profile": {
      "id": "uuid",
      "userId": "uuid",
      "displayName": "John Doe",
      "bio": "Software developer passionate about clean code",
      "avatarUrl": "https://example.com/new-avatar.jpg",
      "profileCompletion": 100,
      "isPublic": true,
      "createdAt": "2025-10-05T12:00:00.000Z"
    },
    "privacySettings": {
      "emailVisible": false,
      "bioVisible": true,
      "avatarVisible": true,
      "socialLinksVisible": true,
      "profileSearchable": true
    },
    "socialLinks": []
  }
}
```

### Health Check

**GET** `/health/service`

Check if the profile service is healthy.

#### Response

```json
{
  "success": true,
  "data": {
    "status": "healthy",
    "timestamp": "2025-10-05T12:00:00.000Z",
    "service": "profile-service",
    "version": "1.0.0"
  }
}
```

## Error Responses

All endpoints return consistent error responses:

```json
{
  "success": false,
  "error": "ErrorCode",
  "message": "Human readable error message",
  "details": "Additional error details (optional)"
}
```

### Common Error Codes

- `ValidationError`: Invalid input data
- `ProfileNotFound`: Profile does not exist
- `Unauthorized`: User is not authenticated or authorized
- `PrivateProfile`: Profile is private and cannot be viewed
- `ProfileExists`: User already has a profile
- `InvalidQuery`: Invalid search query
- `InvalidPagination`: Invalid pagination parameters
- `RateLimitExceeded`: Too many requests
- `ServiceUnavailable`: Service is temporarily unavailable

## Supported Social Platforms

- `linkedin`
- `twitter`
- `github`
- `instagram`
- `facebook`
- `youtube`
- `tiktok`
- `pinterest`
- `reddit`
- `website`
- `blog`
- `portfolio`

## Privacy Settings

- `emailVisible`: Show email address in profile
- `bioVisible`: Show bio in profile
- `avatarVisible`: Show avatar in profile
- `socialLinksVisible`: Show social media links in profile
- `profileSearchable`: Include profile in search results

## Profile Completion

Profile completion is calculated as follows:
- Display name: 25%
- Bio: 25%
- Avatar: 25%
- Social links: Up to 15% (3% per link, max 5 links)
- Privacy settings configured: 10%

## File Upload

For avatar uploads, use the `/api/upload/avatar` endpoint with `multipart/form-data`:

```
POST /api/upload/avatar
Content-Type: multipart/form-data
Authorization: Bearer <jwt_token>

avatar: <file>
```

**File Requirements:**
- Maximum size: 4MB
- Supported formats: JPEG, PNG, WebP
- File will be automatically resized and optimized

**Response:**

```json
{
  "success": true,
  "data": {
    "fileId": "uuid",
    "originalFilename": "avatar.jpg",
    "fileSize": 1024000,
    "mimeType": "image/jpeg",
    "originalSize": "1920x1080",
    "urls": {
      "small": "/uploads/avatars/small_uuid.jpg",
      "medium": "/uploads/avatars/medium_uuid.jpg",
      "large": "/uploads/avatars/large_uuid.jpg",
      "original": "/uploads/avatars/original_uuid.jpg"
    },
    "createdAt": "2025-10-05T12:00:00.000Z"
  }
}
```