-- Create user_profiles table
CREATE TABLE IF NOT EXISTS user_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    display_name VARCHAR(100) NOT NULL,
    bio TEXT,
    avatar_url VARCHAR(500),
    profile_completion INTEGER DEFAULT 0 CHECK (profile_completion >= 0 AND profile_completion <= 100),
    is_active BOOLEAN DEFAULT true,
    is_public BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP WITH TIME ZONE
);

-- Create profile_privacy_settings table
CREATE TABLE IF NOT EXISTS profile_privacy_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
    email_visible BOOLEAN DEFAULT false,
    bio_visible BOOLEAN DEFAULT true,
    avatar_visible BOOLEAN DEFAULT true,
    social_links_visible BOOLEAN DEFAULT true,
    profile_searchable BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create profile_social_links table
CREATE TABLE IF NOT EXISTS profile_social_links (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
    platform VARCHAR(50) NOT NULL,
    url VARCHAR(500) NOT NULL,
    is_verified BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create profile_avatars table for avatar management
CREATE TABLE IF NOT EXISTS profile_avatars (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
    original_filename VARCHAR(255) NOT NULL,
    file_path VARCHAR(500) NOT NULL,
    file_size INTEGER NOT NULL,
    mime_type VARCHAR(100) NOT NULL,
    width INTEGER,
    height INTEGER,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for performance
CREATE INDEX idx_user_profiles_user_id ON user_profiles(user_id);
CREATE INDEX idx_user_profiles_display_name ON user_profiles(display_name);
CREATE INDEX idx_user_profiles_is_public ON user_profiles(is_public);
CREATE INDEX idx_user_profiles_is_active ON user_profiles(is_active);
CREATE INDEX idx_user_profiles_created_at ON user_profiles(created_at);
CREATE INDEX idx_profile_privacy_settings_profile_id ON profile_privacy_settings(profile_id);
CREATE INDEX idx_profile_social_links_profile_id ON profile_social_links(profile_id);
CREATE INDEX idx_profile_social_links_platform ON profile_social_links(platform);
CREATE INDEX idx_profile_avatars_profile_id ON profile_avatars(profile_id);
CREATE INDEX idx_profile_avatars_is_active ON profile_avatars(is_active);

-- Create unique constraint for social links per platform per profile
CREATE UNIQUE INDEX idx_profile_social_links_unique ON profile_social_links(profile_id, platform);

-- Add trigger for updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_user_profiles_updated_at BEFORE UPDATE ON user_profiles FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_profile_privacy_settings_updated_at BEFORE UPDATE ON profile_privacy_settings FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_profile_social_links_updated_at BEFORE UPDATE ON profile_social_links FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();