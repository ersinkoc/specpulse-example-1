const express = require('express');
const fileUploadService = require('../services/upload/FileUploadService');
const uploadController = require('../services/upload/UploadController');
const { authenticateToken } = require('../auth/middleware/authMiddleware');
const securityMiddleware = require('../auth/middleware/securityMiddleware');

const router = express.Router();

// Configure multer for avatar uploads
const upload = fileUploadService.getMulterConfig();

// Upload avatar
router.post('/avatar',
    authenticateToken,
    securityMiddleware.createAuthLimiter({ max: 10 }), // 10 avatar uploads per 15 minutes
    upload.single('avatar'),
    uploadController.uploadAvatar
);

// Validate avatar before upload
router.post('/avatar/validate',
    authenticateToken,
    securityMiddleware.createAuthLimiter({ max: 20 }), // 20 validations per 15 minutes
    upload.single('avatar'),
    uploadController.validateFile
);

// Delete avatar
router.delete('/avatar/:fileId',
    authenticateToken,
    securityMiddleware.createAuthLimiter({ max: 10 }), // 10 deletions per 15 minutes
    uploadController.deleteAvatar
);

// Get avatar info
router.get('/avatar/:fileId',
    authenticateToken,
    uploadController.getAvatarInfo
);

module.exports = router;