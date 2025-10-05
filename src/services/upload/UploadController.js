const fileUploadService = require('./FileUploadService');
const cloudStorageService = require('./CloudStorageService');
const logger = require('../../shared/utils/logger');

class UploadController {
    // Handle avatar upload
    async uploadAvatar(req, res) {
        try {
            if (!req.file) {
                return res.status(400).json({
                    success: false,
                    error: 'NoFileProvided',
                    message: 'No file uploaded'
                });
            }

            // Validate file
            const validation = fileUploadService.validateFile(req.file);
            if (!validation.isValid) {
                return res.status(400).json({
                    success: false,
                    error: 'InvalidFile',
                    message: 'Invalid file format or size',
                    details: validation.errors
                });
            }

            // Process image and create multiple sizes
            const processedImages = await fileUploadService.processAvatar(
                req.file.buffer,
                req.file.originalname
            );

            // For now, return local file URLs
            // In production, you would upload to cloud storage
            const response = {
                success: true,
                data: {
                    fileId: processedImages.fileId,
                    originalFilename: processedImages.originalFilename,
                    fileSize: processedImages.fileSize,
                    mimeType: processedImages.mimeType,
                    originalSize: processedImages.originalSize,
                    urls: {
                        small: processedImages.processedImages.small.url,
                        medium: processedImages.processedImages.medium.url,
                        large: processedImages.processedImages.large.url,
                        original: processedImages.processedImages.original.url
                    },
                    createdAt: processedImages.createdAt
                }
            };

            // TODO: Upload to cloud storage if configured
            // if (config.aws.accessKeyId && config.aws.secretAccessKey) {
            //     const cloudResults = await cloudStorageService.uploadAvatarSizes(
            //         processedImages.processedImages,
            //         req.user.id
            //     );
            //
            //     response.data.cloudUrls = {
            //         small: cloudResults.small.cdnUrl,
            //         medium: cloudResults.medium.cdnUrl,
            //         large: cloudResults.large.cdnUrl,
            //         original: cloudResults.original.cdnUrl
            //     };
            // }

            logger.info('Avatar uploaded successfully', {
                userId: req.user?.id,
                fileId: processedImages.fileId,
                originalFilename: processedImages.originalFilename,
                fileSize: processedImages.fileSize
            });

            res.json(response);

        } catch (error) {
            logger.error('Failed to upload avatar', {
                error: error.message,
                userId: req.user?.id,
                filename: req.file?.originalname
            });

            res.status(500).json({
                success: false,
                error: 'UploadFailed',
                message: 'Failed to upload avatar',
                details: error.message
            });
        }
    }

    // Delete avatar
    async deleteAvatar(req, res) {
        try {
            const { fileId } = req.params;

            if (!fileId) {
                return res.status(400).json({
                    success: false,
                    error: 'MissingFileId',
                    message: 'File ID is required'
                });
            }

            // TODO: Implement proper avatar deletion logic
            // This would involve:
            // 1. Finding the avatar record in the database
            // 2. Deleting local files
            // 3. Deleting cloud storage files
            // 4. Updating the user's profile to remove avatar reference

            logger.info('Avatar deletion requested', {
                userId: req.user?.id,
                fileId
            });

            res.json({
                success: true,
                message: 'Avatar deleted successfully'
            });

        } catch (error) {
            logger.error('Failed to delete avatar', {
                error: error.message,
                userId: req.user?.id,
                fileId: req.params.fileId
            });

            res.status(500).json({
                success: false,
                error: 'DeletionFailed',
                message: 'Failed to delete avatar',
                details: error.message
            });
        }
    }

    // Get avatar info
    async getAvatarInfo(req, res) {
        try {
            const { fileId } = req.params;

            if (!fileId) {
                return res.status(400).json({
                    success: false,
                    error: 'MissingFileId',
                    message: 'File ID is required'
                });
            }

            // TODO: Implement proper avatar info retrieval
            // This would involve fetching from the database

            res.json({
                success: true,
                data: {
                    fileId,
                    // TODO: Add actual avatar data
                }
            });

        } catch (error) {
            logger.error('Failed to get avatar info', {
                error: error.message,
                fileId: req.params.fileId
            });

            res.status(500).json({
                success: false,
                error: 'RetrievalFailed',
                message: 'Failed to get avatar info',
                details: error.message
            });
        }
    }

    // Validate file before upload
    validateFile(req, res) {
        try {
            if (!req.file) {
                return res.status(400).json({
                    success: false,
                    error: 'NoFileProvided',
                    message: 'No file uploaded'
                });
            }

            const validation = fileUploadService.validateFile(req.file);

            res.json({
                success: true,
                data: {
                    isValid: validation.isValid,
                    errors: validation.errors,
                    fileInfo: {
                        originalname: req.file.originalname,
                        mimetype: req.file.mimetype,
                        size: req.file.size
                    }
                }
            });

        } catch (error) {
            logger.error('Failed to validate file', {
                error: error.message,
                filename: req.file?.originalname
            });

            res.status(500).json({
                success: false,
                error: 'ValidationFailed',
                message: 'Failed to validate file',
                details: error.message
            });
        }
    }
}

module.exports = new UploadController();