const profileRepository = require('../../repositories/profile/ProfileRepository');
const privacyRepository = require('../../repositories/profile/ProfilePrivacyRepository');
const socialRepository = require('../../repositories/profile/ProfileSocialRepository');
const fileUploadService = require('../upload/FileUploadService');
const cloudStorageService = require('../upload/CloudStorageService');
const logger = require('../../shared/utils/logger');

class ProfileService {
    // Create a new profile for a user
    async createProfile(userId, profileData) {
        try {
            // Check if profile already exists
            const existingProfile = await profileRepository.findByUserId(userId);
            if (existingProfile) {
                throw new Error('Profile already exists for this user');
            }

            // Create profile
            const profile = await profileRepository.create({
                userId,
                displayName: profileData.displayName,
                bio: profileData.bio || null,
                avatarUrl: profileData.avatarUrl || null,
                isPublic: profileData.isPublic !== undefined ? profileData.isPublic : true
            });

            // Create default privacy settings
            await privacyRepository.create({
                profileId: profile.id,
                ...profileData.privacySettings
            });

            // Add social links if provided
            if (profileData.socialLinks && profileData.socialLinks.length > 0) {
                for (const link of profileData.socialLinks) {
                    await socialRepository.create({
                        profileId: profile.id,
                        platform: link.platform,
                        url: link.url
                    });
                }
            }

            logger.info('Profile created successfully', {
                profileId: profile.id,
                userId
            });

            return await this.getProfileById(profile.id, userId);

        } catch (error) {
            logger.error('Failed to create profile', {
                error: error.message,
                userId,
                profileData
            });
            throw error;
        }
    }

    // Get profile by ID (with privacy controls)
    async getProfileById(profileId, requestingUserId = null) {
        try {
            const profileData = await profileRepository.getProfileWithDetails(profileId);

            if (!profileData) {
                throw new Error('Profile not found');
            }

            const { profile, privacySettings, socialLinks } = profileData;

            // Check if user can view this profile
            const isOwner = profile.userId === requestingUserId;
            const isPublic = profile.isPublic;

            if (!isOwner && !isPublic) {
                throw new Error('Profile is private');
            }

            // Apply privacy settings for non-owners
            let filteredProfile = profile.toJSON();
            let filteredSocialLinks = socialLinks.map(link => link.toJSON());

            if (!isOwner && privacySettings) {
                if (!privacySettings.bioVisible) {
                    delete filteredProfile.bio;
                }

                if (!privacySettings.avatarVisible) {
                    delete filteredProfile.avatarUrl;
                }

                if (!privacySettings.socialLinksVisible) {
                    filteredSocialLinks = [];
                }
            }

            return {
                profile: filteredProfile,
                privacySettings: isOwner ? privacySettings?.toJSON() : null,
                socialLinks: filteredSocialLinks
            };

        } catch (error) {
            logger.error('Failed to get profile by ID', {
                error: error.message,
                profileId,
                requestingUserId
            });
            throw error;
        }
    }

    // Get profile by user ID
    async getProfileByUserId(userId, requestingUserId = null) {
        try {
            const profile = await profileRepository.findByUserId(userId);

            if (!profile) {
                throw new Error('Profile not found');
            }

            return await this.getProfileById(profile.id, requestingUserId);

        } catch (error) {
            logger.error('Failed to get profile by user ID', {
                error: error.message,
                userId,
                requestingUserId
            });
            throw error;
        }
    }

    // Update profile
    async updateProfile(profileId, userId, updateData) {
        try {
            // Verify ownership
            const existingProfile = await profileRepository.findById(profileId);
            if (!existingProfile) {
                throw new Error('Profile not found');
            }

            if (existingProfile.userId !== userId) {
                throw new Error('Unauthorized to update this profile');
            }

            // Update profile
            const updatedProfile = await profileRepository.update(profileId, {
                displayName: updateData.displayName,
                bio: updateData.bio,
                avatarUrl: updateData.avatarUrl,
                isPublic: updateData.isPublic
            });

            // Update privacy settings if provided
            if (updateData.privacySettings) {
                await privacyRepository.updateByProfileId(profileId, updateData.privacySettings);
            }

            // Update social links if provided
            if (updateData.socialLinks) {
                await socialRepository.updateBatch(profileId, updateData.socialLinks);
            }

            // Recalculate completion percentage
            await this.calculateProfileCompletion(profileId);

            logger.info('Profile updated successfully', {
                profileId,
                userId
            });

            return await this.getProfileById(profileId, userId);

        } catch (error) {
            logger.error('Failed to update profile', {
                error: error.message,
                profileId,
                userId,
                updateData
            });
            throw error;
        }
    }

    // Update avatar
    async updateAvatar(profileId, userId, avatarData) {
        try {
            // Verify ownership
            const existingProfile = await profileRepository.findById(profileId);
            if (!existingProfile) {
                throw new Error('Profile not found');
            }

            if (existingProfile.userId !== userId) {
                throw new Error('Unauthorized to update this profile');
            }

            // Update profile with new avatar URL
            const updatedProfile = await profileRepository.update(profileId, {
                avatarUrl: avatarData.url
            });

            // TODO: Clean up old avatar files
            // if (existingProfile.avatarUrl) {
            //     await this.deleteOldAvatar(existingProfile.avatarUrl);
            // }

            // Recalculate completion percentage
            await this.calculateProfileCompletion(profileId);

            logger.info('Avatar updated successfully', {
                profileId,
                userId,
                avatarUrl: avatarData.url
            });

            return updatedProfile;

        } catch (error) {
            logger.error('Failed to update avatar', {
                error: error.message,
                profileId,
                userId
            });
            throw error;
        }
    }

    // Delete profile (soft delete)
    async deleteProfile(profileId, userId) {
        try {
            // Verify ownership
            const existingProfile = await profileRepository.findById(profileId);
            if (!existingProfile) {
                throw new Error('Profile not found');
            }

            if (existingProfile.userId !== userId) {
                throw new Error('Unauthorized to delete this profile');
            }

            // Soft delete profile
            await profileRepository.softDelete(profileId);

            logger.info('Profile deleted successfully', {
                profileId,
                userId
            });

            return { success: true, message: 'Profile deleted successfully' };

        } catch (error) {
            logger.error('Failed to delete profile', {
                error: error.message,
                profileId,
                userId
            });
            throw error;
        }
    }

    // Search profiles
    async searchProfiles(searchTerm, limit = 20, offset = 0, requestingUserId = null) {
        try {
            const profiles = await profileRepository.search(searchTerm, limit, offset);

            // Apply privacy filters
            const filteredProfiles = [];
            for (const profile of profiles) {
                try {
                    const profileData = await this.getProfileById(profile.id, requestingUserId);
                    filteredProfiles.push(profileData);
                } catch (error) {
                    // Skip profiles that can't be accessed
                    continue;
                }
            }

            return filteredProfiles;

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

    // Calculate profile completion percentage
    async calculateProfileCompletion(profileId) {
        try {
            const profileData = await profileRepository.getProfileWithDetails(profileId);
            if (!profileData) {
                return 0;
            }

            const { profile, privacySettings, socialLinks } = profileData;

            let completion = 0;
            const maxCompletion = 100;

            // Display name (25%)
            if (profile.displayName && profile.displayName.trim().length > 0) {
                completion += 25;
            }

            // Bio (25%)
            if (profile.bio && profile.bio.trim().length > 0) {
                completion += 25;
            }

            // Avatar (25%)
            if (profile.avatarUrl && profile.avatarUrl.trim().length > 0) {
                completion += 25;
            }

            // Social links (15%)
            if (socialLinks && socialLinks.length > 0) {
                completion += Math.min(15, socialLinks.length * 5);
            }

            // Privacy settings configured (10%)
            if (privacySettings) {
                completion += 10;
            }

            // Update profile with completion percentage
            await profileRepository.update(profileId, {
                profileCompletion: completion
            });

            return completion;

        } catch (error) {
            logger.error('Failed to calculate profile completion', {
                error: error.message,
                profileId
            });
            return 0;
        }
    }

    // Get profile statistics
    async getProfileStatistics(profileId, userId) {
        try {
            // Verify ownership
            const existingProfile = await profileRepository.findById(profileId);
            if (!existingProfile) {
                throw new Error('Profile not found');
            }

            if (existingProfile.userId !== userId) {
                throw new Error('Unauthorized to view statistics for this profile');
            }

            const profileData = await profileRepository.getProfileWithDetails(profileId);
            const { profile, socialLinks } = profileData;

            return {
                completion: profile.profileCompletion,
                isPublic: profile.isPublic,
                socialLinksCount: socialLinks.length,
                verifiedSocialLinksCount: socialLinks.filter(link => link.isVerified).length,
                createdAt: profile.createdAt,
                updatedAt: profile.updatedAt
            };

        } catch (error) {
            logger.error('Failed to get profile statistics', {
                error: error.message,
                profileId,
                userId
            });
            throw error;
        }
    }

    // Add social link
    async addSocialLink(profileId, userId, linkData) {
        try {
            // Verify ownership
            const existingProfile = await profileRepository.findById(profileId);
            if (!existingProfile) {
                throw new Error('Profile not found');
            }

            if (existingProfile.userId !== userId) {
                throw new Error('Unauthorized to modify this profile');
            }

            const socialLink = await socialRepository.upsert({
                profileId,
                platform: linkData.platform,
                url: linkData.url
            });

            // Recalculate completion percentage
            await this.calculateProfileCompletion(profileId);

            logger.info('Social link added successfully', {
                profileId,
                userId,
                platform: linkData.platform
            });

            return socialLink;

        } catch (error) {
            logger.error('Failed to add social link', {
                error: error.message,
                profileId,
                userId,
                linkData
            });
            throw error;
        }
    }

    // Remove social link
    async removeSocialLink(profileId, userId, linkId) {
        try {
            // Verify ownership
            const existingProfile = await profileRepository.findById(profileId);
            if (!existingProfile) {
                throw new Error('Profile not found');
            }

            if (existingProfile.userId !== userId) {
                throw new Error('Unauthorized to modify this profile');
            }

            // Verify link belongs to profile
            const socialLink = await socialRepository.findById(linkId);
            if (!socialLink || socialLink.profileId !== profileId) {
                throw new Error('Social link not found');
            }

            await socialRepository.delete(linkId);

            // Recalculate completion percentage
            await this.calculateProfileCompletion(profileId);

            logger.info('Social link removed successfully', {
                profileId,
                userId,
                linkId
            });

            return { success: true };

        } catch (error) {
            logger.error('Failed to remove social link', {
                error: error.message,
                profileId,
                userId,
                linkId
            });
            throw error;
        }
    }
}

module.exports = new ProfileService();