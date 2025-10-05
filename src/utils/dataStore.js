const { logger } = require('./logger');

class DataStore {
  constructor() {
    this.tasks = [];
    this.nextId = 1;
    this.initializeSampleData();
  }

  // Initialize with some sample data
  initializeSampleData() {
    const sampleTasks = [
      {
        title: 'Setup project structure',
        description: 'Create directory structure and configuration files',
        status: 'completed'
      },
      {
        title: 'Implement Express server',
        description: 'Create basic Express.js server with middleware',
        status: 'completed'
      },
      {
        title: 'Add task management endpoints',
        description: 'Implement CRUD operations for tasks',
        status: 'in-progress'
      }
    ];

    sampleTasks.forEach(taskData => {
      this.createTask(taskData);
    });

    logger.info('Data store initialized with sample data', {
      taskCount: this.tasks.length
    });
  }

  // Create a new task
  createTask(taskData) {
    const Task = require('../models/Task');
    const task = Task.create(taskData);
    this.tasks.push(task);

    logger.info('Task created', {
      taskId: task.id,
      title: task.title
    });

    return task;
  }

  // Get all tasks with pagination, filtering, and search
  getAllTasks(options = {}) {
    const {
      page = 1,
      limit = 10,
      status,
      search
    } = options;

    // Convert page and limit to numbers
    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);

    // Validate pagination parameters
    if (pageNum < 1) throw new Error('Page must be greater than 0');
    if (limitNum < 1 || limitNum > 100) throw new Error('Limit must be between 1 and 100');

    // Filter tasks
    let filteredTasks = this.tasks;

    // Filter by status
    if (status) {
      filteredTasks = filteredTasks.filter(task => task.hasStatus(status));
    }

    // Search functionality
    if (search) {
      filteredTasks = filteredTasks.filter(task => task.matches(search));
    }

    // Sort by creation date (newest first)
    filteredTasks.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    // Pagination
    const total = filteredTasks.length;
    const totalPages = Math.ceil(total / limitNum);
    const offset = (pageNum - 1) * limitNum;
    const paginatedTasks = filteredTasks.slice(offset, offset + limitNum);

    const result = {
      tasks: paginatedTasks.map(task => task.toJSON()),
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages,
        hasNext: pageNum < totalPages,
        hasPrev: pageNum > 1
      }
    };

    logger.info('Tasks retrieved', {
      page: pageNum,
      limit: limitNum,
      total,
      filtered: filteredTasks.length
    });

    return result;
  }

  // Get task by ID
  getTaskById(id) {
    const task = this.tasks.find(t => t.id === id);

    if (!task) {
      throw new Error(`Task with ID ${id} not found`);
    }

    logger.info('Task retrieved by ID', { taskId: id });
    return task;
  }

  // Update task by ID
  updateTask(id, updateData) {
    const taskIndex = this.tasks.findIndex(t => t.id === id);

    if (taskIndex === -1) {
      throw new Error(`Task with ID ${id} not found`);
    }

    const task = this.tasks[taskIndex];
    task.update(updateData);

    logger.info('Task updated', {
      taskId: id,
      updatedFields: Object.keys(updateData)
    });

    return task;
  }

  // Delete task by ID
  deleteTask(id) {
    const taskIndex = this.tasks.findIndex(t => t.id === id);

    if (taskIndex === -1) {
      throw new Error(`Task with ID ${id} not found`);
    }

    const deletedTask = this.tasks.splice(taskIndex, 1)[0];

    logger.info('Task deleted', {
      taskId: id,
      title: deletedTask.title
    });

    return deletedTask;
  }

  // Get statistics
  getStatistics() {
    const stats = {
      total: this.tasks.length,
      byStatus: {
        pending: 0,
        'in-progress': 0,
        completed: 0
      },
      recentlyCreated: 0,
      recentlyUpdated: 0
    };

    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    this.tasks.forEach(task => {
      // Count by status
      stats.byStatus[task.status]++;

      // Count recently created (last 24 hours)
      if (new Date(task.createdAt) > oneDayAgo) {
        stats.recentlyCreated++;
      }

      // Count recently updated (last 24 hours)
      if (new Date(task.updatedAt) > oneDayAgo) {
        stats.recentlyUpdated++;
      }
    });

    return stats;
  }

  // Clear all tasks (for testing)
  clearAllTasks() {
    this.tasks = [];
    logger.warn('All tasks cleared from data store');
  }

  // Get data store info
  getInfo() {
    return {
      type: 'In-Memory Data Store',
      taskCount: this.tasks.length,
      memoryUsage: process.memoryUsage(),
      uptime: process.uptime()
    };
  }
}

// Create singleton instance
const dataStore = new DataStore();

module.exports = dataStore;