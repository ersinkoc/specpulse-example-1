const express = require('express');
const TaskController = require('../controllers/taskController');
const { validatePagination, validateStatusFilter, validateSearchQuery, validateTaskId, validateTaskCreation, validateTaskUpdate } = require('../middleware/validation');

const router = express.Router();

// GET /tasks - Get all tasks with pagination, filtering, and search
router.get('/', validatePagination, validateStatusFilter, TaskController.getAllTasks);

// GET /tasks/search - Search tasks
router.get('/search', validateSearchQuery, validatePagination, validateStatusFilter, TaskController.searchTasks);

// GET /tasks/statistics - Get task statistics
router.get('/statistics', TaskController.getStatistics);

// GET /tasks/:id - Get specific task by ID
router.get('/:id', validateTaskId, TaskController.getTaskById);

// POST /tasks - Create new task
router.post('/', validateTaskCreation, TaskController.createTask);

// PUT /tasks/:id - Update existing task
router.put('/:id', validateTaskId, validateTaskUpdate, TaskController.updateTask);

// DELETE /tasks/:id - Delete task
router.delete('/:id', validateTaskId, TaskController.deleteTask);

module.exports = router;