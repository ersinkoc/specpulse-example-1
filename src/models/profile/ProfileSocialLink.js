const { v4: uuidv4 } = require('uuid');

class ProfileSocialLink {
    constructor(data = {}) {
        this.id = data.id || uuidv4();
        this.profileId = data.profileId;
        this.platform = data.platform;
        this.url = data.url;
        this.isVerified = data.isVerified !== undefined ? data.isVerified : false;
        this.createdAt = data.createdAt || new Date();
        this.updatedAt = data.updatedAt || new Date();
    }

    static fromDbRow(row) {
        return new ProfileSocialLink({
            id: row.id,
            profileId: row.profile_id,
            platform: row.platform,
            url: row.url,
            isVerified: row.is_verified,
            createdAt: row.created_at,
            updatedAt: row.updated_at
        });
    }

    toDbRow() {
        return {
            id: this.id,
            profile_id: this.profileId,
            platform: this.platform,
            url: this.url,
            is_verified: this.isVerified,
            created_at: this.createdAt,
            updated_at: this.updatedAt
        };
    }

    toJSON() {
        return {
            id: this.id,
            profileId: this.profileId,
            platform: this.platform,
            url: this.url,
            isVerified: this.isVerified,
            createdAt: this.createdAt,
            updatedAt: this.updatedAt
        };
    }

    static getSupportedPlatforms() {
        return [
            'linkedin',
            'twitter',
            'github',
            'instagram',
            'facebook',
            'youtube',
            'tiktok',
            'pinterest',
            'reddit',
            'website',
            'blog',
            'portfolio'
        ];
    }

    static getPlatformUrlPatterns() {
        return {
            linkedin: /^https?:\/\/(www\.)?linkedin\.com\/in\/[\w-]+\/?$/,
            twitter: /^https?:\/\/(www\.)?twitter\.com\/[\w]+\/?$/,
            github: /^https?:\/\/(www\.)?github\.com\/[\w-]+\/?$/,
            instagram: /^https?:\/\/(www\.)?instagram\.com\/[\w.]+\/?$/,
            facebook: /^https?:\/\/(www\.)?facebook\.com\/[\w.]+\/?$/,
            youtube: /^https?:\/\/(www\.)?youtube\.com\/(channel|c|user)\/[\w-]+\/?$/,
            tiktok: /^https?:\/\/(www\.)?tiktok\.com\/@[\w.]+\/?$/,
            pinterest: /^https?:\/\/(www\.)?pinterest\.com\/[\w-]+\/?$/,
            reddit: /^https?:\/\/(www\.)?reddit\.com\/(u|user)\/[\w-]+\/?$/,
            website: /^https?:\/\/[\w.-]+\.[a-z]{2,}\/?.*$/,
            blog: /^https?:\/\/[\w.-]+\.[a-z]{2,}\/?.*$/,
            portfolio: /^https?:\/\/[\w.-]+\.[a-z]{2,}\/?.*$/
        };
    }

    validate() {
        const errors = [];

        if (!this.profileId) {
            errors.push('Profile ID is required');
        }

        if (!this.platform || this.platform.trim().length === 0) {
            errors.push('Platform is required');
        }

        if (!ProfileSocialLink.getSupportedPlatforms().includes(this.platform.toLowerCase())) {
            errors.push(`Platform must be one of: ${ProfileSocialLink.getSupportedPlatforms().join(', ')}`);
        }

        if (!this.url || this.url.trim().length === 0) {
            errors.push('URL is required');
        }

        if (this.url && this.url.length > 500) {
            errors.push('URL must be less than 500 characters');
        }

        // Validate URL format
        try {
            new URL(this.url);
        } catch {
            errors.push('URL must be a valid URL');
        }

        // Validate platform-specific URL pattern
        const patterns = ProfileSocialLink.getPlatformUrlPatterns();
        const platformLower = this.platform.toLowerCase();
        if (patterns[platformLower] && !patterns[platformLower].test(this.url)) {
            errors.push(`URL does not match expected format for ${this.platform}`);
        }

        return {
            isValid: errors.length === 0,
            errors
        };
    }

    updateUrl(newUrl) {
        this.url = newUrl;
        this.updatedAt = new Date();
        this.isVerified = false; // Reset verification when URL changes
    }

    markAsVerified() {
        this.isVerified = true;
        this.updatedAt = new Date();
    }
}

module.exports = ProfileSocialLink;