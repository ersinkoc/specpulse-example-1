const TaskService = require('../services/taskService');
const { logger } = require('../utils/logger');

class TaskController {
  // Create a new task
  static async createTask(req, res) {
    try {
      const { title, description, status } = req.body;

      // Validate required fields
      if (!title) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Title is required'
          },
          timestamp: new Date().toISOString()
        });
      }

      const result = await TaskService.createTask({
        title: title.trim(),
        description: description ? description.trim() : '',
        status: status || 'pending',
        userId: req.user.sub,
        userEmail: req.user.email
      });

      res.status(201).json({
        ...result,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Task creation failed in controller', {
        error: error.message,
        body: req.body
      });

      res.status(400).json({
        success: false,
        error: {
          code: 'TASK_CREATION_FAILED',
          message: error.message
        },
        timestamp: new Date().toISOString()
      });
    }
  }

  // Get all tasks
  static async getAllTasks(req, res) {
    try {
      const {
        page = 1,
        limit = 10,
        status,
        search
      } = req.query;

      // Parse pagination parameters
      const pageNum = parseInt(page, 10);
      const limitNum = parseInt(limit, 10);

      const result = await TaskService.getAllTasks({
        page: pageNum,
        limit: limitNum,
        status,
        search,
        userId: req.user.sub
      });

      res.status(200).json({
        ...result,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Get all tasks failed in controller', {
        error: error.message,
        query: req.query
      });

      res.status(400).json({
        success: false,
        error: {
          code: 'TASK_RETRIEVAL_FAILED',
          message: error.message
        },
        timestamp: new Date().toISOString()
      });
    }
  }

  // Get task by ID
  static async getTaskById(req, res) {
    try {
      const { id } = req.params;

      if (!id) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Task ID is required'
          },
          timestamp: new Date().toISOString()
        });
      }

      const result = await TaskService.getTaskById(id);

      res.status(200).json({
        ...result,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Get task by ID failed in controller', {
        error: error.message,
        taskId: req.params.id
      });

      if (error.message.includes('not found')) {
        res.status(404).json({
          success: false,
          error: {
            code: 'TASK_NOT_FOUND',
            message: error.message
          },
          timestamp: new Date().toISOString()
        });
      } else {
        res.status(400).json({
          success: false,
          error: {
            code: 'TASK_RETRIEVAL_FAILED',
            message: error.message
          },
          timestamp: new Date().toISOString()
        });
      }
    }
  }

  // Update task by ID
  static async updateTask(req, res) {
    try {
      const { id } = req.params;
      const updateData = req.body;

      if (!id) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Task ID is required'
          },
          timestamp: new Date().toISOString()
        });
      }

      if (!updateData || Object.keys(updateData).length === 0) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Update data is required'
          },
          timestamp: new Date().toISOString()
        });
      }

      const result = await TaskService.updateTask(id, updateData);

      res.status(200).json({
        ...result,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Task update failed in controller', {
        error: error.message,
        taskId: req.params.id,
        updateData: req.body
      });

      if (error.message.includes('not found')) {
        res.status(404).json({
          success: false,
          error: {
            code: 'TASK_NOT_FOUND',
            message: error.message
          },
          timestamp: new Date().toISOString()
        });
      } else {
        res.status(400).json({
          success: false,
          error: {
            code: 'TASK_UPDATE_FAILED',
            message: error.message
          },
          timestamp: new Date().toISOString()
        });
      }
    }
  }

  // Delete task by ID
  static async deleteTask(req, res) {
    try {
      const { id } = req.params;

      if (!id) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Task ID is required'
          },
          timestamp: new Date().toISOString()
        });
      }

      const result = await TaskService.deleteTask(id);

      res.status(200).json({
        ...result,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Task deletion failed in controller', {
        error: error.message,
        taskId: req.params.id
      });

      if (error.message.includes('not found')) {
        res.status(404).json({
          success: false,
          error: {
            code: 'TASK_NOT_FOUND',
            message: error.message
          },
          timestamp: new Date().toISOString()
        });
      } else {
        res.status(400).json({
          success: false,
          error: {
            code: 'TASK_DELETION_FAILED',
            message: error.message
          },
          timestamp: new Date().toISOString()
        });
      }
    }
  }

  // Get task statistics
  static async getStatistics(req, res) {
    try {
      const result = await TaskService.getStatistics();

      res.status(200).json({
        ...result,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Get statistics failed in controller', {
        error: error.message
      });

      res.status(500).json({
        success: false,
        error: {
          code: 'STATISTICS_RETRIEVAL_FAILED',
          message: error.message
        },
        timestamp: new Date().toISOString()
      });
    }
  }

  // Search tasks
  static async searchTasks(req, res) {
    try {
      const { q } = req.query;

      if (!q) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Search query is required'
          },
          timestamp: new Date().toISOString()
        });
      }

      const {
        page = 1,
        limit = 10,
        status
      } = req.query;

      const result = await TaskService.searchTasks(q, {
        page: parseInt(page, 10),
        limit: parseInt(limit, 10),
        status
      });

      res.status(200).json({
        ...result,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Task search failed in controller', {
        error: error.message,
        query: req.query
      });

      res.status(400).json({
        success: false,
        error: {
          code: 'TASK_SEARCH_FAILED',
          message: error.message
        },
        timestamp: new Date().toISOString()
      });
    }
  }
}

module.exports = TaskController;