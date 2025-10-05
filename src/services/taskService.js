const dataStore = require('../utils/dataStore');
const Task = require('../models/Task');
const { logger } = require('../utils/logger');

class TaskService {
  // Create a new task
  static async createTask(taskData) {
    try {
      // Validate task data
      const validation = Task.validate(taskData);
      if (!validation.isValid) {
        const errorMessages = validation.errors.map(err => `${err.field}: ${err.error}`).join(', ');
        throw new Error(`Validation failed: ${errorMessages}`);
      }

      // Create task
      const task = dataStore.createTask(taskData);

      logger.info('Task created successfully', {
        taskId: task.id,
        title: task.title,
        status: task.status
      });

      return {
        success: true,
        data: task.toJSON(),
        message: 'Task created successfully'
      };
    } catch (error) {
      logger.error('Failed to create task', {
        error: error.message,
        taskData: { title: taskData.title, status: taskData.status }
      });

      throw error;
    }
  }

  // Get all tasks with pagination, filtering, and search
  static async getAllTasks(options = {}) {
    try {
      const result = dataStore.getAllTasks(options);

      logger.info('Tasks retrieved successfully', {
        page: result.pagination.page,
        limit: result.pagination.limit,
        total: result.pagination.total,
        filters: { status: options.status, search: options.search }
      });

      return {
        success: true,
        data: result.tasks,
        pagination: result.pagination,
        message: 'Tasks retrieved successfully'
      };
    } catch (error) {
      logger.error('Failed to retrieve tasks', {
        error: error.message,
        options
      });

      throw error;
    }
  }

  // Get task by ID
  static async getTaskById(id) {
    try {
      const task = dataStore.getTaskById(id);

      logger.info('Task retrieved by ID successfully', {
        taskId: id,
        title: task.title
      });

      return {
        success: true,
        data: task.toJSON(),
        message: 'Task retrieved successfully'
      };
    } catch (error) {
      logger.error('Failed to retrieve task by ID', {
        error: error.message,
        taskId: id
      });

      throw error;
    }
  }

  // Update task by ID
  static async updateTask(id, updateData) {
    try {
      // Validate update data
      const validation = Task.validateUpdate(updateData);
      if (!validation.isValid) {
        const errorMessages = validation.errors.map(err => `${err.field}: ${err.error}`).join(', ');
        throw new Error(`Validation failed: ${errorMessages}`);
      }

      const task = dataStore.updateTask(id, updateData);

      logger.info('Task updated successfully', {
        taskId: id,
        updatedFields: Object.keys(updateData),
        newStatus: task.status
      });

      return {
        success: true,
        data: task.toJSON(),
        message: 'Task updated successfully'
      };
    } catch (error) {
      logger.error('Failed to update task', {
        error: error.message,
        taskId: id,
        updateData
      });

      throw error;
    }
  }

  // Delete task by ID
  static async deleteTask(id) {
    try {
      const deletedTask = dataStore.deleteTask(id);

      logger.info('Task deleted successfully', {
        taskId: id,
        title: deletedTask.title
      });

      return {
        success: true,
        data: deletedTask.toJSON(),
        message: 'Task deleted successfully'
      };
    } catch (error) {
      logger.error('Failed to delete task', {
        error: error.message,
        taskId: id
      });

      throw error;
    }
  }

  // Get task statistics
  static async getStatistics() {
    try {
      const stats = dataStore.getStatistics();

      logger.info('Task statistics retrieved', {
        total: stats.total,
        byStatus: stats.byStatus
      });

      return {
        success: true,
        data: stats,
        message: 'Statistics retrieved successfully'
      };
    } catch (error) {
      logger.error('Failed to retrieve task statistics', {
        error: error.message
      });

      throw error;
    }
  }

  // Get data store information
  static async getDataStoreInfo() {
    try {
      const info = dataStore.getInfo();

      logger.info('Data store info retrieved', {
        type: info.type,
        taskCount: info.taskCount
      });

      return {
        success: true,
        data: info,
        message: 'Data store info retrieved successfully'
      };
    } catch (error) {
      logger.error('Failed to retrieve data store info', {
        error: error.message
      });

      throw error;
    }
  }

  // Search tasks
  static async searchTasks(searchTerm, options = {}) {
    try {
      const searchOptions = {
        ...options,
        search: searchTerm
      };

      const result = dataStore.getAllTasks(searchOptions);

      logger.info('Task search completed', {
        searchTerm,
        resultsCount: result.tasks.length,
        page: result.pagination.page
      });

      return {
        success: true,
        data: result.tasks,
        pagination: result.pagination,
        message: `Found ${result.pagination.total} tasks matching "${searchTerm}"`
      };
    } catch (error) {
      logger.error('Failed to search tasks', {
        error: error.message,
        searchTerm,
        options
      });

      throw error;
    }
  }

  // Filter tasks by status
  static async filterTasksByStatus(status, options = {}) {
    try {
      const filterOptions = {
        ...options,
        status
      };

      const result = dataStore.getAllTasks(filterOptions);

      logger.info('Task filtering completed', {
        status,
        resultsCount: result.tasks.length,
        page: result.pagination.page
      });

      return {
        success: true,
        data: result.tasks,
        pagination: result.pagination,
        message: `Found ${result.pagination.total} tasks with status "${status}"`
      };
    } catch (error) {
      logger.error('Failed to filter tasks by status', {
        error: error.message,
        status,
        options
      });

      throw error;
    }
  }
}

module.exports = TaskService;