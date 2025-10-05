const multer = require('multer');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs').promises;
const crypto = require('crypto');
const config = require('../../shared/config/environment');
const logger = require('../../shared/utils/logger');

class FileUploadService {
    constructor() {
        this.maxFileSize = 4 * 1024 * 1024; // 4MB
        this.allowedMimeTypes = [
            'image/jpeg',
            'image/jpg',
            'image/png',
            'image/webp'
        ];
        this.avatarSizes = [
            { name: 'small', size: 32, quality: 90 },
            { name: 'medium', size: 128, quality: 85 },
            { name: 'large', size: 512, quality: 80 }
        ];
    }

    // Configure multer for memory storage
    getMulterConfig() {
        const storage = multer.memoryStorage();

        const fileFilter = (req, file, cb) => {
            if (this.allowedMimeTypes.includes(file.mimetype)) {
                cb(null, true);
            } else {
                cb(new Error(`File type ${file.mimetype} is not allowed. Allowed types: ${this.allowedMimeTypes.join(', ')}`), false);
            }
        };

        return multer({
            storage,
            limits: {
                fileSize: this.maxFileSize,
                files: 1
            },
            fileFilter
        });
    }

    // Process uploaded image and create multiple sizes
    async processAvatar(buffer, originalFilename) {
        try {
            const fileId = crypto.randomBytes(16).toString('hex');
            const fileExtension = path.extname(originalFilename);
            const baseFilename = `${fileId}${fileExtension}`;

            const processedImages = {};
            const metadata = await sharp(buffer).metadata();

            // Process each size
            for (const sizeConfig of this.avatarSizes) {
                const filename = `${sizeConfig.name}_${baseFilename}`;
                const outputPath = path.join(process.cwd(), 'uploads', 'avatars', filename);

                await sharp(buffer)
                    .resize(sizeConfig.size, sizeConfig.size, {
                        fit: 'cover',
                        position: 'center'
                    })
                    .jpeg({
                        quality: sizeConfig.quality,
                        progressive: true
                    })
                    .toFile(outputPath);

                processedImages[sizeConfig.name] = {
                    path: outputPath,
                    filename: filename,
                    size: sizeConfig.size,
                    url: `/uploads/avatars/${filename}`
                };
            }

            // Also save the original image (optimized)
            const originalOptimizedPath = path.join(process.cwd(), 'uploads', 'avatars', `original_${baseFilename}`);
            await sharp(buffer)
                .jpeg({
                    quality: 85,
                    progressive: true
                })
                .toFile(originalOptimizedPath);

            processedImages.original = {
                path: originalOptimizedPath,
                filename: `original_${baseFilename}`,
                size: { width: metadata.width, height: metadata.height },
                url: `/uploads/avatars/original_${baseFilename}`
            };

            return {
                fileId,
                originalFilename,
                fileExtension,
                mimeType: metadata.format,
                originalSize: metadata.width + 'x' + metadata.height,
                fileSize: buffer.length,
                processedImages,
                createdAt: new Date()
            };

        } catch (error) {
            logger.error('Failed to process avatar', { error: error.message, originalFilename });
            throw new Error(`Failed to process image: ${error.message}`);
        }
    }

    // Validate file before processing
    validateFile(file) {
        const errors = [];

        if (!file) {
            errors.push('No file provided');
            return { isValid: false, errors };
        }

        if (!this.allowedMimeTypes.includes(file.mimetype)) {
            errors.push(`File type ${file.mimetype} is not allowed`);
        }

        if (file.size > this.maxFileSize) {
            errors.push(`File size ${file.size} exceeds maximum allowed size of ${this.maxFileSize}`);
        }

        return {
            isValid: errors.length === 0,
            errors
        };
    }

    // Delete avatar files
    async deleteAvatar(processedImages) {
        try {
            const deletePromises = Object.values(processedImages).map(async (image) => {
                try {
                    await fs.unlink(image.path);
                } catch (error) {
                    logger.warn('Failed to delete avatar file', { path: image.path, error: error.message });
                }
            });

            await Promise.all(deletePromises);
            return true;
        } catch (error) {
            logger.error('Failed to delete avatar files', { error: error.message });
            return false;
        }
    }

    // Get avatar URL for a specific size
    getAvatarUrl(processedImages, size = 'medium') {
        if (!processedImages || !processedImages[size]) {
            return processedImages?.medium?.url || processedImages?.original?.url || null;
        }
        return processedImages[size].url;
    }

    // Clean up orphaned files (files not referenced in database)
    async cleanupOrphanedFiles() {
        try {
            const avatarsDir = path.join(process.cwd(), 'uploads', 'avatars');
            const files = await fs.readdir(avatarsDir);

            // This is a simplified cleanup - in production, you'd want to
            // check against the database to find truly orphaned files
            const now = Date.now();
            const maxAge = 24 * 60 * 60 * 1000; // 24 hours

            for (const file of files) {
                const filePath = path.join(avatarsDir, file);
                const stats = await fs.stat(filePath);

                // Delete files older than 24 hours that are temporary
                if (file.startsWith('temp_') && (now - stats.mtime.getTime()) > maxAge) {
                    await fs.unlink(filePath);
                    logger.info('Cleaned up temporary avatar file', { file });
                }
            }

        } catch (error) {
            logger.error('Failed to cleanup orphaned files', { error: error.message });
        }
    }

    // Get file info
    async getFileInfo(filePath) {
        try {
            const stats = await fs.stat(filePath);
            const metadata = await sharp(filePath).metadata();

            return {
                size: stats.size,
                created: stats.birthtime,
                modified: stats.mtime,
                width: metadata.width,
                height: metadata.height,
                format: metadata.format
            };
        } catch (error) {
            logger.error('Failed to get file info', { filePath, error: error.message });
            return null;
        }
    }
}

module.exports = new FileUploadService();