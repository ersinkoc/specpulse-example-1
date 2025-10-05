# Authentication Integration Migration Guide

## Overview

This document provides instructions for migrating the existing simple-express-api to integrate with the new authentication system. The migration ensures that all existing tasks become user-scoped while maintaining backward compatibility where possible.

## Migration Summary

### Before Migration
- Tasks were global/shared
- No user ownership
- No authentication required
- No access control

### After Migration
- Tasks are user-scoped
- User ownership enforced
- Authentication required
- Role-based access control
- User can only access their own tasks

## Migration Steps

### 1. Database Migration

Run the database migration to add user association to tasks:

```bash
# Run the migration
psql -h localhost -U postgres -d specpulse_auth -f src/database/migrations/003_add_user_to_tasks.sql
```

**What this migration does:**
- Adds `user_id` and `user_email` columns to tasks table
- Creates indexes for performance
- Adds foreign key constraints
- Creates a system user for existing tasks
- Adds timestamp columns for auditing

### 2. Code Changes

#### API Routes Update
All task routes now require authentication:

```javascript
// Before (no authentication)
router.get('/', TaskController.getAllTasks);

// After (authentication required)
router.get('/', authenticateToken, TaskController.getAllTasks);
```

#### Controller Updates
Controllers now receive user context:

```javascript
// Before (no user context)
const result = await TaskService.createTask(taskData);

// After (user context available)
const result = await TaskService.createTask({
  ...taskData,
  userId: req.user.sub,
  userEmail: req.user.email
});
```

#### Service Updates
Services now filter by user:

```javascript
// Before (global tasks)
static async getAllTasks(filters) {
  return Task.find(filters);
}

// After (user-scoped)
static async getAllTasks(filters, userId) {
  return Task.find({ ...filters, userId });
}
```

### 3. API Changes

#### Authentication Required
All task endpoints now require a valid JWT token:

```bash
# Before
GET /tasks

# After
GET /tasks
Authorization: Bearer <jwt_token>
```

#### Response Changes
Task responses now include user information:

```json
{
  "success": true,
  "data": {
    "tasks": [
      {
        "id": "task-uuid",
        "title": "Task Title",
        "description": "Task Description",
        "status": "pending",
        "userId": "user-uuid",
        "userEmail": "user@example.com",
        "createdAt": "2025-10-05T14:52:00.000Z",
        "updatedAt": "2025-10-05T14:52:00.000Z"
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 10,
      "total": 1,
      "pages": 1
    }
  }
}
```

### 4. Client Integration

#### JavaScript/Fetch API

```javascript
// Before (no authentication)
const response = await fetch('/api/tasks');
const data = await response.json();

// After (authentication required)
const token = localStorage.getItem('accessToken');
const response = await fetch('/api/tasks', {
  headers: {
    'Authorization': `Bearer ${token}`
  }
});
const data = await response.json();
```

#### React Component Example

```javascript
const TaskList = () => {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const { user } = useAuth();

  useEffect(() => {
    const fetchTasks = async () => {
      try {
        const token = localStorage.getItem('accessToken');
        const response = await fetch('/api/tasks', {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });

        if (!response.ok) {
          throw new Error('Failed to fetch tasks');
        }

        const data = await response.json();
        setTasks(data.data.tasks);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    if (user) {
      fetchTasks();
    }
  }, [user]);

  if (!user) {
    return <div>Please log in to view tasks</div>;
  }

  if (loading) return <div>Loading...</div>;
  if (error) return <div>Error: {error}</div>;

  return (
    <div>
      <h2>My Tasks</h2>
      <ul>
        {tasks.map(task => (
          <li key={task.id}>{task.title}</li>
        ))}
      </ul>
    </div>
  );
};
```

## Backward Compatibility

### Optional Authentication Mode

For gradual migration, you can implement optional authentication:

```javascript
// Optional authentication middleware
const optionalAuth = (req, res, next) => {
  const token = req.headers.authorization?.replace('Bearer ', '');

  if (token) {
    try {
      const decoded = jwt.verify(token, process.env.JWT_ACCESS_SECRET);
      req.user = decoded;
    } catch (error) {
      // Invalid token, but don't block request
    }
  }

  next();
};

// Apply to routes (backward compatible)
router.get('/', optionalAuth, TaskController.getAllTasks);
```

### Migration Period Configuration

Configure authentication behavior during migration:

```env
# Environment configuration for migration period
AUTH_REQUIRED=true
MIGRATION_MODE=true
ALLOW_LEGACY_ACCESS=false
```

## Testing the Migration

### 1. Database Migration Test

```sql
-- Verify migration completed
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'tasks'
  AND column_name IN ('user_id', 'user_email');

-- Verify indexes
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'tasks'
  AND indexname LIKE '%user%';
```

### 2. API Test

```bash
# Test without authentication (should fail)
curl -i http://localhost:3000/tasks

# Expected: 401 Unauthorized

# Test with authentication
curl -i http://localhost:3000/tasks \
  -H "Authorization: Bearer <valid_jwt_token>"

# Expected: 200 OK with user tasks
```

### 3. Integration Test

```javascript
// Test authentication flow
describe('Task Authentication Integration', () => {
  let authToken;

  test('User must authenticate to access tasks', async () => {
    // Login user
    const loginResponse = await request(app)
      .post('/auth/login')
      .send({
        email: 'test@example.com',
        password: 'Password123!'
      });

    expect(loginResponse.status).toBe(200);
    authToken = loginResponse.body.data.tokens.accessToken;

    // Try to access tasks without token
    const unauthResponse = await request(app)
      .get('/tasks');

    expect(unauthResponse.status).toBe(401);

    // Access tasks with token
    const authResponse = await request(app)
      .get('/tasks')
      .set('Authorization', `Bearer ${authToken}`);

    expect(authResponse.status).toBe(200);
    expect(authResponse.body.data.tasks).toBeDefined();
  });

  test('User can only access their own tasks', async () => {
    // Create task as user 1
    const createResponse = await request(app)
      .post('/tasks')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        title: 'Test Task',
        description: 'Test Description'
      });

    expect(createResponse.status).toBe(201);
    const taskId = createResponse.body.data.task.id;

    // Try to access task as user 2
    const user2Response = await request(app)
      .post('/auth/login')
      .send({
        email: 'user2@example.com',
        password: 'Password123!'
      });

    const user2Token = user2Response.body.data.tokens.accessToken;

    const unauthorizedResponse = await request(app)
      .get(`/tasks/${taskId}`)
      .set('Authorization', `Bearer ${user2Token}`);

    expect(unauthorizedResponse.status).toBe(404);
  });
});
```

## Rollback Plan

If migration fails, you can rollback using:

### Database Rollback

```sql
-- Remove user associations from tasks
ALTER TABLE tasks DROP COLUMN IF EXISTS user_id;
ALTER TABLE tasks DROP COLUMN IF EXISTS user_email;
ALTER TABLE tasks DROP COLUMN IF EXISTS created_at;
ALTER TABLE tasks DROP COLUMN IF EXISTS updated_at;

-- Drop indexes
DROP INDEX IF EXISTS idx_tasks_user_id;
DROP INDEX IF EXISTS idx_tasks_user_email;
DROP INDEX IF EXISTS idx_tasks_created_at;

-- Drop trigger
DROP TRIGGER IF EXISTS update_tasks_updated_at ON tasks;
```

### Code Rollback

Revert the authentication middleware changes:

```javascript
// Remove authentication requirement
router.get('/', TaskController.getAllTasks);
router.get('/:id', TaskController.getTaskById);
router.post('/', TaskController.createTask);
router.put('/:id', TaskController.updateTask);
router.delete('/:id', TaskController.deleteTask);
```

## Post-Migration Validation

### 1. Data Integrity Check

```sql
-- Verify all tasks have user associations
SELECT COUNT(*) as tasks_without_user
FROM tasks
WHERE user_id = '00000000-0000-0000-0000-000000000000';

-- Verify foreign key constraints
SELECT conname, contype
FROM pg_constraint
WHERE conname = 'fk_tasks_user_id';
```

### 2. Performance Check

```sql
-- Check query performance with new indexes
EXPLAIN ANALYZE SELECT * FROM tasks WHERE user_id = 'user-uuid';
EXPLAIN ANALYZE SELECT COUNT(*) FROM tasks WHERE user_id = 'user-uuid';
```

### 3. Security Check

- Verify all endpoints require authentication
- Check user isolation is working
- Validate authorization enforcement
- Test rate limiting with authenticated users

## Troubleshooting

### Common Issues

1. **Migration fails on foreign key constraint**
   - Ensure users table exists
   - Check UUID format compatibility
   - Verify data types match

2. **Authentication token not working**
   - Check JWT secret configuration
   - Verify token format
   - Check token expiration

3. **Tasks not showing for user**
   - Verify user ID is being passed correctly
   - Check service layer filtering
   - Verify database user_id values

4. **Performance degradation**
   - Check query plans
   - Verify indexes are being used
   - Monitor database connections

### Debug Mode

Enable debug logging for troubleshooting:

```env
DEBUG=auth:*
NODE_ENV=development
LOG_LEVEL=debug
```

### Health Check

Verify the system is working:

```bash
curl http://localhost:3000/health
```

## Support

For migration issues:

1. Check migration logs: `cat logs/migration.log`
2. Review database schema: `\d tasks` in psql
3. Verify API responses: Check status codes and error messages
4. Test authentication flow: Use provided test scripts
5. Monitor system health: Check health endpoints

## Timeline

- **Day 1**: Database migration and basic testing
- **Day 2-3**: Code updates and integration testing
- **Day 4-5**: Client application updates
- **Day 6-7**: User testing and bug fixes
- **Day 8**: Production deployment and monitoring

## Success Criteria

Migration is successful when:

- [ ] Database migration completes without errors
- [ ] All existing tasks have user associations
- [ ] API endpoints require authentication
- [ ] Users can only access their own tasks
- [ ] Performance is maintained or improved
- [ ] Security controls are working
- [ ] Client applications are updated
- [ ] No data loss or corruption
- [ ] Rollback plan is tested and documented