const TaskValidator = require('../utils/validators');
const { logger } = require('../utils/logger');

// Validation middleware for task creation
const validateTaskCreation = (req, res, next) => {
  try {
    const { title, description, status } = req.body;

    // Basic field validation
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

    // Use TaskValidator for comprehensive validation
    const validation = TaskValidator.validateTaskData({
      title,
      description,
      status
    });

    if (!validation.isValid) {
      const formattedErrors = validation.errors.map(err => ({
        field: err.field,
        message: err.error
      }));

      logger.warn('Task creation validation failed', {
        errors: formattedErrors,
        body: { title, description, status }
      });

      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid input data',
          details: formattedErrors
        },
        timestamp: new Date().toISOString()
      });
    }

    // Sanitize and attach validated data to request
    req.validatedData = TaskValidator.sanitizeTaskData({
      title,
      description,
      status
    });

    next();
  } catch (error) {
    logger.error('Validation middleware error', {
      error: error.message,
      body: req.body
    });

    res.status(500).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Validation failed'
      },
      timestamp: new Date().toISOString()
    });
  }
};

// Validation middleware for task update
const validateTaskUpdate = (req, res, next) => {
  try {
    const updateData = req.body;

    // Check if update data exists
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

    // Validate update data
    const validation = TaskValidator.validateUpdateData(updateData);

    if (!validation.isValid) {
      const formattedErrors = validation.errors.map(err => ({
        field: err.field,
        message: err.error
      }));

      logger.warn('Task update validation failed', {
        errors: formattedErrors,
        updateData
      });

      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid update data',
          details: formattedErrors
        },
        timestamp: new Date().toISOString()
      });
    }

    // Attach validated data to request
    req.validatedData = updateData;

    next();
  } catch (error) {
    logger.error('Validation middleware error', {
      error: error.message,
      body: req.body
    });

    res.status(500).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Validation failed'
      },
      timestamp: new Date().toISOString()
    });
  }
};

// Validation middleware for task ID
const validateTaskId = (req, res, next) => {
  try {
    const { id } = req.params;

    if (!id || typeof id !== 'string' || id.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Valid task ID is required'
        },
        timestamp: new Date().toISOString()
      });
    }

    // Basic UUID format validation (simple check)
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(id.trim())) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid task ID format'
        },
        timestamp: new Date().toISOString()
      });
    }

    req.taskId = id.trim();
    next();
  } catch (error) {
    logger.error('Task ID validation error', {
      error: error.message,
      taskId: req.params.id
    });

    res.status(500).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Task ID validation failed'
      },
      timestamp: new Date().toISOString()
    });
  }
};

// Validation middleware for pagination parameters
const validatePagination = (req, res, next) => {
  try {
    const { page = '1', limit = '10' } = req.query;

    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);

    // Validate page number
    if (isNaN(pageNum) || pageNum < 1) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Page must be a positive integer'
        },
        timestamp: new Date().toISOString()
      });
    }

    // Validate limit
    if (isNaN(limitNum) || limitNum < 1 || limitNum > 100) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Limit must be between 1 and 100'
        },
        timestamp: new Date().toISOString()
      });
    }

    req.pagination = {
      page: pageNum,
      limit: limitNum
    };

    next();
  } catch (error) {
    logger.error('Pagination validation error', {
      error: error.message,
      query: req.query
    });

    res.status(500).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Pagination validation failed'
      },
      timestamp: new Date().toISOString()
    });
  }
};

// Validation middleware for search query
const validateSearchQuery = (req, res, next) => {
  try {
    const { q } = req.query;

    if (!q || typeof q !== 'string' || q.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Search query is required'
        },
        timestamp: new Date().toISOString()
      });
    }

    // Validate search query length
    if (q.trim().length < 2) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Search query must be at least 2 characters long'
        },
        timestamp: new Date().toISOString()
      });
    }

    if (q.trim().length > 100) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Search query must be 100 characters or less'
        },
        timestamp: new Date().toISOString()
      });
    }

    req.searchQuery = q.trim();
    next();
  } catch (error) {
    logger.error('Search query validation error', {
      error: error.message,
      query: req.query
    });

    res.status(500).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Search query validation failed'
      },
      timestamp: new Date().toISOString()
    });
  }
};

// Validation middleware for status filter
const validateStatusFilter = (req, res, next) => {
  try {
    const { status } = req.query;

    if (status) {
      const validStatuses = ['pending', 'in-progress', 'completed'];
      if (!validStatuses.includes(status)) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: `Status must be one of: ${validStatuses.join(', ')}`
          },
          timestamp: new Date().toISOString()
        });
      }

      req.statusFilter = status;
    }

    next();
  } catch (error) {
    logger.error('Status filter validation error', {
      error: error.message,
      query: req.query
    });

    res.status(500).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Status filter validation failed'
      },
      timestamp: new Date().toISOString()
    });
  }
};

module.exports = {
  validateTaskCreation,
  validateTaskUpdate,
  validateTaskId,
  validatePagination,
  validateSearchQuery,
  validateStatusFilter
};