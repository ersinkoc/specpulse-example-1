const { v4: uuidv4 } = require('uuid');

class ProfilePrivacySettings {
    constructor(data = {}) {
        this.id = data.id || uuidv4();
        this.profileId = data.profileId;
        this.emailVisible = data.emailVisible !== undefined ? data.emailVisible : false;
        this.bioVisible = data.bioVisible !== undefined ? data.bioVisible : true;
        this.avatarVisible = data.avatarVisible !== undefined ? data.avatarVisible : true;
        this.socialLinksVisible = data.socialLinksVisible !== undefined ? data.socialLinksVisible : true;
        this.profileSearchable = data.profileSearchable !== undefined ? data.profileSearchable : true;
        this.createdAt = data.createdAt || new Date();
        this.updatedAt = data.updatedAt || new Date();
    }

    static fromDbRow(row) {
        return new ProfilePrivacySettings({
            id: row.id,
            profileId: row.profile_id,
            emailVisible: row.email_visible,
            bioVisible: row.bio_visible,
            avatarVisible: row.avatar_visible,
            socialLinksVisible: row.social_links_visible,
            profileSearchable: row.profile_searchable,
            createdAt: row.created_at,
            updatedAt: row.updated_at
        });
    }

    toDbRow() {
        return {
            id: this.id,
            profile_id: this.profileId,
            email_visible: this.emailVisible,
            bio_visible: this.bioVisible,
            avatar_visible: this.avatarVisible,
            social_links_visible: this.socialLinksVisible,
            profile_searchable: this.profile_searchable,
            created_at: this.createdAt,
            updated_at: this.updatedAt
        };
    }

    toJSON() {
        return {
            id: this.id,
            profileId: this.profileId,
            emailVisible: this.emailVisible,
            bioVisible: this.bioVisible,
            avatarVisible: this.avatarVisible,
            socialLinksVisible: this.socialLinksVisible,
            profileSearchable: this.profileSearchable,
            createdAt: this.createdAt,
            updatedAt: this.updatedAt
        };
    }

    validate() {
        const errors = [];

        if (!this.profileId) {
            errors.push('Profile ID is required');
        }

        if (typeof this.emailVisible !== 'boolean') {
            errors.push('Email visibility must be a boolean');
        }

        if (typeof this.bioVisible !== 'boolean') {
            errors.push('Bio visibility must be a boolean');
        }

        if (typeof this.avatarVisible !== 'boolean') {
            errors.push('Avatar visibility must be a boolean');
        }

        if (typeof this.socialLinksVisible !== 'boolean') {
            errors.push('Social links visibility must be a boolean');
        }

        if (typeof this.profileSearchable !== 'boolean') {
            errors.push('Profile searchable must be a boolean');
        }

        return {
            isValid: errors.length === 0,
            errors
        };
    }

    updateSettings(settings) {
        if (settings.emailVisible !== undefined) this.emailVisible = settings.emailVisible;
        if (settings.bioVisible !== undefined) this.bioVisible = settings.bioVisible;
        if (settings.avatarVisible !== undefined) this.avatarVisible = settings.avatarVisible;
        if (settings.socialLinksVisible !== undefined) this.socialLinksVisible = settings.socialLinksVisible;
        if (settings.profileSearchable !== undefined) this.profileSearchable = settings.profileSearchable;
        this.updatedAt = new Date();
    }
}

module.exports = ProfilePrivacySettings;