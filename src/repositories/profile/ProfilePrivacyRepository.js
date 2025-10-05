const { pool } = require('../../shared/config/database');
const ProfilePrivacySettings = require('../../models/profile/ProfilePrivacySettings');
const logger = require('../../shared/utils/logger');

class ProfilePrivacyRepository {
    // Create privacy settings
    async create(privacyData) {
        try {
            const privacy = new ProfilePrivacySettings(privacyData);
            const validation = privacy.validate();

            if (!validation.isValid) {
                throw new Error(`Validation failed: ${validation.errors.join(', ')}`);
            }

            const query = `
                INSERT INTO profile_privacy_settings (
                    id, profile_id, email_visible, bio_visible,
                    avatar_visible, social_links_visible, profile_searchable,
                    created_at, updated_at
                ) VALUES (
                    $1, $2, $3, $4, $5, $6, $7, $8, $9
                ) RETURNING *
            `;

            const values = [
                privacy.id,
                privacy.profileId,
                privacy.emailVisible,
                privacy.bioVisible,
                privacy.avatarVisible,
                privacy.socialLinksVisible,
                privacy.profileSearchable,
                privacy.createdAt,
                privacy.updatedAt
            ];

            const result = await pool.query(query, values);
            return ProfilePrivacySettings.fromDbRow(result.rows[0]);

        } catch (error) {
            logger.error('Failed to create privacy settings', {
                error: error.message,
                profileId: privacyData.profileId
            });
            throw error;
        }
    }

    // Find privacy settings by profile ID
    async findByProfileId(profileId) {
        try {
            const query = `
                SELECT * FROM profile_privacy_settings
                WHERE profile_id = $1
            `;

            const result = await pool.query(query, [profileId]);

            if (result.rows.length === 0) {
                return null;
            }

            return ProfilePrivacySettings.fromDbRow(result.rows[0]);

        } catch (error) {
            logger.error('Failed to find privacy settings by profile ID', {
                error: error.message,
                profileId
            });
            throw error;
        }
    }

    // Update privacy settings
    async update(id, updateData) {
        try {
            const privacy = new ProfilePrivacySettings({ ...updateData, id });
            const validation = privacy.validate();

            if (!validation.isValid) {
                throw new Error(`Validation failed: ${validation.errors.join(', ')}`);
            }

            const query = `
                UPDATE profile_privacy_settings
                SET email_visible = $2, bio_visible = $3,
                    avatar_visible = $4, social_links_visible = $5,
                    profile_searchable = $6, updated_at = $7
                WHERE id = $1
                RETURNING *
            `;

            const values = [
                privacy.id,
                privacy.emailVisible,
                privacy.bioVisible,
                privacy.avatarVisible,
                privacy.socialLinksVisible,
                privacy.profileSearchable,
                privacy.updatedAt
            ];

            const result = await pool.query(query, values);

            if (result.rows.length === 0) {
                throw new Error('Privacy settings not found');
            }

            return ProfilePrivacySettings.fromDbRow(result.rows[0]);

        } catch (error) {
            logger.error('Failed to update privacy settings', {
                error: error.message,
                privacyId: id
            });
            throw error;
        }
    }

    // Update privacy settings by profile ID
    async updateByProfileId(profileId, updateData) {
        try {
            const existing = await this.findByProfileId(profileId);

            if (!existing) {
                return await this.create({ profileId, ...updateData });
            }

            return await this.update(existing.id, updateData);

        } catch (error) {
            logger.error('Failed to update privacy settings by profile ID', {
                error: error.message,
                profileId
            });
            throw error;
        }
    }

    // Delete privacy settings
    async delete(id) {
        try {
            const query = `
                DELETE FROM profile_privacy_settings
                WHERE id = $1
                RETURNING *
            `;

            const result = await pool.query(query, [id]);

            if (result.rows.length === 0) {
                throw new Error('Privacy settings not found');
            }

            return ProfilePrivacySettings.fromDbRow(result.rows[0]);

        } catch (error) {
            logger.error('Failed to delete privacy settings', {
                error: error.message,
                privacyId: id
            });
            throw error;
        }
    }

    // Get default privacy settings
    async getDefaultSettings() {
        return new ProfilePrivacySettings({
            emailVisible: false,
            bioVisible: true,
            avatarVisible: true,
            socialLinksVisible: true,
            profileSearchable: true
        });
    }

    // Check if profile is searchable
    async isProfileSearchable(profileId) {
        try {
            const privacy = await this.findByProfileId(profileId);
            return privacy ? privacy.profileSearchable : true; // Default to searchable

        } catch (error) {
            logger.error('Failed to check if profile is searchable', {
                error: error.message,
                profileId
            });
            return true; // Default to searchable on error
        }
    }

    // Get public profile data based on privacy settings
    async getPublicProfileData(profileId, requestingUserId = null) {
        try {
            const profileQuery = `
                SELECT p.*, u.email FROM user_profiles p
                JOIN users u ON p.user_id = u.id
                WHERE p.id = $1 AND p.deleted_at IS NULL
            `;

            const privacyQuery = `
                SELECT * FROM profile_privacy_settings
                WHERE profile_id = $1
            `;

            const [profileResult, privacyResult] = await Promise.all([
                pool.query(profileQuery, [profileId]),
                pool.query(privacyQuery, [profileId])
            ]);

            if (profileResult.rows.length === 0) {
                return null;
            }

            const profile = profileResult.rows[0];
            const privacy = privacyResult.rows[0] || {};

            const isOwner = profile.user_id === requestingUserId;

            // Apply privacy settings
            const publicData = {
                id: profile.id,
                displayName: profile.display_name,
                isPublic: profile.is_public,
                profileCompletion: profile.profile_completion,
                createdAt: profile.created_at
            };

            // Add bio if visible or owner
            if (isOwner || privacy.bio_visible !== false) {
                publicData.bio = profile.bio;
            }

            // Add avatar if visible or owner
            if (isOwner || privacy.avatar_visible !== false) {
                publicData.avatarUrl = profile.avatar_url;
            }

            // Add email if visible or owner
            if (isOwner || privacy.email_visible === true) {
                publicData.email = profile.email;
            }

            return publicData;

        } catch (error) {
            logger.error('Failed to get public profile data', {
                error: error.message,
                profileId,
                requestingUserId
            });
            throw error;
        }
    }
}

module.exports = new ProfilePrivacyRepository();