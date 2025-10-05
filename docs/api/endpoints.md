# API Endpoints Documentation

## Overview

This document describes the RESTful API endpoints for the Simple Express Task Management API.

## Base URL

```
http://localhost:3000
```

## Authentication

Currently, no authentication is required for any endpoints. This may change in future versions.

## Response Format

All API responses follow a consistent format:

### Success Response
```json
{
  "success": true,
  "data": { /* response data */ },
  "message": "Operation completed successfully",
  "timestamp": "2025-10-05T08:49:47.000Z"
}
```

### Error Response
```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable error message",
    "details": { /* additional error details if applicable */ }
  },
  "timestamp": "2025-10-05T08:49:47.000Z"
}
```

## Endpoints

### Health Check

#### GET /health
Health check endpoint to verify the service is running.

**Response:**
```json
{
  "success": true,
  "data": {
    "status": "OK",
    "timestamp": "2025-10-05T08:49:47.000Z",
    "uptime": 123.45,
    "version": "1.0.0",
    "environment": "development",
    "memory": {
      "rss": 55226368,
      "heapTotal": 9805824,
      "heapUsed": 8601824,
      "external": 2230231
    },
    "responseTime": "0.03ms"
  },
  "message": "Service is healthy"
}
```

#### GET /health/ready
Readiness probe for container orchestration.

#### GET /health/live
Liveness probe for container orchestration.

### Task Management

#### GET /tasks
Retrieve all tasks with optional pagination, filtering, and search.

**Query Parameters:**
- `page` (integer, optional): Page number (default: 1)
- `limit` (integer, optional): Items per page (default: 10, max: 100)
- `status` (string, optional): Filter by status (pending|in-progress|completed)
- `search` (string, optional): Search term for title and description

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid-string",
      "title": "Task title",
      "description": "Task description",
      "status": "pending",
      "createdAt": "2025-10-05T08:49:47.000Z",
      "updatedAt": "2025-10-05T08:49:47.000Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 10,
    "total": 25,
    "totalPages": 3,
    "hasNext": true,
    "hasPrev": false
  },
  "message": "Tasks retrieved successfully"
}
```

#### GET /tasks/search
Search tasks with specific query term.

**Query Parameters:**
- `q` (string, required): Search term (min 2 chars, max 100 chars)
- `page` (integer, optional): Page number (default: 1)
- `limit` (integer, optional): Items per page (default: 10, max: 100)
- `status` (string, optional): Filter by status

#### GET /tasks/statistics
Get task statistics.

**Response:**
```json
{
  "success": true,
  "data": {
    "total": 10,
    "byStatus": {
      "pending": 3,
      "in-progress": 4,
      "completed": 3
    },
    "recentlyCreated": 2,
    "recentlyUpdated": 5
  }
}
```

#### GET /tasks/:id
Get a specific task by ID.

**Path Parameters:**
- `id` (string, required): Task UUID

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "uuid-string",
    "title": "Task title",
    "description": "Task description",
    "status": "pending",
    "createdAt": "2025-10-05T08:49:47.000Z",
    "updatedAt": "2025-10-05T08:49:47.000Z"
  },
  "message": "Task retrieved successfully"
}
```

#### POST /tasks
Create a new task.

**Request Body:**
```json
{
  "title": "Task title",
  "description": "Task description (optional)",
  "status": "pending"
}
```

**Required Fields:**
- `title` (string): Task title (max 100 characters)

**Optional Fields:**
- `description` (string): Task description (max 500 characters)
- `status` (string): Task status (pending|in-progress|completed, default: pending)

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "uuid-string",
    "title": "Task title",
    "description": "Task description",
    "status": "pending",
    "createdAt": "2025-10-05T08:49:47.000Z",
    "updatedAt": "2025-10-05T08:49:47.000Z"
  },
  "message": "Task created successfully"
}
```

#### PUT /tasks/:id
Update an existing task.

**Path Parameters:**
- `id` (string, required): Task UUID

**Request Body:**
```json
{
  "title": "Updated task title",
  "description": "Updated task description",
  "status": "completed"
}
```

**Optional Fields:**
- `title` (string): Updated task title
- `description` (string): Updated task description
- `status` (string): Updated task status

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "uuid-string",
    "title": "Updated task title",
    "description": "Updated task description",
    "status": "completed",
    "createdAt": "2025-10-05T08:49:47.000Z",
    "updatedAt": "2025-10-05T08:49:47.000Z"
  },
  "message": "Task updated successfully"
}
```

#### DELETE /tasks/:id
Delete a task.

**Path Parameters:**
- `id` (string, required): Task UUID

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "uuid-string",
    "title": "Deleted task title",
    "description": "Deleted task description",
    "status": "pending",
    "createdAt": "2025-10-05T08:49:47.000Z",
    "updatedAt": "2025-10-05T08:49:47.000Z"
  },
  "message": "Task deleted successfully"
}
```

## Error Codes

### Validation Errors (400)
- `VALIDATION_ERROR`: Invalid input data
- `INVALID_ID`: Invalid ID format
- `INVALID_JSON`: Invalid JSON in request body
- `INVALID_CONTENT_TYPE`: Content-Type must be application/json
- `PAYLOAD_TOO_LARGE`: Request entity too large

### Not Found Errors (404)
- `NOT_FOUND`: Resource not found
- `TASK_NOT_FOUND`: Task with specified ID not found

### Rate Limiting Errors (429)
- `RATE_LIMIT_EXCEEDED`: Too many requests from this IP
- `TASK_RATE_LIMIT_EXCEEDED`: Too many task operations

### Server Errors (500)
- `INTERNAL_SERVER_ERROR`: Internal server error
- `TASK_CREATION_FAILED`: Failed to create task
- `TASK_UPDATE_FAILED`: Failed to update task
- `TASK_DELETION_FAILED`: Failed to delete task

## Rate Limiting

- **General API**: 100 requests per 15 minutes per IP
- **Task Operations**: 10 requests per minute per IP

## Security Headers

The API includes the following security headers:
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `X-XSS-Protection: 1; mode=block`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy: geolocation=(), microphone=(), camera=()`

## Data Model

### Task Object
```json
{
  "id": "string (UUID)",
  "title": "string (required, max 100 chars)",
  "description": "string (optional, max 500 chars)",
  "status": "enum (pending|in-progress|completed)",
  "createdAt": "ISO timestamp",
  "updatedAt": "ISO timestamp"
}
```

## Usage Examples

### Create a new task
```bash
curl -X POST http://localhost:3000/tasks \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Complete project documentation",
    "description": "Write comprehensive API documentation",
    "status": "pending"
  }'
```

### Get all tasks with pagination
```bash
curl "http://localhost:3000/tasks?page=1&limit=5"
```

### Filter tasks by status
```bash
curl "http://localhost:3000/tasks?status=pending"
```

### Search tasks
```bash
curl "http://localhost:3000/tasks/search?q=documentation"
```

### Update a task
```bash
curl -X PUT http://localhost:3000/tasks/uuid-string \
  -H "Content-Type: application/json" \
  -d '{
    "status": "completed"
  }'
```

### Delete a task
```bash
curl -X DELETE http://localhost:3000/tasks/uuid-string
```

## Limitations

- Data is stored in memory and will be lost when the server restarts
- No authentication or authorization is implemented
- Single instance deployment only
- Maximum 100 items per page for pagination

## Future Enhancements

- Database persistence
- Authentication and authorization
- Real-time updates via WebSocket
- File attachments
- Task dependencies
- Bulk operations
- API versioning
- GraphQL support