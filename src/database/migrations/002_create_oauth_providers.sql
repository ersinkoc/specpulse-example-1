-- Migration: Create oauth_providers table
-- Description: Creates OAuth2 provider accounts table for linking external providers

-- Create oauth_providers table
CREATE TABLE IF NOT EXISTS oauth_providers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider VARCHAR(50) NOT NULL,
    provider_id VARCHAR(255) NOT NULL,
    access_token TEXT,
    refresh_token TEXT,
    token_expires_at TIMESTAMP,
    profile_data JSONB,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(provider, provider_id)
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_oauth_providers_user_id ON oauth_providers(user_id);
CREATE INDEX IF NOT EXISTS idx_oauth_providers_provider ON oauth_providers(provider);
CREATE INDEX IF NOT EXISTS idx_oauth_providers_provider_id ON oauth_providers(provider_id);
CREATE INDEX IF NOT EXISTS idx_oauth_providers_token_expires_at ON oauth_providers(token_expires_at);
CREATE INDEX IF NOT EXISTS idx_oauth_providers_is_active ON oauth_providers(is_active);

-- Create composite index for user provider lookups
CREATE INDEX IF NOT EXISTS idx_oauth_providers_user_provider ON oauth_providers(user_id, provider);

-- Add constraints
ALTER TABLE oauth_providers ADD CONSTRAINT chk_oauth_providers_provider
    CHECK (provider IN ('google', 'github', 'facebook', 'twitter', 'microsoft', 'apple'));

ALTER TABLE oauth_providers ADD CONSTRAINT chk_oauth_providers_provider_id_not_empty
    CHECK (LENGTH(TRIM(provider_id)) > 0);

-- Add check constraint for token expiration
ALTER TABLE oauth_providers ADD CONSTRAINT chk_oauth_providers_token_expiry
    CHECK (
        token_expires_at IS NULL OR
        token_expires_at > created_at
    );

-- Create trigger to update updated_at timestamp
CREATE TRIGGER update_oauth_providers_updated_at
    BEFORE UPDATE ON oauth_providers
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Add comments for documentation
COMMENT ON TABLE oauth_providers IS 'OAuth2 provider accounts linked to user accounts';
COMMENT ON COLUMN oauth_providers.id IS 'Primary key UUID';
COMMENT ON COLUMN oauth_providers.user_id IS 'Reference to user account';
COMMENT ON COLUMN oauth_providers.provider IS 'OAuth2 provider name (google, github, etc.)';
COMMENT ON COLUMN oauth_providers.provider_id IS 'Provider-specific user ID';
COMMENT ON COLUMN oauth_providers.access_token IS 'Encrypted OAuth2 access token';
COMMENT ON COLUMN oauth_providers.refresh_token IS 'Encrypted OAuth2 refresh token';
COMMENT ON COLUMN oauth_providers.token_expires_at IS 'OAuth2 token expiration time';
COMMENT ON COLUMN oauth_providers.profile_data IS 'Provider profile data as JSONB';
COMMENT ON COLUMN oauth_providers.is_active IS 'Whether this OAuth2 link is active';
COMMENT ON COLUMN oauth_providers.created_at IS 'Link creation timestamp';
COMMENT ON COLUMN oauth_providers.updated_at IS 'Last update timestamp';

-- Create function to find users by OAuth provider
CREATE OR REPLACE FUNCTION find_user_by_oauth_provider(p_provider VARCHAR(50), p_provider_id VARCHAR(255))
RETURNS TABLE(user_id UUID, email VARCHAR(255), name VARCHAR(255), email_verified BOOLEAN) AS $$
BEGIN
    RETURN QUERY
    SELECT
        u.id,
        u.email,
        u.name,
        u.email_verified
    FROM users u
    INNER JOIN oauth_providers op ON u.id = op.user_id
    WHERE op.provider = p_provider
    AND op.provider_id = p_provider_id
    AND op.is_active = true
    AND u.is_active = true;
END;
$$ LANGUAGE plpgsql;

-- Create function to get user's OAuth providers
CREATE OR REPLACE FUNCTION get_user_oauth_providers(p_user_id UUID)
RETURNS TABLE(provider VARCHAR(50), provider_id VARCHAR(255), created_at TIMESTAMP) AS $$
BEGIN
    RETURN QUERY
    SELECT
        op.provider,
        op.provider_id,
        op.created_at
    FROM oauth_providers op
    WHERE op.user_id = p_user_id
    AND op.is_active = true
    ORDER BY op.created_at DESC;
END;
$$ LANGUAGE plpgsql;