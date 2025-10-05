const logger = require('../../shared/utils/logger');
const ProfileSocialLink = require('../../models/profile/ProfileSocialLink');

class ProfileValidationService {
    // Validate profile data
    validateProfileData(data, isUpdate = false) {
        const errors = [];

        // Display name validation
        if (!isUpdate || data.displayName !== undefined) {
            if (!data.displayName || data.displayName.trim().length === 0) {
                errors.push('Display name is required');
            } else if (data.displayName.length > 100) {
                errors.push('Display name must be less than 100 characters');
            } else if (data.displayName.trim().length < 2) {
                errors.push('Display name must be at least 2 characters');
            }
        }

        // Bio validation
        if (data.bio !== undefined) {
            if (data.bio && data.bio.length > 1000) {
                errors.push('Bio must be less than 1000 characters');
            }
        }

        // Avatar URL validation
        if (data.avatarUrl !== undefined) {
            if (data.avatarUrl && data.avatarUrl.trim().length > 500) {
                errors.push('Avatar URL must be less than 500 characters');
            }

            // Validate URL format if provided
            if (data.avatarUrl && data.avatarUrl.trim().length > 0) {
                try {
                    new URL(data.avatarUrl);
                } catch {
                    errors.push('Avatar URL must be a valid URL');
                }
            }
        }

        // Profile visibility validation
        if (data.isPublic !== undefined && typeof data.isPublic !== 'boolean') {
            errors.push('Profile visibility must be a boolean');
        }

        // Profile completion validation
        if (data.profileCompletion !== undefined) {
            if (typeof data.profileCompletion !== 'number') {
                errors.push('Profile completion must be a number');
            } else if (data.profileCompletion < 0 || data.profileCompletion > 100) {
                errors.push('Profile completion must be between 0 and 100');
            }
        }

        return {
            isValid: errors.length === 0,
            errors
        };
    }

    // Validate privacy settings
    validatePrivacySettings(data) {
        const errors = [];

        const booleanFields = [
            'emailVisible',
            'bioVisible',
            'avatarVisible',
            'socialLinksVisible',
            'profileSearchable'
        ];

        for (const field of booleanFields) {
            if (data[field] !== undefined && typeof data[field] !== 'boolean') {
                errors.push(`${field} must be a boolean`);
            }
        }

        return {
            isValid: errors.length === 0,
            errors
        };
    }

    // Validate social link
    validateSocialLink(data) {
        const socialLink = new ProfileSocialLink(data);
        return socialLink.validate();
    }

    // Validate array of social links
    validateSocialLinks(socialLinks) {
        const errors = [];

        if (!Array.isArray(socialLinks)) {
            errors.push('Social links must be an array');
            return {
                isValid: false,
                errors
            };
        }

        if (socialLinks.length > 10) {
            errors.push('Maximum 10 social links allowed');
        }

        const platforms = new Set();

        for (let i = 0; i < socialLinks.length; i++) {
            const link = socialLinks[i];

            // Check for duplicate platforms
            if (link.platform) {
                const normalizedPlatform = link.platform.toLowerCase();
                if (platforms.has(normalizedPlatform)) {
                    errors.push(`Duplicate platform: ${link.platform}`);
                }
                platforms.add(normalizedPlatform);
            }

            // Validate each link
            const validation = this.validateSocialLink(link);
            if (!validation.isValid) {
                errors.push(`Social link ${i + 1}: ${validation.errors.join(', ')}`);
            }
        }

        return {
            isValid: errors.length === 0,
            errors
        };
    }

    // Validate search query
    validateSearchQuery(query) {
        const errors = [];

        if (!query || query.trim().length === 0) {
            errors.push('Search query is required');
        } else if (query.length > 100) {
            errors.push('Search query must be less than 100 characters');
        }

        // Check for potentially dangerous content
        const dangerousPatterns = [
            /drop\s+table/i,
            /delete\s+from/i,
            /insert\s+into/i,
            /update\s+set/i,
            /union\s+select/i,
            /script/i,
            /javascript:/i,
            /<[^>]*>/g
        ];

        for (const pattern of dangerousPatterns) {
            if (pattern.test(query)) {
                errors.push('Search query contains invalid characters');
                break;
            }
        }

        return {
            isValid: errors.length === 0,
            errors
        };
    }

    // Validate pagination parameters
    validatePaginationParams(limit, offset) {
        const errors = [];

        if (limit !== undefined) {
            if (typeof limit !== 'number' || limit < 1 || limit > 100) {
                errors.push('Limit must be a number between 1 and 100');
            }
        }

        if (offset !== undefined) {
            if (typeof offset !== 'number' || offset < 0) {
                errors.push('Offset must be a non-negative number');
            }
        }

        return {
            isValid: errors.length === 0,
            errors
        };
    }

    // Sanitize search query
    sanitizeSearchQuery(query) {
        if (!query) return '';

        // Remove potentially dangerous characters
        return query
            .trim()
            .replace(/[<>'"]/g, '')
            .replace(/--/g, '')
            .replace(/\/\*/g, '')
            .replace(/\*\//g, '');
    }

    // Validate profile update permissions
    validateUpdatePermissions(profile, requestingUserId) {
        const errors = [];

        if (!profile) {
            errors.push('Profile not found');
            return {
                isValid: false,
                errors
            };
        }

        if (profile.userId !== requestingUserId) {
            errors.push('Unauthorized to update this profile');
        }

        if (profile.deletedAt) {
            errors.push('Cannot update a deleted profile');
        }

        return {
            isValid: errors.length === 0,
            errors
        };
    }

    // Validate profile view permissions
    validateViewPermissions(profile, requestingUserId = null) {
        const errors = [];

        if (!profile) {
            errors.push('Profile not found');
            return {
                isValid: false,
                errors,
                canView: false
            };
        }

        // Owner can always view
        if (profile.userId === requestingUserId) {
            return {
                isValid: true,
                errors: [],
                canView: true
            };
        }

        // Check if profile is deleted
        if (profile.deletedAt) {
            errors.push('Profile has been deleted');
            return {
                isValid: false,
                errors,
                canView: false
            };
        }

        // Check if profile is active
        if (!profile.isActive) {
            errors.push('Profile is not active');
            return {
                isValid: false,
                errors,
                canView: false
            };
        }

        // Check if profile is public
        if (!profile.isPublic) {
            errors.push('Profile is private');
            return {
                isValid: false,
                errors,
                canView: false
            };
        }

        return {
            isValid: true,
            errors: [],
            canView: true
        };
    }

    // Validate file upload
    validateFileUpload(file) {
        const errors = [];

        if (!file) {
            errors.push('No file provided');
            return {
                isValid: false,
                errors
            };
        }

        // File size validation (4MB limit)
        const maxSize = 4 * 1024 * 1024;
        if (file.size > maxSize) {
            errors.push(`File size exceeds 4MB limit (${Math.round(file.size / 1024 / 1024)}MB)`);
        }

        // MIME type validation
        const allowedMimeTypes = [
            'image/jpeg',
            'image/jpg',
            'image/png',
            'image/webp'
        ];

        if (!allowedMimeTypes.includes(file.mimetype)) {
            errors.push(`File type ${file.mimetype} is not allowed. Allowed types: ${allowedMimeTypes.join(', ')}`);
        }

        // Filename validation
        if (!file.originalname || file.originalname.trim().length === 0) {
            errors.push('Filename is required');
        }

        if (file.originalname.length > 255) {
            errors.push('Filename must be less than 255 characters');
        }

        return {
            isValid: errors.length === 0,
            errors
        };
    }

    // Comprehensive validation for profile creation/update
    validateCompleteProfileData(data, isUpdate = false) {
        const errors = [];

        // Validate main profile data
        const profileValidation = this.validateProfileData(data, isUpdate);
        if (!profileValidation.isValid) {
            errors.push(...profileValidation.errors);
        }

        // Validate privacy settings if provided
        if (data.privacySettings) {
            const privacyValidation = this.validatePrivacySettings(data.privacySettings);
            if (!privacyValidation.isValid) {
                errors.push(...privacyValidation.errors);
            }
        }

        // Validate social links if provided
        if (data.socialLinks) {
            const socialValidation = this.validateSocialLinks(data.socialLinks);
            if (!socialValidation.isValid) {
                errors.push(...socialValidation.errors);
            }
        }

        return {
            isValid: errors.length === 0,
            errors
        };
    }
}

module.exports = new ProfileValidationService();