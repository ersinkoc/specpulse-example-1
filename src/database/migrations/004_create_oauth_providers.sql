-- Create oauth_providers table
CREATE TABLE IF NOT EXISTS oauth_providers (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider_name VARCHAR(50) NOT NULL,
    provider_id VARCHAR(255) NOT NULL,
    provider_data JSONB,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

    -- Ensure unique combination of user and provider
    UNIQUE(user_id, provider_name),

    -- Ensure unique provider ID across all users
    UNIQUE(provider_name, provider_id)
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_oauth_providers_user_id ON oauth_providers(user_id);
CREATE INDEX IF NOT EXISTS idx_oauth_providers_provider_name ON oauth_providers(provider_name);
CREATE INDEX IF NOT EXISTS idx_oauth_providers_provider_id ON oauth_providers(provider_id);
CREATE INDEX IF NOT EXISTS idx_oauth_providers_active ON oauth_providers(is_active);
CREATE INDEX IF NOT EXISTS idx_oauth_providers_created_at ON oauth_providers(created_at);

-- Create a composite index for provider lookups
CREATE INDEX IF NOT EXISTS idx_oauth_providers_lookup ON oauth_providers(provider_name, provider_id, is_active);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_oauth_providers_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger to automatically update updated_at
CREATE TRIGGER oauth_providers_updated_at
    BEFORE UPDATE ON oauth_providers
    FOR EACH ROW
    EXECUTE FUNCTION update_oauth_providers_updated_at();

-- Function to check if user has OAuth provider
CREATE OR REPLACE FUNCTION user_has_oauth_provider(
    p_user_id INTEGER,
    p_provider_name VARCHAR(50)
) RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM oauth_providers
        WHERE user_id = p_user_id
        AND provider_name = p_provider_name
        AND is_active = true
    );
END;
$$ LANGUAGE plpgsql;

-- Function to get user's OAuth providers
CREATE OR REPLACE FUNCTION get_user_oauth_providers(p_user_id INTEGER)
RETURNS TABLE (
    provider_name VARCHAR(50),
    provider_id VARCHAR(255),
    provider_data JSONB,
    created_at TIMESTAMP WITH TIME ZONE,
    updated_at TIMESTAMP WITH TIME ZONE
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        op.provider_name,
        op.provider_id,
        op.provider_data,
        op.created_at,
        op.updated_at
    FROM oauth_providers op
    WHERE op.user_id = p_user_id
    AND op.is_active = true
    ORDER BY op.created_at DESC;
END;
$$ LANGUAGE plpgsql;

-- Function to deactivate OAuth provider
CREATE OR REPLACE FUNCTION deactivate_oauth_provider(
    p_user_id INTEGER,
    p_provider_name VARCHAR(50)
) RETURNS BOOLEAN AS $$
DECLARE
    provider_count INTEGER;
BEGIN
    -- Check if user has other active providers
    SELECT COUNT(*) INTO provider_count
    FROM oauth_providers
    WHERE user_id = p_user_id AND is_active = true;

    -- Don't allow deactivation if it's the only provider
    IF provider_count <= 1 THEN
        RETURN false;
    END IF;

    -- Deactivate the specified provider
    UPDATE oauth_providers
    SET is_active = false
    WHERE user_id = p_user_id
    AND provider_name = p_provider_name
    AND is_active = true;

    RETURN FOUND;
END;
$$ LANGUAGE plpgsql;

-- Add comments for documentation
COMMENT ON TABLE oauth_providers IS 'Stores OAuth provider information for users';
COMMENT ON COLUMN oauth_providers.user_id IS 'Reference to the user account';
COMMENT ON COLUMN oauth_providers.provider_name IS 'Name of the OAuth provider (google, github, etc.)';
COMMENT ON COLUMN oauth_providers.provider_id IS 'Unique identifier from the OAuth provider';
COMMENT ON COLUMN oauth_providers.provider_data IS 'Additional data from the OAuth provider (tokens, profile info, etc.)';
COMMENT ON COLUMN oauth_providers.is_active IS 'Whether this OAuth provider link is active';

-- Grant permissions (adjust based on your database user setup)
-- GRANT SELECT, INSERT, UPDATE, DELETE ON oauth_providers TO app_user;
-- GRANT USAGE ON oauth_providers_id_seq TO app_user;