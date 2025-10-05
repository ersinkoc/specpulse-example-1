const Task = require('../../../src/models/Task');

describe('Task Model', () => {
  beforeEach(() => {
    // Clear any state before each test
  });

  describe('Task Creation', () => {
    test('should create a task with valid data', () => {
      const taskData = {
        title: 'Test Task',
        description: 'Test Description',
        status: 'pending'
      };

      const task = Task.create(taskData);

      expect(task).toBeDefined();
      expect(task.id).toBeDefined();
      expect(task.title).toBe('Test Task');
      expect(task.description).toBe('Test Description');
      expect(task.status).toBe('pending');
      expect(task.createdAt).toBeDefined();
      expect(task.updatedAt).toBeDefined();
    });

    test('should create a task with minimal required data', () => {
      const taskData = {
        title: 'Test Task'
      };

      const task = Task.create(taskData);

      expect(task).toBeDefined();
      expect(task.title).toBe('Test Task');
      expect(task.description).toBe('');
      expect(task.status).toBe('pending');
    });

    test('should generate unique IDs for different tasks', () => {
      const taskData1 = { title: 'Task 1' };
      const taskData2 = { title: 'Task 2' };

      const task1 = Task.create(taskData1);
      const task2 = Task.create(taskData2);

      expect(task1.id).not.toBe(task2.id);
    });

    test('should trim whitespace from title and description', () => {
      const taskData = {
        title: '  Test Task  ',
        description: '  Test Description  '
      };

      const task = Task.create(taskData);

      expect(task.title).toBe('Test Task');
      expect(task.description).toBe('Test Description');
    });
  });

  describe('Task Validation', () => {
    test('should throw error for missing title', () => {
      const taskData = {
        description: 'Test Description',
        status: 'pending'
      };

      expect(() => {
        Task.create(taskData);
      }).toThrow('Invalid title: Title is required');
    });

    test('should throw error for empty title', () => {
      const taskData = {
        title: '',
        description: 'Test Description',
        status: 'pending'
      };

      expect(() => {
        Task.create(taskData);
      }).toThrow('Invalid title: Title is required and must be a string');
    });

    test('should throw error for title longer than 100 characters', () => {
      const taskData = {
        title: 'a'.repeat(101),
        status: 'pending'
      };

      expect(() => {
        Task.create(taskData);
      }).toThrow('Invalid title: Title must be 100 characters or less');
    });

    test('should throw error for invalid status', () => {
      const taskData = {
        title: 'Test Task',
        status: 'invalid-status'
      };

      expect(() => {
        Task.create(taskData);
      }).toThrow('Invalid status: Status must be one of: pending, in-progress, completed');
    });

    test('should throw error for description longer than 500 characters', () => {
      const taskData = {
        title: 'Test Task',
        description: 'a'.repeat(501),
        status: 'pending'
      };

      expect(() => {
        Task.create(taskData);
      }).toThrow('Invalid description: Description must be 500 characters or less');
    });

    test('should accept null or undefined description', () => {
      const taskData1 = {
        title: 'Test Task',
        description: null,
        status: 'pending'
      };

      const taskData2 = {
        title: 'Test Task',
        description: undefined,
        status: 'pending'
      };

      expect(() => {
        Task.create(taskData1);
        Task.create(taskData2);
      }).not.toThrow();

      const task1 = Task.create(taskData1);
      const task2 = Task.create(taskData2);

      expect(task1.description).toBe('');
      expect(task2.description).toBe('');
    });
  });

  describe('Task Update', () => {
    test('should update task with valid data', () => {
      const taskData = {
        title: 'Original Task',
        description: 'Original Description',
        status: 'pending'
      };

      const task = Task.create(taskData);
      const originalUpdatedAt = task.updatedAt;

      // Wait a bit to ensure timestamp difference
      setTimeout(() => {
        const updateData = {
          title: 'Updated Task',
          description: 'Updated Description',
          status: 'completed'
        };

        task.update(updateData);

        expect(task.title).toBe('Updated Task');
        expect(task.description).toBe('Updated Description');
        expect(task.status).toBe('completed');
        expect(task.updatedAt).not.toBe(originalUpdatedAt);
      }, 10);
    });

    test('should update task with partial data', () => {
      const taskData = {
        title: 'Original Task',
        description: 'Original Description',
        status: 'pending'
      };

      const task = Task.create(taskData);

      const updateData = {
        status: 'in-progress'
      };

      task.update(updateData);

      expect(task.title).toBe('Original Task');
      expect(task.description).toBe('Original Description');
      expect(task.status).toBe('in-progress');
    });

    test('should throw error for invalid update data', () => {
      const taskData = {
        title: 'Original Task',
        status: 'pending'
      };

      const task = Task.create(taskData);

      const updateData = {
        title: ''
      };

      expect(() => {
        task.update(updateData);
      }).toThrow();
    });

    test('should throw error for invalid fields in update data', () => {
      const taskData = {
        title: 'Original Task',
        status: 'pending'
      };

      const task = Task.create(taskData);

      const updateData = {
        invalidField: 'value'
      };

      expect(() => {
        task.update(updateData);
      }).toThrow('Validation failed: invalid_fields: Invalid fields: invalidField');
    });
  });

  describe('Task Serialization', () => {
    test('should convert task to plain object', () => {
      const taskData = {
        title: 'Test Task',
        description: 'Test Description',
        status: 'pending'
      };

      const task = Task.create(taskData);
      const taskJSON = task.toJSON();

      expect(taskJSON).toEqual({
        id: task.id,
        title: 'Test Task',
        description: 'Test Description',
        status: 'pending',
        createdAt: task.createdAt,
        updatedAt: task.updatedAt
      });
    });

    test('should not include internal properties in JSON', () => {
      const taskData = {
        title: 'Test Task',
        status: 'pending'
      };

      const task = Task.create(taskData);
      const taskJSON = task.toJSON();

      expect(taskJSON).not.toHaveProperty('__proto__');
      expect(taskJSON).not.toHaveProperty('constructor');
      expect(taskJSON).not.toHaveProperty('prototype');
    });
  });

  describe('Task Search and Filtering', () => {
    test('should match search terms in title', () => {
      const taskData = {
        title: 'Test Task',
        description: 'Description',
        status: 'pending'
      };

      const task = Task.create(taskData);

      expect(task.matches('test')).toBe(true);
      expect(task.matches('Test')).toBe(true);
      expect(task.matches('TASK')).toBe(true);
    });

    test('should match search terms in description', () => {
      const taskData = {
        title: 'Task',
        description: 'Test Description',
        status: 'pending'
      };

      const task = Task.create(taskData);

      expect(task.matches('description')).toBe(true);
      expect(task.matches('Description')).toBe(true);
    });

    test('should not match search terms not in title or description', () => {
      const taskData = {
        title: 'Test Task',
        description: 'Test Description',
        status: 'pending'
      };

      const task = Task.create(taskData);

      expect(task.matches('nonexistent')).toBe(false);
    });

    test('should handle empty search term', () => {
      const taskData = {
        title: 'Test Task',
        status: 'pending'
      };

      const task = Task.create(taskData);

      expect(task.matches('')).toBe(true);
      expect(task.matches(null)).toBe(true);
      expect(task.matches(undefined)).toBe(true);
    });

    test('should check task status correctly', () => {
      const taskData = {
        title: 'Test Task',
        status: 'pending'
      };

      const task = Task.create(taskData);

      expect(task.hasStatus('pending')).toBe(true);
      expect(task.hasStatus('in-progress')).toBe(false);
      expect(task.hasStatus('completed')).toBe(false);
      expect(task.hasStatus('')).toBe(true);
      expect(task.hasStatus(null)).toBe(true);
    });
  });

  describe('Static Methods', () => {
    test('should validate task data correctly', () => {
      const validData = {
        title: 'Test Task',
        description: 'Test Description',
        status: 'pending'
      };

      const result = Task.validate(validData);

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    test('should validate update data correctly', () => {
      const validUpdateData = {
        title: 'Updated Task',
        status: 'completed'
      };

      const result = Task.validateUpdate(validUpdateData);

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    test('should reject invalid update data', () => {
      const invalidUpdateData = {
        title: '',
        status: 'invalid-status'
      };

      const result = Task.validateUpdate(invalidUpdateData);

      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });
});