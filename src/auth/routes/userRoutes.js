const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const userController = require('../controllers/userController');
const securityMiddleware = require('../middleware/securityMiddleware');
const { authenticate } = require('../middleware/authMiddleware');
const {
  updateProfileSchema,
  changePasswordSchema,
  updatePreferencesSchema,
  deleteAccountSchema,
  revokeSessionSchema
} = require('../middleware/validationSchemas');

const router = express.Router();

// Apply authentication and security middleware to all routes
router.use(authenticate);
router.use(securityMiddleware.createIpBlocker());

// File upload configuration for avatars
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadPath = process.env.UPLOAD_PATH || 'uploads/avatars';

    // Create directory if it doesn't exist
    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true });
    }

    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    // Generate unique filename
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, `avatar-${req.user.id}-${uniqueSuffix}${ext}`);
  }
});

const fileFilter = (req, file, cb) => {
  // Accept only image files
  if (file.mimetype.startsWith('image/')) {
    cb(null, true);
  } else {
    cb(new Error('Only image files are allowed'), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: parseInt(process.env.MAX_FILE_SIZE) || 5 * 1024 * 1024, // 5MB
    files: 1
  }
});

// Profile management routes
router.get('/profile', userController.getProfile);

router.put('/profile',
  securityMiddleware.validateInput({ body: updateProfileSchema }),
  userController.updateProfile
);

router.post('/profile/avatar',
  securityMiddleware.createStrictLimiter({ max: 5 }),
  upload.single('avatar'),
  userController.uploadAvatar
);

// Password management routes
router.post('/change-password',
  securityMiddleware.createStrictLimiter({ max: 5 }),
  securityMiddleware.validateInput({ body: changePasswordSchema }),
  securityMiddleware.validatePasswordStrength,
  userController.changePassword
);

// Preferences routes
router.get('/preferences', userController.getPreferences);

router.put('/preferences',
  securityMiddleware.validateInput({ body: updatePreferencesSchema }),
  userController.updatePreferences
);

// Session management routes
router.delete('/sessions/:sessionId',
  securityMiddleware.validateInput({ params: revokeSessionSchema }),
  userController.revokeSession
);

router.delete('/sessions',
  securityMiddleware.createStrictLimiter({ max: 3 }),
  userController.revokeAllSessions
);

// Account management routes
router.delete('/account',
  securityMiddleware.createStrictLimiter({ max: 1 }),
  securityMiddleware.validateInput({ body: deleteAccountSchema }),
  userController.deleteAccount
);

// Error handling middleware for multer
router.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        success: false,
        error: 'FileSizeExceeded',
        message: 'File size exceeds the maximum allowed limit'
      });
    }
    if (error.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({
        success: false,
        error: 'FileCountExceeded',
        message: 'Too many files uploaded'
      });
    }
  }

  if (error.message === 'Only image files are allowed') {
    return res.status(400).json({
      success: false,
      error: 'InvalidFileType',
      message: 'Only image files are allowed'
    });
  }

  next(error);
});

module.exports = router;