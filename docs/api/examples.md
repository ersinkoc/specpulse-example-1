# API Usage Examples

This document provides practical examples of how to use the Simple Express Task Management API.

## Setup

Make sure the API server is running:
```bash
npm start
```

The API will be available at `http://localhost:3000`

## Basic Operations

### 1. Check API Health
```bash
curl http://localhost:3000/health
```

**Response:**
```json
{
  "success": true,
  "data": {
    "status": "OK",
    "timestamp": "2025-10-05T08:49:47.000Z",
    "uptime": 123.45,
    "version": "1.0.0",
    "environment": "development"
  },
  "message": "Service is healthy"
}
```

### 2. Create a New Task
```bash
curl -X POST http://localhost:3000/tasks \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Learn Express.js",
    "description": "Complete the Express.js tutorial",
    "status": "pending"
  }'
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "123e4567-e89b-12d3-a456-426614174000",
    "title": "Learn Express.js",
    "description": "Complete the Express.js tutorial",
    "status": "pending",
    "createdAt": "2025-10-05T08:49:47.000Z",
    "updatedAt": "2025-10-05T08:49:47.000Z"
  },
  "message": "Task created successfully"
}
```

### 3. Get All Tasks
```bash
curl http://localhost:3000/tasks
```

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "123e4567-e89b-12d3-a456-426614174000",
      "title": "Learn Express.js",
      "description": "Complete the Express.js tutorial",
      "status": "pending",
      "createdAt": "2025-10-05T08:49:47.000Z",
      "updatedAt": "2025-10-05T08:49:47.000Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 10,
    "total": 1,
    "totalPages": 1,
    "hasNext": false,
    "hasPrev": false
  },
  "message": "Tasks retrieved successfully"
}
```

### 4. Get a Specific Task
```bash
curl http://localhost:3000/tasks/123e4567-e89b-12d3-a456-426614174000
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "123e4567-e89b-12d3-a456-426614174000",
    "title": "Learn Express.js",
    "description": "Complete the Express.js tutorial",
    "status": "pending",
    "createdAt": "2025-10-05T08:49:47.000Z",
    "updatedAt": "2025-10-05T08:49:47.000Z"
  },
  "message": "Task retrieved successfully"
}
```

### 5. Update a Task
```bash
curl -X PUT http://localhost:3000/tasks/123e4567-e89b-12d3-a456-426614174000 \
  -H "Content-Type: application/json" \
  -d '{
    "status": "in-progress"
  }'
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "123e4567-e89b-12d3-a456-426614174000",
    "title": "Learn Express.js",
    "description": "Complete the Express.js tutorial",
    "status": "in-progress",
    "createdAt": "2025-10-05T08:49:47.000Z",
    "updatedAt": "2025-10-05T08:50:00.000Z"
  },
  "message": "Task updated successfully"
}
```

### 6. Delete a Task
```bash
curl -X DELETE http://localhost:3000/tasks/123e4567-e89b-12d3-a456-426614174000
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "123e4567-e89b-12d3-a456-426614174000",
    "title": "Learn Express.js",
    "description": "Complete the Express.js tutorial",
    "status": "in-progress",
    "createdAt": "2025-10-05T08:49:47.000Z",
    "updatedAt": "2025-10-05T08:50:00.000Z"
  },
  "message": "Task deleted successfully"
}
```

## Advanced Operations

### Pagination
```bash
# Get first page with 5 items per page
curl "http://localhost:3000/tasks?page=1&limit=5"

# Get second page
curl "http://localhost:3000/tasks?page=2&limit=5"
```

### Filtering by Status
```bash
# Get only pending tasks
curl "http://localhost:3000/tasks?status=pending"

# Get only completed tasks
curl "http://localhost:3000/tasks?status=completed"

# Get only in-progress tasks
curl "http://localhost:3000/tasks?status=in-progress"
```

### Search
```bash
# Search for tasks containing "express"
curl "http://localhost:3000/tasks/search?q=express"

# Search with pagination
curl "http://localhost:3000/tasks/search?q=tutorial&page=1&limit=5"

# Search within specific status
curl "http://localhost:3000/tasks/search?q=express&status=pending"
```

### Get Statistics
```bash
curl http://localhost:3000/tasks/statistics
```

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

## Error Handling Examples

### Invalid Task ID
```bash
curl http://localhost:3000/tasks/invalid-id
```

**Response:**
```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid task ID format"
  },
  "timestamp": "2025-10-05T08:49:47.000Z"
}
```

### Task Not Found
```bash
curl http://localhost:3000/tasks/123e4567-e89b-12d3-a456-426614174999
```

**Response:**
```json
{
  "success": false,
  "error": {
    "code": "TASK_NOT_FOUND",
    "message": "Task with ID 123e4567-e89b-12d3-a456-426614174999 not found"
  },
  "timestamp": "2025-10-05T08:49:47.000Z"
}
```

### Validation Error
```bash
curl -X POST http://localhost:3000/tasks \
  -H "Content-Type: application/json" \
  -d '{
    "title": "",
    "status": "invalid-status"
  }'
```

**Response:**
```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid input data",
    "details": [
      {
        "field": "title",
        "message": "Title is required and must be a string"
      },
      {
        "field": "status",
        "message": "Status must be one of: pending, in-progress, completed"
      }
    ]
  },
  "timestamp": "2025-10-05T08:49:47.000Z"
}
```

### Rate Limiting
```bash
# Make many requests quickly to trigger rate limiting
for i in {1..20}; do
  curl http://localhost:3000/tasks
done
```

**Response (when rate limited):**
```json
{
  "success": false,
  "error": {
    "code": "RATE_LIMIT_EXCEEDED",
    "message": "Too many requests from this IP, please try again later.",
    "retryAfter": "15 minutes"
  },
  "timestamp": "2025-10-05T08:49:47.000Z"
}
```

## JavaScript Examples

### Using fetch API
```javascript
// Create a new task
const createTask = async (taskData) => {
  try {
    const response = await fetch('http://localhost:3000/tasks', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(taskData),
    });

    const result = await response.json();

    if (result.success) {
      console.log('Task created:', result.data);
    } else {
      console.error('Error:', result.error);
    }
  } catch (error) {
    console.error('Network error:', error);
  }
};

// Usage
createTask({
  title: 'Build a REST API',
  description: 'Create a complete REST API with Express.js',
  status: 'pending'
});
```

### Get all tasks with pagination
```javascript
const getTasks = async (page = 1, limit = 10) => {
  try {
    const response = await fetch(
      `http://localhost:3000/tasks?page=${page}&limit=${limit}`
    );

    const result = await response.json();

    if (result.success) {
      console.log('Tasks:', result.data);
      console.log('Pagination:', result.pagination);
    } else {
      console.error('Error:', result.error);
    }
  } catch (error) {
    console.error('Network error:', error);
  }
};

// Usage
getTasks(1, 5);
```

### Update a task
```javascript
const updateTask = async (taskId, updateData) => {
  try {
    const response = await fetch(`http://localhost:3000/tasks/${taskId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(updateData),
    });

    const result = await response.json();

    if (result.success) {
      console.log('Task updated:', result.data);
    } else {
      console.error('Error:', result.error);
    }
  } catch (error) {
    console.error('Network error:', error);
  }
};

// Usage
updateTask('123e4567-e89b-12d3-a456-426614174000', {
  status: 'completed'
});
```

## Testing with Different Tools

### Using httpie
```bash
# Create a task
http POST localhost:3000/tasks title="New Task" description="Task description" status="pending"

# Get tasks
http GET localhost:3000/tasks

# Update a task
http PUT localhost:3000/tasks/123e4567-e89b-12d3-a456-426614174000 status="completed"

# Delete a task
http DELETE localhost:3000/tasks/123e4567-e89b-12d3-a456-426614174000
```

### Using Postman
1. Create a new request
2. Set the method (GET, POST, PUT, DELETE)
3. Set the URL (e.g., `http://localhost:3000/tasks`)
4. For POST/PUT requests:
   - Go to Body tab
   - Select "raw" and "JSON"
   - Add your JSON data
5. Click "Send"

## Best Practices

1. **Always check the success field** in responses before using the data
2. **Handle error responses gracefully** and display appropriate messages to users
3. **Use pagination** for large datasets to avoid performance issues
4. **Validate input data** before sending requests
5. **Implement retry logic** for network failures
6. **Use appropriate HTTP methods** (GET for retrieval, POST for creation, PUT for updates, DELETE for deletion)
7. **Include timestamps** in your client-side logging for debugging
8. **Monitor rate limits** and implement backoff strategies when needed

## Troubleshooting

### Common Issues

1. **"Cannot read property 'success' of undefined"**
   - Check if the server is running
   - Verify the URL is correct
   - Check network connectivity

2. **"Request timeout"**
   - Check if the server is responsive
   - Verify the URL is correct
   - Check if rate limiting is blocking the request

3. **"Invalid JSON"**
   - Ensure your request body is valid JSON
   - Check Content-Type header is set to application/json
   - Use a JSON linter to validate your data

4. **"404 Not Found"**
   - Verify the endpoint URL is correct
   - Check if the task ID exists (for GET/PUT/DELETE operations)
   - Ensure you're using the correct HTTP method

5. **"429 Too Many Requests"**
   - Wait for the rate limit to reset
   - Implement retry logic with exponential backoff
   - Check rate limit headers for timing information