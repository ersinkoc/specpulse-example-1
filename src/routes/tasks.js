const express = require('express');
const TaskController = require('../controllers/taskController');
const { validatePagination, validateStatusFilter, validateSearchQuery, validateTaskId, validateTaskCreation, validateTaskUpdate } = require('../middleware/validation');
const { authenticateToken, optionalAuth } = require('../auth/middleware/authMiddleware');

const router = express.Router();

// GET /tasks - Get all tasks with pagination, filtering, and search
router.get('/', authenticateToken, validatePagination, validateStatusFilter, TaskController.getAllTasks);

// GET /tasks/search - Search tasks
router.get('/search', authenticateToken, validateSearchQuery, validatePagination, validateStatusFilter, TaskController.searchTasks);

// GET /tasks/statistics - Get task statistics (user-specific)
router.get('/statistics', authenticateToken, TaskController.getStatistics);

// GET /tasks/:id - Get specific task by ID
router.get('/:id', authenticateToken, validateTaskId, TaskController.getTaskById);

// POST /tasks - Create new task
router.post('/', authenticateToken, validateTaskCreation, TaskController.createTask);

// PUT /tasks/:id - Update existing task
router.put('/:id', authenticateToken, validateTaskId, validateTaskUpdate, TaskController.updateTask);

// DELETE /tasks/:id - Delete task
router.delete('/:id', authenticateToken, validateTaskId, TaskController.deleteTask);

module.exports = router;