-- Migration: Create refresh_tokens table
-- Description: Creates refresh tokens table for JWT token management

-- Create refresh_tokens table
CREATE TABLE IF NOT EXISTS refresh_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token VARCHAR(500) NOT NULL UNIQUE,
    device_info JSONB DEFAULT '{}'::jsonb,
    ip_address INET,
    user_agent TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP NOT NULL,
    last_used_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    revoked_at TIMESTAMP,
    revoked_reason VARCHAR(255)
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id ON refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_token ON refresh_tokens(token);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_expires_at ON refresh_tokens(expires_at);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_is_active ON refresh_tokens(is_active);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_revoked_at ON refresh_tokens(revoked_at);

-- Create composite index for user active tokens
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_active ON refresh_tokens(user_id, is_active) WHERE is_active = true;

-- Add constraints
ALTER TABLE refresh_tokens ADD CONSTRAINT chk_refresh_tokens_expires_at
    CHECK (expires_at > created_at);

ALTER TABLE refresh_tokens ADD CONSTRAINT chk_refresh_tokens_last_used_at
    CHECK (last_used_at >= created_at);

-- Add check constraint for revoked timestamps
ALTER TABLE refresh_tokens ADD CONSTRAINT chk_refresh_tokens_revoked_at
    CHECK (
        revoked_at IS NULL OR
        revoked_at >= created_at
    );

-- Create trigger to update updated_at timestamp (if we add updated_at column later)
-- CREATE TRIGGER update_refresh_tokens_updated_at
--     BEFORE UPDATE ON refresh_tokens
--     FOR EACH ROW
--     EXECUTE FUNCTION update_updated_at_column();

-- Add comments for documentation
COMMENT ON TABLE refresh_tokens IS 'Refresh tokens for JWT token management and session tracking';
COMMENT ON COLUMN refresh_tokens.id IS 'Primary key UUID';
COMMENT ON COLUMN refresh_tokens.user_id IS 'Reference to user account';
COMMENT ON COLUMN refresh_tokens.token IS 'Encrypted refresh token';
COMMENT ON COLUMN refresh_tokens.device_info IS 'Device information as JSONB';
COMMENT ON COLUMN refresh_tokens.ip_address IS 'IP address that created the token';
COMMENT ON COLUMN refresh_tokens.user_agent IS 'User agent string';
COMMENT ON COLUMN refresh_tokens.is_active IS 'Whether the token is currently active';
COMMENT ON COLUMN refresh_tokens.created_at IS 'Token creation timestamp';
COMMENT ON COLUMN refresh_tokens.expires_at IS 'Token expiration timestamp';
COMMENT ON COLUMN refresh_tokens.last_used_at IS 'Last time token was used';
COMMENT ON COLUMN refresh_tokens.revoked_at IS 'Token revocation timestamp';
COMMENT ON COLUMN refresh_tokens.revoked_reason IS 'Reason for token revocation';

-- Create function to clean up expired tokens
CREATE OR REPLACE FUNCTION cleanup_expired_refresh_tokens()
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM refresh_tokens
    WHERE expires_at < CURRENT_TIMESTAMP - INTERVAL '1 day'
    OR (is_active = false AND revoked_at < CURRENT_TIMESTAMP - INTERVAL '7 days');

    GET DIAGNOSTICS deleted_count = ROW_COUNT;

    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Create function to get active refresh tokens for user
CREATE OR REPLACE FUNCTION get_user_active_refresh_tokens(p_user_id UUID)
RETURNS TABLE(
    id UUID,
    token VARCHAR(500),
    device_info JSONB,
    ip_address INET,
    created_at TIMESTAMP,
    expires_at TIMESTAMP,
    last_used_at TIMESTAMP,
    device_description TEXT
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        rt.id,
        rt.token,
        rt.device_info,
        rt.ip_address,
        rt.created_at,
        rt.expires_at,
        rt.last_used_at,
        CASE
            WHEN rt.device_info->>'description' IS NOT NULL THEN rt.device_info->>'description'
            WHEN rt.user_agent ILIKE '%mobile%' OR rt.user_agent ILIKE '%android%' OR rt.user_agent ILIKE '%iphone%' THEN 'Mobile Device'
            WHEN rt.user_agent ILIKE '%tablet%' OR rt.user_agent ILIKE '%ipad%' THEN 'Tablet Device'
            ELSE 'Desktop Device'
        END as device_description
    FROM refresh_tokens rt
    WHERE rt.user_id = p_user_id
    AND rt.is_active = true
    AND rt.expires_at > CURRENT_TIMESTAMP
    AND rt.revoked_at IS NULL
    ORDER BY rt.last_used_at DESC;
END;
$$ LANGUAGE plpgsql;

-- Create function to revoke all user tokens
CREATE OR REPLACE FUNCTION revoke_all_user_refresh_tokens(p_user_id UUID, p_reason VARCHAR(255))
RETURNS INTEGER AS $$
DECLARE
    revoked_count INTEGER;
BEGIN
    UPDATE refresh_tokens
    SET is_active = false,
        revoked_at = CURRENT_TIMESTAMP,
        revoked_reason = p_reason
    WHERE user_id = p_user_id
    AND is_active = true
    AND revoked_at IS NULL;

    GET DIAGNOSTICS revoked_count = ROW_COUNT;

    RETURN revoked_count;
END;
$$ LANGUAGE plpgsql;

-- Create function to revoke token
CREATE OR REPLACE FUNCTION revoke_refresh_token(p_token_id UUID, p_reason VARCHAR(255))
RETURNS BOOLEAN AS $$
DECLARE
    updated_count INTEGER;
BEGIN
    UPDATE refresh_tokens
    SET is_active = false,
        revoked_at = CURRENT_TIMESTAMP,
        revoked_reason = p_reason
    WHERE id = p_token_id
    AND is_active = true
    AND revoked_at IS NULL;

    GET DIAGNOSTICS updated_count = ROW_COUNT;

    RETURN updated_count > 0;
END;
$$ LANGUAGE plpgsql;