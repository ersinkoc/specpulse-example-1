const profileService = require('../services/profile/ProfileService');
const validationService = require('../services/profile/ProfileValidationService');
const logger = require('../shared/utils/logger');

class ProfileController {
    // Create a new profile
    async createProfile(req, res) {
        try {
            const userId = req.user.id;
            const profileData = req.body;

            // Validate input data
            const validation = validationService.validateCompleteProfileData(profileData);
            if (!validation.isValid) {
                return res.status(400).json({
                    success: false,
                    error: 'ValidationError',
                    message: 'Invalid profile data',
                    details: validation.errors
                });
            }

            const profile = await profileService.createProfile(userId, profileData);

            logger.info('Profile created via API', {
                profileId: profile.profile.id,
                userId
            });

            res.status(201).json({
                success: true,
                data: profile
            });

        } catch (error) {
            logger.error('Failed to create profile via API', {
                error: error.message,
                userId: req.user?.id,
                body: req.body
            });

            if (error.message === 'Profile already exists for this user') {
                return res.status(409).json({
                    success: false,
                    error: 'ProfileExists',
                    message: error.message
                });
            }

            res.status(500).json({
                success: false,
                error: 'CreationFailed',
                message: 'Failed to create profile',
                details: error.message
            });
        }
    }

    // Get profile by ID
    async getProfile(req, res) {
        try {
            const { profileId } = req.params;
            const requestingUserId = req.user?.id;

            const profile = await profileService.getProfileById(profileId, requestingUserId);

            res.json({
                success: true,
                data: profile
            });

        } catch (error) {
            logger.error('Failed to get profile via API', {
                error: error.message,
                profileId: req.params.profileId,
                userId: req.user?.id
            });

            if (error.message === 'Profile not found') {
                return res.status(404).json({
                    success: false,
                    error: 'ProfileNotFound',
                    message: error.message
                });
            }

            if (error.message === 'Profile is private') {
                return res.status(403).json({
                    success: false,
                    error: 'PrivateProfile',
                    message: error.message
                });
            }

            res.status(500).json({
                success: false,
                error: 'RetrievalFailed',
                message: 'Failed to get profile',
                details: error.message
            });
        }
    }

    // Get current user's profile
    async getMyProfile(req, res) {
        try {
            const userId = req.user.id;

            const profile = await profileService.getProfileByUserId(userId, userId);

            res.json({
                success: true,
                data: profile
            });

        } catch (error) {
            logger.error('Failed to get user profile via API', {
                error: error.message,
                userId: req.user?.id
            });

            if (error.message === 'Profile not found') {
                return res.status(404).json({
                    success: false,
                    error: 'ProfileNotFound',
                    message: 'Profile not found. Create a profile first.'
                });
            }

            res.status(500).json({
                success: false,
                error: 'RetrievalFailed',
                message: 'Failed to get profile',
                details: error.message
            });
        }
    }

    // Update profile
    async updateProfile(req, res) {
        try {
            const { profileId } = req.params;
            const userId = req.user.id;
            const updateData = req.body;

            // Validate input data
            const validation = validationService.validateCompleteProfileData(updateData, true);
            if (!validation.isValid) {
                return res.status(400).json({
                    success: false,
                    error: 'ValidationError',
                    message: 'Invalid profile data',
                    details: validation.errors
                });
            }

            const profile = await profileService.updateProfile(profileId, userId, updateData);

            logger.info('Profile updated via API', {
                profileId,
                userId
            });

            res.json({
                success: true,
                data: profile
            });

        } catch (error) {
            logger.error('Failed to update profile via API', {
                error: error.message,
                profileId: req.params.profileId,
                userId: req.user?.id,
                body: req.body
            });

            if (error.message === 'Profile not found' || error.message === 'Unauthorized to update this profile') {
                return res.status(404).json({
                    success: false,
                    error: 'NotFound',
                    message: error.message
                });
            }

            res.status(500).json({
                success: false,
                error: 'UpdateFailed',
                message: 'Failed to update profile',
                details: error.message
            });
        }
    }

    // Delete profile
    async deleteProfile(req, res) {
        try {
            const { profileId } = req.params;
            const userId = req.user.id;

            const result = await profileService.deleteProfile(profileId, userId);

            logger.info('Profile deleted via API', {
                profileId,
                userId
            });

            res.json({
                success: true,
                data: result
            });

        } catch (error) {
            logger.error('Failed to delete profile via API', {
                error: error.message,
                profileId: req.params.profileId,
                userId: req.user?.id
            });

            if (error.message === 'Profile not found' || error.message === 'Unauthorized to delete this profile') {
                return res.status(404).json({
                    success: false,
                    error: 'NotFound',
                    message: error.message
                });
            }

            res.status(500).json({
                success: false,
                error: 'DeletionFailed',
                message: 'Failed to delete profile',
                details: error.message
            });
        }
    }

    // Search profiles
    async searchProfiles(req, res) {
        try {
            const { q: searchTerm } = req.query;
            const limit = parseInt(req.query.limit) || 20;
            const offset = parseInt(req.query.offset) || 0;

            // Validate search query
            const queryValidation = validationService.validateSearchQuery(searchTerm);
            if (!queryValidation.isValid) {
                return res.status(400).json({
                    success: false,
                    error: 'InvalidQuery',
                    message: 'Invalid search query',
                    details: queryValidation.errors
                });
            }

            // Validate pagination parameters
            const paginationValidation = validationService.validatePaginationParams(limit, offset);
            if (!paginationValidation.isValid) {
                return res.status(400).json({
                    success: false,
                    error: 'InvalidPagination',
                    message: 'Invalid pagination parameters',
                    details: paginationValidation.errors
                });
            }

            const sanitizedQuery = validationService.sanitizeSearchQuery(searchTerm);
            const profiles = await profileService.searchProfiles(sanitizedQuery, limit, offset, req.user?.id);

            res.json({
                success: true,
                data: {
                    profiles,
                    pagination: {
                        limit,
                        offset,
                        count: profiles.length
                    }
                }
            });

        } catch (error) {
            logger.error('Failed to search profiles via API', {
                error: error.message,
                query: req.query,
                userId: req.user?.id
            });

            res.status(500).json({
                success: false,
                error: 'SearchFailed',
                message: 'Failed to search profiles',
                details: error.message
            });
        }
    }

    // Get profile statistics
    async getProfileStatistics(req, res) {
        try {
            const { profileId } = req.params;
            const userId = req.user.id;

            const statistics = await profileService.getProfileStatistics(profileId, userId);

            res.json({
                success: true,
                data: statistics
            });

        } catch (error) {
            logger.error('Failed to get profile statistics via API', {
                error: error.message,
                profileId: req.params.profileId,
                userId: req.user?.id
            });

            if (error.message === 'Profile not found' || error.message === 'Unauthorized to view statistics for this profile') {
                return res.status(404).json({
                    success: false,
                    error: 'NotFound',
                    message: error.message
                });
            }

            res.status(500).json({
                success: false,
                error: 'StatisticsFailed',
                message: 'Failed to get profile statistics',
                details: error.message
            });
        }
    }

    // Add social link
    async addSocialLink(req, res) {
        try {
            const { profileId } = req.params;
            const userId = req.user.id;
            const linkData = req.body;

            // Validate social link data
            const validation = validationService.validateSocialLink(linkData);
            if (!validation.isValid) {
                return res.status(400).json({
                    success: false,
                    error: 'ValidationError',
                    message: 'Invalid social link data',
                    details: validation.errors
                });
            }

            const socialLink = await profileService.addSocialLink(profileId, userId, linkData);

            res.status(201).json({
                success: true,
                data: socialLink
            });

        } catch (error) {
            logger.error('Failed to add social link via API', {
                error: error.message,
                profileId: req.params.profileId,
                userId: req.user?.id,
                body: req.body
            });

            if (error.message === 'Profile not found' || error.message === 'Unauthorized to modify this profile') {
                return res.status(404).json({
                    success: false,
                    error: 'NotFound',
                    message: error.message
                });
            }

            res.status(500).json({
                success: false,
                error: 'AddLinkFailed',
                message: 'Failed to add social link',
                details: error.message
            });
        }
    }

    // Remove social link
    async removeSocialLink(req, res) {
        try {
            const { profileId, linkId } = req.params;
            const userId = req.user.id;

            const result = await profileService.removeSocialLink(profileId, userId, linkId);

            res.json({
                success: true,
                data: result
            });

        } catch (error) {
            logger.error('Failed to remove social link via API', {
                error: error.message,
                profileId: req.params.profileId,
                linkId: req.params.linkId,
                userId: req.user?.id
            });

            if (error.message === 'Profile not found' ||
                error.message === 'Unauthorized to modify this profile' ||
                error.message === 'Social link not found') {
                return res.status(404).json({
                    success: false,
                    error: 'NotFound',
                    message: error.message
                });
            }

            res.status(500).json({
                success: false,
                error: 'RemoveLinkFailed',
                message: 'Failed to remove social link',
                details: error.message
            });
        }
    }

    // Update avatar
    async updateAvatar(req, res) {
        try {
            const { profileId } = req.params;
            const userId = req.user.id;
            const { url } = req.body;

            if (!url) {
                return res.status(400).json({
                    success: false,
                    error: 'MissingAvatarUrl',
                    message: 'Avatar URL is required'
                });
            }

            const profile = await profileService.updateAvatar(profileId, userId, { url });

            logger.info('Avatar updated via API', {
                profileId,
                userId
            });

            res.json({
                success: true,
                data: profile
            });

        } catch (error) {
            logger.error('Failed to update avatar via API', {
                error: error.message,
                profileId: req.params.profileId,
                userId: req.user?.id,
                body: req.body
            });

            if (error.message === 'Profile not found' || error.message === 'Unauthorized to update this profile') {
                return res.status(404).json({
                    success: false,
                    error: 'NotFound',
                    message: error.message
                });
            }

            res.status(500).json({
                success: false,
                error: 'AvatarUpdateFailed',
                message: 'Failed to update avatar',
                details: error.message
            });
        }
    }

    // Health check for profile service
    async healthCheck(req, res) {
        try {
            // Check if service is responding
            const status = {
                status: 'healthy',
                timestamp: new Date().toISOString(),
                service: 'profile-service',
                version: '1.0.0'
            };

            res.json({
                success: true,
                data: status
            });

        } catch (error) {
            logger.error('Profile service health check failed', {
                error: error.message
            });

            res.status(503).json({
                success: false,
                error: 'ServiceUnavailable',
                message: 'Profile service is unavailable'
            });
        }
    }
}

module.exports = new ProfileController();