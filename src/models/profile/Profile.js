const { v4: uuidv4 } = require('uuid');

class Profile {
    constructor(data = {}) {
        this.id = data.id || uuidv4();
        this.userId = data.userId;
        this.displayName = data.displayName;
        this.bio = data.bio || null;
        this.avatarUrl = data.avatarUrl || null;
        this.profileCompletion = data.profileCompletion || 0;
        this.isActive = data.isActive !== undefined ? data.isActive : true;
        this.isPublic = data.isPublic !== undefined ? data.isPublic : true;
        this.createdAt = data.createdAt || new Date();
        this.updatedAt = data.updatedAt || new Date();
        this.deletedAt = data.deletedAt || null;
    }

    static fromDbRow(row) {
        return new Profile({
            id: row.id,
            userId: row.user_id,
            displayName: row.display_name,
            bio: row.bio,
            avatarUrl: row.avatar_url,
            profileCompletion: row.profile_completion,
            isActive: row.is_active,
            isPublic: row.is_public,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
            deletedAt: row.deleted_at
        });
    }

    toDbRow() {
        return {
            id: this.id,
            user_id: this.userId,
            display_name: this.displayName,
            bio: this.bio,
            avatar_url: this.avatarUrl,
            profile_completion: this.profileCompletion,
            is_active: this.isActive,
            is_public: this.isPublic,
            created_at: this.createdAt,
            updated_at: this.updatedAt,
            deleted_at: this.deletedAt
        };
    }

    toJSON() {
        return {
            id: this.id,
            userId: this.userId,
            displayName: this.displayName,
            bio: this.bio,
            avatarUrl: this.avatarUrl,
            profileCompletion: this.profileCompletion,
            isActive: this.isActive,
            isPublic: this.isPublic,
            createdAt: this.createdAt,
            updatedAt: this.updatedAt,
            deletedAt: this.deletedAt
        };
    }

    validate() {
        const errors = [];

        if (!this.userId) {
            errors.push('User ID is required');
        }

        if (!this.displayName || this.displayName.trim().length === 0) {
            errors.push('Display name is required');
        }

        if (this.displayName && this.displayName.length > 100) {
            errors.push('Display name must be less than 100 characters');
        }

        if (this.bio && this.bio.length > 1000) {
            errors.push('Bio must be less than 1000 characters');
        }

        if (this.profileCompletion < 0 || this.profileCompletion > 100) {
            errors.push('Profile completion must be between 0 and 100');
        }

        return {
            isValid: errors.length === 0,
            errors
        };
    }

    calculateCompletion() {
        let completion = 0;
        const totalFields = 4; // displayName, bio, avatarUrl, privacySettings

        if (this.displayName && this.displayName.trim().length > 0) {
            completion += 25;
        }

        if (this.bio && this.bio.trim().length > 0) {
            completion += 25;
        }

        if (this.avatarUrl && this.avatarUrl.trim().length > 0) {
            completion += 25;
        }

        // Privacy settings are tracked separately, but we'll count this as 25%
        completion += 25;

        this.profileCompletion = completion;
        return completion;
    }

    softDelete() {
        this.deletedAt = new Date();
        this.isActive = false;
        this.isPublic = false;
    }

    restore() {
        this.deletedAt = null;
        this.isActive = true;
    }
}

module.exports = Profile;