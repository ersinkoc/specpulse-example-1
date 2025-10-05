const { pool } = require('../../shared/config/database');
const Profile = require('../../models/profile/Profile');
const ProfilePrivacySettings = require('../../models/profile/ProfilePrivacySettings');
const ProfileSocialLink = require('../../models/profile/ProfileSocialLink');
const logger = require('../../shared/utils/logger');

class ProfileRepository {
    // Create a new profile
    async create(profileData) {
        try {
            const profile = new Profile(profileData);
            const validation = profile.validate();

            if (!validation.isValid) {
                throw new Error(`Validation failed: ${validation.errors.join(', ')}`);
            }

            const query = `
                INSERT INTO user_profiles (
                    id, user_id, display_name, bio, avatar_url,
                    profile_completion, is_active, is_public,
                    created_at, updated_at
                ) VALUES (
                    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10
                ) RETURNING *
            `;

            const values = [
                profile.id,
                profile.userId,
                profile.displayName,
                profile.bio,
                profile.avatarUrl,
                profile.profileCompletion,
                profile.isActive,
                profile.isPublic,
                profile.createdAt,
                profile.updatedAt
            ];

            const result = await pool.query(query, values);
            return Profile.fromDbRow(result.rows[0]);

        } catch (error) {
            logger.error('Failed to create profile', {
                error: error.message,
                userId: profileData.userId
            });
            throw error;
        }
    }

    // Find profile by user ID
    async findByUserId(userId) {
        try {
            const query = `
                SELECT * FROM user_profiles
                WHERE user_id = $1 AND deleted_at IS NULL
            `;

            const result = await pool.query(query, [userId]);

            if (result.rows.length === 0) {
                return null;
            }

            return Profile.fromDbRow(result.rows[0]);

        } catch (error) {
            logger.error('Failed to find profile by user ID', {
                error: error.message,
                userId
            });
            throw error;
        }
    }

    // Find profile by ID
    async findById(id) {
        try {
            const query = `
                SELECT * FROM user_profiles
                WHERE id = $1 AND deleted_at IS NULL
            `;

            const result = await pool.query(query, [id]);

            if (result.rows.length === 0) {
                return null;
            }

            return Profile.fromDbRow(result.rows[0]);

        } catch (error) {
            logger.error('Failed to find profile by ID', {
                error: error.message,
                profileId: id
            });
            throw error;
        }
    }

    // Update profile
    async update(id, updateData) {
        try {
            const profile = new Profile({ ...updateData, id });
            const validation = profile.validate();

            if (!validation.isValid) {
                throw new Error(`Validation failed: ${validation.errors.join(', ')}`);
            }

            const query = `
                UPDATE user_profiles
                SET display_name = $2, bio = $3, avatar_url = $4,
                    profile_completion = $5, is_active = $6,
                    is_public = $7, updated_at = $8
                WHERE id = $1 AND deleted_at IS NULL
                RETURNING *
            `;

            const values = [
                profile.id,
                profile.displayName,
                profile.bio,
                profile.avatarUrl,
                profile.profileCompletion,
                profile.isActive,
                profile.isPublic,
                profile.updatedAt
            ];

            const result = await pool.query(query, values);

            if (result.rows.length === 0) {
                throw new Error('Profile not found or has been deleted');
            }

            return Profile.fromDbRow(result.rows[0]);

        } catch (error) {
            logger.error('Failed to update profile', {
                error: error.message,
                profileId: id
            });
            throw error;
        }
    }

    // Soft delete profile
    async softDelete(id) {
        try {
            const query = `
                UPDATE user_profiles
                SET deleted_at = CURRENT_TIMESTAMP, is_active = false, is_public = false
                WHERE id = $1 AND deleted_at IS NULL
                RETURNING *
            `;

            const result = await pool.query(query, [id]);

            if (result.rows.length === 0) {
                throw new Error('Profile not found or already deleted');
            }

            return Profile.fromDbRow(result.rows[0]);

        } catch (error) {
            logger.error('Failed to soft delete profile', {
                error: error.message,
                profileId: id
            });
            throw error;
        }
    }

    // Restore deleted profile
    async restore(id) {
        try {
            const query = `
                UPDATE user_profiles
                SET deleted_at = NULL, is_active = true
                WHERE id = $1 AND deleted_at IS NOT NULL
                RETURNING *
            `;

            const result = await pool.query(query, [id]);

            if (result.rows.length === 0) {
                throw new Error('Profile not found or not deleted');
            }

            return Profile.fromDbRow(result.rows[0]);

        } catch (error) {
            logger.error('Failed to restore profile', {
                error: error.message,
                profileId: id
            });
            throw error;
        }
    }

    // Search profiles (with privacy controls)
    async search(searchTerm, limit = 20, offset = 0) {
        try {
            const query = `
                SELECT p.* FROM user_profiles p
                WHERE p.is_public = true
                  AND p.is_active = true
                  AND p.deleted_at IS NULL
                  AND (
                    ILIKE(p.display_name, $1) OR
                    ILIKE(p.bio, $1)
                  )
                ORDER BY p.display_name
                LIMIT $2 OFFSET $3
            `;

            const result = await pool.query(query, [`%${searchTerm}%`, limit, offset]);

            return result.rows.map(row => Profile.fromDbRow(row));

        } catch (error) {
            logger.error('Failed to search profiles', {
                error: error.message,
                searchTerm,
                limit,
                offset
            });
            throw error;
        }
    }

    // Get profile with privacy settings and social links
    async getProfileWithDetails(id) {
        try {
            const profileQuery = `
                SELECT p.* FROM user_profiles p
                WHERE p.id = $1 AND p.deleted_at IS NULL
            `;

            const privacyQuery = `
                SELECT pps.* FROM profile_privacy_settings pps
                WHERE pps.profile_id = $1
            `;

            const socialLinksQuery = `
                SELECT psl.* FROM profile_social_links psl
                WHERE psl.profile_id = $1
                ORDER BY psl.platform
            `;

            const [profileResult, privacyResult, socialLinksResult] = await Promise.all([
                pool.query(profileQuery, [id]),
                pool.query(privacyQuery, [id]),
                pool.query(socialLinksQuery, [id])
            ]);

            if (profileResult.rows.length === 0) {
                return null;
            }

            const profile = Profile.fromDbRow(profileResult.rows[0]);
            const privacySettings = privacyResult.rows.length > 0
                ? ProfilePrivacySettings.fromDbRow(privacyResult.rows[0])
                : null;
            const socialLinks = socialLinksResult.rows.map(row =>
                ProfileSocialLink.fromDbRow(row)
            );

            return {
                profile,
                privacySettings,
                socialLinks
            };

        } catch (error) {
            logger.error('Failed to get profile with details', {
                error: error.message,
                profileId: id
            });
            throw error;
        }
    }

    // Count total profiles
    async count() {
        try {
            const query = `
                SELECT COUNT(*) FROM user_profiles
                WHERE is_active = true AND deleted_at IS NULL
            `;

            const result = await pool.query(query);
            return parseInt(result.rows[0].count);

        } catch (error) {
            logger.error('Failed to count profiles', {
                error: error.message
            });
            throw error;
        }
    }

    // Get profiles by completion percentage
    async getByCompletionRange(minCompletion, maxCompletion, limit = 20) {
        try {
            const query = `
                SELECT * FROM user_profiles
                WHERE profile_completion >= $1
                  AND profile_completion <= $2
                  AND is_active = true
                  AND deleted_at IS NULL
                ORDER BY profile_completion DESC
                LIMIT $3
            `;

            const result = await pool.query(query, [minCompletion, maxCompletion, limit]);

            return result.rows.map(row => Profile.fromDbRow(row));

        } catch (error) {
            logger.error('Failed to get profiles by completion range', {
                error: error.message,
                minCompletion,
                maxCompletion
            });
            throw error;
        }
    }
}

module.exports = new ProfileRepository();