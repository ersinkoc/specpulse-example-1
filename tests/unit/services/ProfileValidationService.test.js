const ProfileValidationService = require('../../../src/services/profile/ProfileValidationService');

describe('ProfileValidationService', () => {
  describe('validateProfileData', () => {
    test('should validate complete valid profile data', () => {
      const data = {
        displayName: 'John Doe',
        bio: 'Software Developer',
        avatarUrl: 'https://example.com/avatar.jpg',
        isPublic: true,
        profileCompletion: 75
      };

      const validation = ProfileValidationService.validateProfileData(data);

      expect(validation.isValid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });

    test('should validate empty displayName', () => {
      const data = {
        displayName: ''
      };

      const validation = ProfileValidationService.validateProfileData(data);

      expect(validation.isValid).toBe(false);
      expect(validation.errors).toContain('Display name is required');
    });

    test('should validate displayName too long', () => {
      const data = {
        displayName: 'a'.repeat(101)
      };

      const validation = ProfileValidationService.validateProfileData(data);

      expect(validation.isValid).toBe(false);
      expect(validation.errors).toContain('Display name must be less than 100 characters');
    });

    test('should validate displayName too short', () => {
      const data = {
        displayName: 'a'
      };

      const validation = ProfileValidationService.validateProfileData(data);

      expect(validation.isValid).toBe(false);
      expect(validation.errors).toContain('Display name must be at least 2 characters');
    });

    test('should validate bio too long', () => {
      const data = {
        displayName: 'John Doe',
        bio: 'a'.repeat(1001)
      };

      const validation = ProfileValidationService.validateProfileData(data);

      expect(validation.isValid).toBe(false);
      expect(validation.errors).toContain('Bio must be less than 1000 characters');
    });

    test('should validate invalid avatar URL', () => {
      const data = {
        displayName: 'John Doe',
        avatarUrl: 'invalid-url'
      };

      const validation = ProfileValidationService.validateProfileData(data);

      expect(validation.isValid).toBe(false);
      expect(validation.errors).toContain('Avatar URL must be a valid URL');
    });

    test('should validate non-boolean isPublic', () => {
      const data = {
        displayName: 'John Doe',
        isPublic: 'true'
      };

      const validation = ProfileValidationService.validateProfileData(data);

      expect(validation.isValid).toBe(false);
      expect(validation.errors).toContain('Profile visibility must be a boolean');
    });

    test('should validate profile completion out of range', () => {
      const data = {
        displayName: 'John Doe',
        profileCompletion: 150
      };

      const validation = ProfileValidationService.validateProfileData(data);

      expect(validation.isValid).toBe(false);
      expect(validation.errors).toContain('Profile completion must be between 0 and 100');
    });
  });

  describe('validatePrivacySettings', () => {
    test('should validate valid privacy settings', () => {
      const settings = {
        emailVisible: false,
        bioVisible: true,
        avatarVisible: true,
        socialLinksVisible: true,
        profileSearchable: true
      };

      const validation = ProfileValidationService.validatePrivacySettings(settings);

      expect(validation.isValid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });

    test('should validate non-boolean fields', () => {
      const settings = {
        emailVisible: 'false',
        bioVisible: true
      };

      const validation = ProfileValidationService.validatePrivacySettings(settings);

      expect(validation.isValid).toBe(false);
      expect(validation.errors).toContain('emailVisible must be a boolean');
    });
  });

  describe('validateSocialLink', () => {
    test('should validate valid social link', () => {
      const link = {
        profileId: 'profile-id',
        platform: 'github',
        url: 'https://github.com/johndoe'
      };

      const validation = ProfileValidationService.validateSocialLink(link);

      expect(validation.isValid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });

    test('should validate missing profileId', () => {
      const link = {
        platform: 'github',
        url: 'https://github.com/johndoe'
      };

      const validation = ProfileValidationService.validateSocialLink(link);

      expect(validation.isValid).toBe(false);
      expect(validation.errors).toContain('Profile ID is required');
    });

    test('should validate unsupported platform', () => {
      const link = {
        profileId: 'profile-id',
        platform: 'unsupported',
        url: 'https://example.com'
      };

      const validation = ProfileValidationService.validateSocialLink(link);

      expect(validation.isValid).toBe(false);
      expect(validation.errors).toContain('Platform must be one of: linkedin, twitter, github, instagram, facebook, youtube, tiktok, pinterest, reddit, website, blog, portfolio');
    });

    test('should validate invalid URL', () => {
      const link = {
        profileId: 'profile-id',
        platform: 'github',
        url: 'invalid-url'
      };

      const validation = ProfileValidationService.validateSocialLink(link);

      expect(validation.isValid).toBe(false);
      expect(validation.errors.length).toBeGreaterThan(0);
    });
  });

  describe('validateSocialLinks', () => {
    test('should validate array of valid social links', () => {
      const links = [
        {
          profileId: 'profile-id',
          platform: 'github',
          url: 'https://github.com/johndoe'
        },
        {
          profileId: 'profile-id',
          platform: 'linkedin',
          url: 'https://linkedin.com/in/johndoe'
        }
      ];

      const validation = ProfileValidationService.validateSocialLinks(links);

      expect(validation.isValid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });

    test('should validate non-array input', () => {
      const links = 'not-an-array';

      const validation = ProfileValidationService.validateSocialLinks(links);

      expect(validation.isValid).toBe(false);
      expect(validation.errors).toContain('Social links must be an array');
    });

    test('should validate too many links', () => {
      const links = Array(11).fill().map((_, i) => ({
        profileId: 'profile-id',
        platform: 'github',
        url: `https://github.com/user${i}`
      }));

      const validation = ProfileValidationService.validateSocialLinks(links);

      expect(validation.isValid).toBe(false);
      expect(validation.errors).toContain('Maximum 10 social links allowed');
    });

    test('should validate duplicate platforms', () => {
      const links = [
        {
          profileId: 'profile-id',
          platform: 'github',
          url: 'https://github.com/user1'
        },
        {
          profileId: 'profile-id',
          platform: 'github',
          url: 'https://github.com/user2'
        }
      ];

      const validation = ProfileValidationService.validateSocialLinks(links);

      expect(validation.isValid).toBe(false);
      expect(validation.errors).toContain('Duplicate platform: github');
    });
  });

  describe('validateSearchQuery', () => {
    test('should validate valid search query', () => {
      const query = 'John Doe';

      const validation = ProfileValidationService.validateSearchQuery(query);

      expect(validation.isValid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });

    test('should validate empty query', () => {
      const query = '';

      const validation = ProfileValidationService.validateSearchQuery(query);

      expect(validation.isValid).toBe(false);
      expect(validation.errors).toContain('Search query is required');
    });

    test('should validate query too long', () => {
      const query = 'a'.repeat(101);

      const validation = ProfileValidationService.validateSearchQuery(query);

      expect(validation.isValid).toBe(false);
      expect(validation.errors).toContain('Search query must be less than 100 characters');
    });

    test('should validate dangerous content', () => {
      const query = 'DROP TABLE users';

      const validation = ProfileValidationService.validateSearchQuery(query);

      expect(validation.isValid).toBe(false);
      expect(validation.errors.length).toBeGreaterThan(0);
    });
  });

  describe('sanitizeSearchQuery', () => {
    test('should sanitize dangerous characters', () => {
      const query = "John O'Connor <script>alert('xss')</script>";

      const sanitized = ProfileValidationService.sanitizeSearchQuery(query);

      expect(sanitized).toBe("John O'Connor alertxss");
    });

    test('should remove SQL injection attempts', () => {
      const query = "John'; DROP TABLE users; --";

      const sanitized = ProfileValidationService.sanitizeSearchQuery(query);

      expect(sanitized).toBe("John DROP TABLE users");
    });
  });

  describe('validateFileUpload', () => {
    test('should validate valid image file', () => {
      const file = {
        originalname: 'avatar.jpg',
        mimetype: 'image/jpeg',
        size: 1024 * 1024 // 1MB
      };

      const validation = ProfileValidationService.validateFileUpload(file);

      expect(validation.isValid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });

    test('should validate missing file', () => {
      const validation = ProfileValidationService.validateFileUpload(null);

      expect(validation.isValid).toBe(false);
      expect(validation.errors).toContain('No file provided');
    });

    test('should validate file too large', () => {
      const file = {
        originalname: 'avatar.jpg',
        mimetype: 'image/jpeg',
        size: 5 * 1024 * 1024 // 5MB
      };

      const validation = ProfileValidationService.validateFileUpload(file);

      expect(validation.isValid).toBe(false);
      expect(validation.errors).toContain('File size exceeds 4MB limit (5MB)');
    });

    test('should validate unsupported file type', () => {
      const file = {
        originalname: 'document.pdf',
        mimetype: 'application/pdf',
        size: 1024 * 1024
      };

      const validation = ProfileValidationService.validateFileUpload(file);

      expect(validation.isValid).toBe(false);
      expect(validation.errors).toContain('File type application/pdf is not allowed');
    });

    test('should validate empty filename', () => {
      const file = {
        originalname: '',
        mimetype: 'image/jpeg',
        size: 1024 * 1024
      };

      const validation = ProfileValidationService.validateFileUpload(file);

      expect(validation.isValid).toBe(false);
      expect(validation.errors).toContain('Filename is required');
    });
  });
});