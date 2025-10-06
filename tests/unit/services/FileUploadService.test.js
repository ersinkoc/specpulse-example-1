const FileUploadService = require('../../../src/services/upload/FileUploadService');
const fs = require('fs');
const path = require('path');

// Mock Sharp
jest.mock('sharp', () => {
  return jest.fn(() => ({
    resize: jest.fn().mockReturnThis(),
    jpeg: jest.fn().mockReturnThis(),
    progressive: jest.fn().mockReturnThis(),
    toFile: jest.fn().mockResolvedValue({}),
    metadata: jest.fn().mockResolvedValue({
      format: 'jpeg',
      width: 1920,
      height: 1080
    })
  }));
});

describe('FileUploadService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getMulterConfig', () => {
    test('should return multer configuration', () => {
      const config = FileUploadService.getMulterConfig();

      expect(config).toHaveProperty('storage');
      expect(config).toHaveProperty('limits');
      expect(config).toHaveProperty('fileFilter');
      expect(config.limits.fileSize).toBe(4 * 1024 * 1024); // 4MB
      expect(config.limits.files).toBe(1);
    });
  });

  describe('validateFile', () => {
    test('should validate valid JPEG file', () => {
      const file = {
        originalname: 'avatar.jpg',
        mimetype: 'image/jpeg',
        size: 1024 * 1024 // 1MB
      };

      const validation = FileUploadService.validateFile(file);

      expect(validation.isValid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });

    test('should validate valid PNG file', () => {
      const file = {
        originalname: 'avatar.png',
        mimetype: 'image/png',
        size: 1024 * 1024
      };

      const validation = FileUploadService.validateFile(file);

      expect(validation.isValid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });

    test('should validate valid WebP file', () => {
      const file = {
        originalname: 'avatar.webp',
        mimetype: 'image/webp',
        size: 1024 * 1024
      };

      const validation = FileUploadService.validateFile(file);

      expect(validation.isValid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });

    test('should reject file that is too large', () => {
      const file = {
        originalname: 'avatar.jpg',
        mimetype: 'image/jpeg',
        size: 5 * 1024 * 1024 // 5MB
      };

      const validation = FileUploadService.validateFile(file);

      expect(validation.isValid).toBe(false);
      expect(validation.errors).toContain('File size 5242880 exceeds maximum allowed size of 4194304');
    });

    test('should reject unsupported file type', () => {
      const file = {
        originalname: 'document.pdf',
        mimetype: 'application/pdf',
        size: 1024 * 1024
      };

      const validation = FileUploadService.validateFile(file);

      expect(validation.isValid).toBe(false);
      expect(validation.errors).toContain('File type application/pdf is not allowed');
    });

    test('should reject file without name', () => {
      const file = {
        originalname: '',
        mimetype: 'image/jpeg',
        size: 1024 * 1024
      };

      const validation = FileUploadService.validateFile(file);

      expect(validation.isValid).toBe(false);
      expect(validation.errors).toContain('Filename is required');
    });

    test('should reject file with name too long', () => {
      const file = {
        originalname: 'a'.repeat(256) + '.jpg',
        mimetype: 'image/jpeg',
        size: 1024 * 1024
      };

      const validation = FileUploadService.validateFile(file);

      expect(validation.isValid).toBe(false);
      expect(validation.errors).toContain('Filename must be less than 255 characters');
    });
  });

  describe('getAvatarUrl', () => {
    test('should return URL for requested size', () => {
      const processedImages = {
        small: { url: '/uploads/avatars/small_test.jpg' },
        medium: { url: '/uploads/avatars/medium_test.jpg' },
        large: { url: '/uploads/avatars/large_test.jpg' },
        original: { url: '/uploads/avatars/original_test.jpg' }
      };

      const url = FileUploadService.getAvatarUrl(processedImages, 'small');

      expect(url).toBe('/uploads/avatars/small_test.jpg');
    });

    test('should return medium size as fallback', () => {
      const processedImages = {
        medium: { url: '/uploads/avatars/medium_test.jpg' },
        original: { url: '/uploads/avatars/original_test.jpg' }
      };

      const url = FileUploadService.getAvatarUrl(processedImages, 'small');

      expect(url).toBe('/uploads/avatars/medium_test.jpg');
    });

    test('should return original size as final fallback', () => {
      const processedImages = {
        original: { url: '/uploads/avatars/original_test.jpg' }
      };

      const url = FileUploadService.getAvatarUrl(processedImages, 'small');

      expect(url).toBe('/uploads/avatars/original_test.jpg');
    });

    test('should return null for empty processed images', () => {
      const url = FileUploadService.getAvatarUrl(null, 'small');

      expect(url).toBeNull();
    });
  });

  describe('deleteAvatar', () => {
    test('should delete all avatar files', async () => {
      const processedImages = {
        small: { path: '/path/to/small.jpg' },
        medium: { path: '/path/to/medium.jpg' },
        large: { path: '/path/to/large.jpg' },
        original: { path: '/path/to/original.jpg' }
      };

      // Mock fs.unlink
      const unlinkSpy = jest.spyOn(fs.promises, 'unlink').mockResolvedValue();

      const result = await FileUploadService.deleteAvatar(processedImages);

      expect(result).toBe(true);
      expect(unlinkSpy).toHaveBeenCalledTimes(4);
      expect(unlinkSpy).toHaveBeenCalledWith('/path/to/small.jpg');
      expect(unlinkSpy).toHaveBeenCalledWith('/path/to/medium.jpg');
      expect(unlinkSpy).toHaveBeenCalledWith('/path/to/large.jpg');
      expect(unlinkSpy).toHaveBeenCalledWith('/path/to/original.jpg');

      unlinkSpy.mockRestore();
    });

    test('should handle deletion errors gracefully', async () => {
      const processedImages = {
        small: { path: '/path/to/small.jpg' },
        medium: { path: '/path/to/medium.jpg' }
      };

      // Mock fs.unlink to throw error
      const unlinkSpy = jest.spyOn(fs.promises, 'unlink').mockRejectedValue(new Error('File not found'));

      const result = await FileUploadService.deleteAvatar(processedImages);

      expect(result).toBe(false); // Still returns false on errors

      unlinkSpy.mockRestore();
    });
  });

  describe('processAvatar', () => {
    test('should process avatar image successfully', async () => {
      const buffer = Buffer.from('fake-image-data');
      const originalFilename = 'avatar.jpg';

      // Mock path.join to return test path
      const originalJoin = path.join;
      path.join = jest.fn((...args) => originalJoin(...args));

      const result = await FileUploadService.processAvatar(buffer, originalFilename);

      expect(result).toHaveProperty('fileId');
      expect(result).toHaveProperty('originalFilename', 'avatar.jpg');
      expect(result).toHaveProperty('fileExtension', '.jpg');
      expect(result).toHaveProperty('mimeType', 'jpeg');
      expect(result).toHaveProperty('originalSize', '1920x1080');
      expect(result).toHaveProperty('fileSize', buffer.length);
      expect(result).toHaveProperty('processedImages');
      expect(result).toHaveProperty('createdAt');

      expect(result.processedImages).toHaveProperty('small');
      expect(result.processedImages).toHaveProperty('medium');
      expect(result.processedImages).toHaveProperty('large');
      expect(result.processedImages).toHaveProperty('original');

      // Restore original path.join
      path.join = originalJoin;
    });

    test('should handle processing errors', async () => {
      const buffer = Buffer.from('fake-image-data');
      const originalFilename = 'avatar.jpg';

      // Mock Sharp to throw error
      const sharp = require('sharp');
      sharp.mockImplementation(() => {
        throw new Error('Processing failed');
      });

      await expect(FileUploadService.processAvatar(buffer, originalFilename))
        .rejects.toThrow('Failed to process image: Processing failed');
    });
  });
});