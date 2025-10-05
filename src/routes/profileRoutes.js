const express = require('express');
const profileController = require('../controllers/profileController');
const { authenticateToken } = require('../auth/middleware/authMiddleware');
const securityMiddleware = require('../auth/middleware/securityMiddleware');
const fileUploadService = require('../services/upload/FileUploadService');

const router = express.Router();

// Apply authentication middleware to all routes
router.use(authenticateToken);

// Profile CRUD operations
router.post('/',
    securityMiddleware.createAuthLimiter({ max: 5 }), // 5 profile creations per 15 minutes
    profileController.createProfile
);

router.get('/me',
    securityMiddleware.createApiLimiter({ max: 100 }), // 100 requests per 15 minutes
    profileController.getMyProfile
);

router.get('/search',
    securityMiddleware.createApiLimiter({ max: 50 }), // 50 searches per 15 minutes
    profileController.searchProfiles
);

router.get('/:profileId',
    securityMiddleware.createApiLimiter({ max: 200 }), // 200 profile views per 15 minutes
    profileController.getProfile
);

router.put('/:profileId',
    securityMiddleware.createAuthLimiter({ max: 20 }), // 20 updates per 15 minutes
    profileController.updateProfile
);

router.delete('/:profileId',
    securityMiddleware.createAuthLimiter({ max: 5 }), // 5 deletions per 15 minutes
    profileController.deleteProfile
);

// Profile statistics
router.get('/:profileId/statistics',
    securityMiddleware.createApiLimiter({ max: 50 }), // 50 stats requests per 15 minutes
    profileController.getProfileStatistics
);

// Social links management
router.post('/:profileId/social-links',
    securityMiddleware.createAuthLimiter({ max: 10 }), // 10 social link additions per 15 minutes
    profileController.addSocialLink
);

router.delete('/:profileId/social-links/:linkId',
    securityMiddleware.createAuthLimiter({ max: 10 }), // 10 social link removals per 15 minutes
    profileController.removeSocialLink
);

// Avatar management
router.put('/:profileId/avatar',
    securityMiddleware.createAuthLimiter({ max: 10 }), // 10 avatar updates per 15 minutes
    profileController.updateAvatar
);

// Health check (no rate limiting)
router.get('/health/service',
    profileController.healthCheck
);

module.exports = router;