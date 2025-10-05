const TaskValidator = require('../utils/validators');

class Task {
  constructor(data) {
    // Generate ID if not provided
    this.id = data.id || TaskValidator.generateId();

    // Set and validate title
    const titleValidation = TaskValidator.validateTitle(data.title);
    if (!titleValidation.isValid) {
      throw new Error(`Invalid title: ${titleValidation.error}`);
    }
    this.title = data.title.trim();

    // Set and validate description (optional)
    this.description = '';
    if (data.description !== null && data.description !== undefined) {
      const descriptionValidation = TaskValidator.validateDescription(data.description);
      if (!descriptionValidation.isValid) {
        throw new Error(`Invalid description: ${descriptionValidation.error}`);
      }
      this.description = data.description.trim();
    }

    // Set and validate status
    const statusValidation = TaskValidator.validateStatus(data.status);
    if (!statusValidation.isValid) {
      throw new Error(`Invalid status: ${statusValidation.error}`);
    }
    this.status = data.status;

    // Set timestamps
    this.createdAt = data.createdAt || TaskValidator.getCurrentTimestamp();
    this.updatedAt = TaskValidator.getCurrentTimestamp();
  }

  // Update task with new data
  update(updateData) {
    const validation = TaskValidator.validateUpdateData(updateData);
    if (!validation.isValid) {
      const errorMessages = validation.errors.map(err => `${err.field}: ${err.error}`).join(', ');
      throw new Error(`Validation failed: ${errorMessages}`);
    }

    // Update title if provided
    if (updateData.title !== undefined) {
      this.title = updateData.title.trim();
    }

    // Update description if provided
    if (updateData.description !== undefined) {
      this.description = updateData.description ? updateData.description.trim() : '';
    }

    // Update status if provided
    if (updateData.status !== undefined) {
      this.status = updateData.status;
    }

    // Update timestamp
    this.updatedAt = TaskValidator.getCurrentTimestamp();

    return this;
  }

  // Convert task to plain object
  toJSON() {
    return {
      id: this.id,
      title: this.title,
      description: this.description,
      status: this.status,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt
    };
  }

  // Static method to create task from data
  static create(data) {
    return new Task(data);
  }

  // Static method to validate task data
  static validate(data) {
    return TaskValidator.validateTaskData(data);
  }

  // Static method to validate update data
  static validateUpdate(data) {
    return TaskValidator.validateUpdateData(data);
  }

  // Check if task matches search criteria
  matches(searchTerm) {
    if (!searchTerm) return true;

    const term = searchTerm.toLowerCase();
    return (
      this.title.toLowerCase().includes(term) ||
      this.description.toLowerCase().includes(term)
    );
  }

  // Check if task matches status filter
  hasStatus(status) {
    if (!status) return true;
    return this.status === status;
  }
}

module.exports = Task;