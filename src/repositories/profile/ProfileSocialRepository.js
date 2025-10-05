const { pool } = require('../../shared/config/database');
const ProfileSocialLink = require('../../models/profile/ProfileSocialLink');
const logger = require('../../shared/utils/logger');

class ProfileSocialRepository {
    // Create a social link
    async create(linkData) {
        try {
            const socialLink = new ProfileSocialLink(linkData);
            const validation = socialLink.validate();

            if (!validation.isValid) {
                throw new Error(`Validation failed: ${validation.errors.join(', ')}`);
            }

            const query = `
                INSERT INTO profile_social_links (
                    id, profile_id, platform, url, is_verified,
                    created_at, updated_at
                ) VALUES (
                    $1, $2, $3, $4, $5, $6, $7
                ) RETURNING *
            `;

            const values = [
                socialLink.id,
                socialLink.profileId,
                socialLink.platform.toLowerCase(),
                socialLink.url,
                socialLink.isVerified,
                socialLink.createdAt,
                socialLink.updatedAt
            ];

            const result = await pool.query(query, values);
            return ProfileSocialLink.fromDbRow(result.rows[0]);

        } catch (error) {
            logger.error('Failed to create social link', {
                error: error.message,
                profileId: linkData.profileId,
                platform: linkData.platform
            });
            throw error;
        }
    }

    // Find social links by profile ID
    async findByProfileId(profileId) {
        try {
            const query = `
                SELECT * FROM profile_social_links
                WHERE profile_id = $1
                ORDER BY platform
            `;

            const result = await pool.query(query, [profileId]);

            return result.rows.map(row => ProfileSocialLink.fromDbRow(row));

        } catch (error) {
            logger.error('Failed to find social links by profile ID', {
                error: error.message,
                profileId
            });
            throw error;
        }
    }

    // Find social link by ID
    async findById(id) {
        try {
            const query = `
                SELECT * FROM profile_social_links
                WHERE id = $1
            `;

            const result = await pool.query(query, [id]);

            if (result.rows.length === 0) {
                return null;
            }

            return ProfileSocialLink.fromDbRow(result.rows[0]);

        } catch (error) {
            logger.error('Failed to find social link by ID', {
                error: error.message,
                linkId: id
            });
            throw error;
        }
    }

    // Update social link
    async update(id, updateData) {
        try {
            const socialLink = new ProfileSocialLink({ ...updateData, id });
            const validation = socialLink.validate();

            if (!validation.isValid) {
                throw new Error(`Validation failed: ${validation.errors.join(', ')}`);
            }

            const query = `
                UPDATE profile_social_links
                SET platform = $2, url = $3, is_verified = $4, updated_at = $5
                WHERE id = $1
                RETURNING *
            `;

            const values = [
                socialLink.id,
                socialLink.platform.toLowerCase(),
                socialLink.url,
                socialLink.isVerified,
                socialLink.updatedAt
            ];

            const result = await pool.query(query, values);

            if (result.rows.length === 0) {
                throw new Error('Social link not found');
            }

            return ProfileSocialLink.fromDbRow(result.rows[0]);

        } catch (error) {
            logger.error('Failed to update social link', {
                error: error.message,
                linkId: id
            });
            throw error;
        }
    }

    // Delete social link
    async delete(id) {
        try {
            const query = `
                DELETE FROM profile_social_links
                WHERE id = $1
                RETURNING *
            `;

            const result = await pool.query(query, [id]);

            if (result.rows.length === 0) {
                throw new Error('Social link not found');
            }

            return ProfileSocialLink.fromDbRow(result.rows[0]);

        } catch (error) {
            logger.error('Failed to delete social link', {
                error: error.message,
                linkId: id
            });
            throw error;
        }
    }

    // Add or update social link (upsert)
    async upsert(linkData) {
        try {
            const existing = await this.findByProfileIdAndPlatform(
                linkData.profileId,
                linkData.platform
            );

            if (existing) {
                return await this.update(existing.id, {
                    url: linkData.url,
                    isVerified: false // Reset verification on URL change
                });
            } else {
                return await this.create(linkData);
            }

        } catch (error) {
            logger.error('Failed to upsert social link', {
                error: error.message,
                profileId: linkData.profileId,
                platform: linkData.platform
            });
            throw error;
        }
    }

    // Find social link by profile ID and platform
    async findByProfileIdAndPlatform(profileId, platform) {
        try {
            const query = `
                SELECT * FROM profile_social_links
                WHERE profile_id = $1 AND platform = $2
            `;

            const result = await pool.query(query, [profileId, platform.toLowerCase()]);

            if (result.rows.length === 0) {
                return null;
            }

            return ProfileSocialLink.fromDbRow(result.rows[0]);

        } catch (error) {
            logger.error('Failed to find social link by profile ID and platform', {
                error: error.message,
                profileId,
                platform
            });
            throw error;
        }
    }

    // Get all platforms used by a profile
    async getPlatformsByProfileId(profileId) {
        try {
            const query = `
                SELECT DISTINCT platform FROM profile_social_links
                WHERE profile_id = $1
                ORDER BY platform
            `;

            const result = await pool.query(query, [profileId]);
            return result.rows.map(row => row.platform);

        } catch (error) {
            logger.error('Failed to get platforms by profile ID', {
                error: error.message,
                profileId
            });
            throw error;
        }
    }

    // Verify social link
    async verifyLink(id) {
        try {
            const query = `
                UPDATE profile_social_links
                SET is_verified = true, updated_at = CURRENT_TIMESTAMP
                WHERE id = $1
                RETURNING *
            `;

            const result = await pool.query(query, [id]);

            if (result.rows.length === 0) {
                throw new Error('Social link not found');
            }

            return ProfileSocialLink.fromDbRow(result.rows[0]);

        } catch (error) {
            logger.error('Failed to verify social link', {
                error: error.message,
                linkId: id
            });
            throw error;
        }
    }

    // Get verified social links for a profile
    async getVerifiedByProfileId(profileId) {
        try {
            const query = `
                SELECT * FROM profile_social_links
                WHERE profile_id = $1 AND is_verified = true
                ORDER BY platform
            `;

            const result = await pool.query(query, [profileId]);

            return result.rows.map(row => ProfileSocialLink.fromDbRow(row));

        } catch (error) {
            logger.error('Failed to get verified social links by profile ID', {
                error: error.message,
                profileId
            });
            throw error;
        }
    }

    // Batch update social links for a profile
    async updateBatch(profileId, links) {
        try {
            const client = await pool.connect();

            try {
                await client.query('BEGIN');

                // Delete existing links
                await client.query(
                    'DELETE FROM profile_social_links WHERE profile_id = $1',
                    [profileId]
                );

                // Insert new links
                const insertedLinks = [];
                for (const linkData of links) {
                    const socialLink = new ProfileSocialLink({
                        ...linkData,
                        profileId
                    });

                    const validation = socialLink.validate();
                    if (!validation.isValid) {
                        throw new Error(`Validation failed for ${linkData.platform}: ${validation.errors.join(', ')}`);
                    }

                    const query = `
                        INSERT INTO profile_social_links (
                            id, profile_id, platform, url, is_verified,
                            created_at, updated_at
                        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
                        RETURNING *
                    `;

                    const values = [
                        socialLink.id,
                        socialLink.profileId,
                        socialLink.platform.toLowerCase(),
                        socialLink.url,
                        socialLink.isVerified,
                        socialLink.createdAt,
                        socialLink.updatedAt
                    ];

                    const result = await client.query(query, values);
                    insertedLinks.push(ProfileSocialLink.fromDbRow(result.rows[0]));
                }

                await client.query('COMMIT');
                return insertedLinks;

            } catch (error) {
                await client.query('ROLLBACK');
                throw error;

            } finally {
                client.release();
            }

        } catch (error) {
            logger.error('Failed to batch update social links', {
                error: error.message,
                profileId,
                linkCount: links.length
            });
            throw error;
        }
    }
}

module.exports = new ProfileSocialRepository();