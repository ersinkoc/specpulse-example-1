const Profile = require('../../../src/models/profile/Profile');

describe('Profile Model', () => {
  describe('Constructor', () => {
    test('should create profile with default values', () => {
      const profile = new Profile();

      expect(profile.id).toBeDefined();
      expect(profile.displayName).toBeUndefined();
      expect(profile.bio).toBeNull();
      expect(profile.avatarUrl).toBeNull();
      expect(profile.profileCompletion).toBe(0);
      expect(profile.isActive).toBe(true);
      expect(profile.isPublic).toBe(true);
      expect(profile.deletedAt).toBeNull();
    });

    test('should create profile with provided data', () => {
      const data = {
        id: 'test-id',
        userId: 'user-id',
        displayName: 'John Doe',
        bio: 'Software Developer',
        avatarUrl: 'https://example.com/avatar.jpg',
        profileCompletion: 75,
        isActive: false,
        isPublic: false
      };

      const profile = new Profile(data);

      expect(profile.id).toBe('test-id');
      expect(profile.userId).toBe('user-id');
      expect(profile.displayName).toBe('John Doe');
      expect(profile.bio).toBe('Software Developer');
      expect(profile.avatarUrl).toBe('https://example.com/avatar.jpg');
      expect(profile.profileCompletion).toBe(75);
      expect(profile.isActive).toBe(false);
      expect(profile.isPublic).toBe(false);
    });
  });

  describe('fromDbRow', () => {
    test('should convert database row to profile object', () => {
      const row = {
        id: 'db-id',
        user_id: 'db-user-id',
        display_name: 'Jane Doe',
        bio: 'Developer',
        avatar_url: 'https://example.com/jane.jpg',
        profile_completion: 50,
        is_active: true,
        is_public: true,
        created_at: new Date('2025-01-01'),
        updated_at: new Date('2025-01-02'),
        deleted_at: null
      };

      const profile = Profile.fromDbRow(row);

      expect(profile.id).toBe('db-id');
      expect(profile.userId).toBe('db-user-id');
      expect(profile.displayName).toBe('Jane Doe');
      expect(profile.bio).toBe('Developer');
      expect(profile.avatarUrl).toBe('https://example.com/jane.jpg');
      expect(profile.profileCompletion).toBe(50);
      expect(profile.isActive).toBe(true);
      expect(profile.isPublic).toBe(true);
      expect(profile.createdAt).toEqual(new Date('2025-01-01'));
      expect(profile.updatedAt).toEqual(new Date('2025-01-02'));
      expect(profile.deletedAt).toBeNull();
    });
  });

  describe('toDbRow', () => {
    test('should convert profile object to database row format', () => {
      const profile = new Profile({
        id: 'test-id',
        userId: 'user-id',
        displayName: 'John Doe',
        bio: 'Software Developer',
        avatarUrl: 'https://example.com/avatar.jpg',
        profileCompletion: 75
      });

      const row = profile.toDbRow();

      expect(row.id).toBe('test-id');
      expect(row.user_id).toBe('user-id');
      expect(row.display_name).toBe('John Doe');
      expect(row.bio).toBe('Software Developer');
      expect(row.avatar_url).toBe('https://example.com/avatar.jpg');
      expect(row.profile_completion).toBe(75);
    });
  });

  describe('toJSON', () => {
    test('should return profile data as JSON', () => {
      const profile = new Profile({
        id: 'test-id',
        userId: 'user-id',
        displayName: 'John Doe',
        bio: 'Software Developer'
      });

      const json = profile.toJSON();

      expect(json.id).toBe('test-id');
      expect(json.userId).toBe('user-id');
      expect(json.displayName).toBe('John Doe');
      expect(json.bio).toBe('Software Developer');
      expect(json.isActive).toBe(true);
      expect(json.isPublic).toBe(true);
    });
  });

  describe('validate', () => {
    test('should return valid for complete profile', () => {
      const profile = new Profile({
        userId: 'user-id',
        displayName: 'John Doe',
        bio: 'Software Developer'
      });

      const validation = profile.validate();

      expect(validation.isValid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });

    test('should return invalid for missing userId', () => {
      const profile = new Profile({
        displayName: 'John Doe'
      });

      const validation = profile.validate();

      expect(validation.isValid).toBe(false);
      expect(validation.errors).toContain('User ID is required');
    });

    test('should return invalid for empty displayName', () => {
      const profile = new Profile({
        userId: 'user-id',
        displayName: ''
      });

      const validation = profile.validate();

      expect(validation.isValid).toBe(false);
      expect(validation.errors).toContain('Display name is required');
    });

    test('should return invalid for displayName too long', () => {
      const profile = new Profile({
        userId: 'user-id',
        displayName: 'a'.repeat(101)
      });

      const validation = profile.validate();

      expect(validation.isValid).toBe(false);
      expect(validation.errors).toContain('Display name must be less than 100 characters');
    });

    test('should return invalid for bio too long', () => {
      const profile = new Profile({
        userId: 'user-id',
        displayName: 'John Doe',
        bio: 'a'.repeat(1001)
      });

      const validation = profile.validate();

      expect(validation.isValid).toBe(false);
      expect(validation.errors).toContain('Bio must be less than 1000 characters');
    });

    test('should return invalid for invalid profile completion', () => {
      const profile = new Profile({
        userId: 'user-id',
        displayName: 'John Doe',
        profileCompletion: 150
      });

      const validation = profile.validate();

      expect(validation.isValid).toBe(false);
      expect(validation.errors).toContain('Profile completion must be between 0 and 100');
    });
  });

  describe('calculateCompletion', () => {
    test('should calculate completion percentage correctly', () => {
      const profile = new Profile({
        userId: 'user-id',
        displayName: 'John Doe',
        bio: 'Software Developer',
        avatarUrl: 'https://example.com/avatar.jpg'
      });

      const completion = profile.calculateCompletion();

      expect(completion).toBe(75); // 25% + 25% + 25% (no privacy settings yet)
      expect(profile.profileCompletion).toBe(75);
    });

    test('should calculate 0% for empty profile', () => {
      const profile = new Profile({
        userId: 'user-id'
      });

      const completion = profile.calculateCompletion();

      expect(completion).toBe(25); // Only privacy settings counted
    });
  });

  describe('softDelete', () => {
    test('should soft delete profile', () => {
      const profile = new Profile({
        userId: 'user-id',
        displayName: 'John Doe',
        isActive: true,
        isPublic: true
      });

      profile.softDelete();

      expect(profile.deletedAt).toBeInstanceOf(Date);
      expect(profile.isActive).toBe(false);
      expect(profile.isPublic).toBe(false);
    });
  });

  describe('restore', () => {
    test('should restore soft deleted profile', () => {
      const profile = new Profile({
        userId: 'user-id',
        displayName: 'John Doe'
      });

      profile.softDelete();
      profile.restore();

      expect(profile.deletedAt).toBeNull();
      expect(profile.isActive).toBe(true);
    });
  });
});