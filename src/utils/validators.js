const { v4: uuidv4 } = require('uuid');

class TaskValidator {
  static validateTitle(title) {
    if (!title || typeof title !== 'string') {
      return {
        isValid: false,
        error: 'Title is required and must be a string'
      };
    }

    if (title.trim().length === 0) {
      return {
        isValid: false,
        error: 'Title cannot be empty'
      };
    }

    if (title.length > 100) {
      return {
        isValid: false,
        error: 'Title must be 100 characters or less'
      };
    }

    return { isValid: true };
  }

  static validateDescription(description) {
    if (description === null || description === undefined) {
      return { isValid: true }; // Description is optional
    }

    if (typeof description !== 'string') {
      return {
        isValid: false,
        error: 'Description must be a string'
      };
    }

    if (description.length > 500) {
      return {
        isValid: false,
        error: 'Description must be 500 characters or less'
      };
    }

    return { isValid: true };
  }

  static validateStatus(status) {
    const validStatuses = ['pending', 'in-progress', 'completed'];

    if (status === null || status === undefined) {
      return { isValid: true }; // Status is optional for validation
    }

    if (typeof status !== 'string') {
      return {
        isValid: false,
        error: 'Status must be a string'
      };
    }

    if (!validStatuses.includes(status)) {
      return {
        isValid: false,
        error: `Status must be one of: ${validStatuses.join(', ')}`
      };
    }

    return { isValid: true };
  }

  static validateTaskData(data) {
    const errors = [];

    // Validate title
    const titleValidation = this.validateTitle(data.title);
    if (!titleValidation.isValid) {
      errors.push({ field: 'title', error: titleValidation.error });
    }

    // Validate description
    const descriptionValidation = this.validateDescription(data.description);
    if (!descriptionValidation.isValid) {
      errors.push({ field: 'description', error: descriptionValidation.error });
    }

    // Validate status
    const statusValidation = this.validateStatus(data.status);
    if (!statusValidation.isValid) {
      errors.push({ field: 'status', error: statusValidation.error });
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  static validateUpdateData(data) {
    const errors = [];
    const allowedFields = ['title', 'description', 'status'];

    // Check for invalid fields
    const invalidFields = Object.keys(data).filter(field => !allowedFields.includes(field));
    if (invalidFields.length > 0) {
      errors.push({
        field: 'invalid_fields',
        error: `Invalid fields: ${invalidFields.join(', ')}`
      });
    }

    // Validate title if provided
    if (data.title !== undefined) {
      const titleValidation = this.validateTitle(data.title);
      if (!titleValidation.isValid) {
        errors.push({ field: 'title', error: titleValidation.error });
      }
    }

    // Validate description if provided
    if (data.description !== undefined) {
      const descriptionValidation = this.validateDescription(data.description);
      if (!descriptionValidation.isValid) {
        errors.push({ field: 'description', error: descriptionValidation.error });
      }
    }

    // Validate status if provided
    if (data.status !== undefined) {
      const statusValidation = this.validateStatus(data.status);
      if (!statusValidation.isValid) {
        errors.push({ field: 'status', error: statusValidation.error });
      }
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  static generateId() {
    return uuidv4();
  }

  static getCurrentTimestamp() {
    return new Date().toISOString();
  }

  static sanitizeTaskData(data) {
    return {
      id: data.id || this.generateId(),
      title: data.title ? data.title.trim() : '',
      description: data.description ? data.description.trim() : '',
      status: data.status || 'pending',
      createdAt: data.createdAt || this.getCurrentTimestamp(),
      updatedAt: this.getCurrentTimestamp()
    };
  }
}

module.exports = TaskValidator;