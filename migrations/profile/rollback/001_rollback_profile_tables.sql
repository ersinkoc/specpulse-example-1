-- Drop triggers
DROP TRIGGER IF EXISTS update_user_profiles_updated_at ON user_profiles;
DROP TRIGGER IF EXISTS update_profile_privacy_settings_updated_at ON profile_privacy_settings;
DROP TRIGGER IF EXISTS update_profile_social_links_updated_at ON profile_social_links;

-- Drop function
DROP FUNCTION IF EXISTS update_updated_at_column();

-- Drop indexes
DROP INDEX IF EXISTS idx_profile_avatars_is_active;
DROP INDEX IF EXISTS idx_profile_avatars_profile_id;
DROP INDEX IF EXISTS idx_profile_social_links_platform;
DROP INDEX IF EXISTS idx_profile_social_links_profile_id;
DROP INDEX IF EXISTS idx_profile_privacy_settings_profile_id;
DROP INDEX IF EXISTS idx_user_profiles_created_at;
DROP INDEX IF EXISTS idx_user_profiles_is_active;
DROP INDEX IF EXISTS idx_user_profiles_is_public;
DROP INDEX IF EXISTS idx_user_profiles_display_name;
DROP INDEX IF EXISTS idx_user_profiles_user_id;
DROP INDEX IF EXISTS idx_profile_social_links_unique;

-- Drop tables
DROP TABLE IF EXISTS profile_avatars;
DROP TABLE IF EXISTS profile_social_links;
DROP TABLE IF EXISTS profile_privacy_settings;
DROP TABLE IF EXISTS user_profiles;