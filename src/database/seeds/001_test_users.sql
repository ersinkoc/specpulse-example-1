-- Seed data: Test users for development and testing
-- Description: Creates test user accounts for development environment

-- Insert test users (only in development)
DO $$
BEGIN
    -- Only run in development environment
    IF current_setting('is_superuser', true) = 'on' THEN
        -- Test user with local authentication
        INSERT INTO users (email, email_verified, password_hash, name, roles) VALUES
        ('test@example.com', true, '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewdBPj3QJflHQrxG', 'Test User', '["user"]')
        ON CONFLICT (email) DO NOTHING;

        -- Test admin user
        INSERT INTO users (email, email_verified, password_hash, name, roles) VALUES
        ('admin@example.com', true, '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewdBPj3QJflHQrxG', 'Admin User', '["user", "admin"]')
        ON CONFLICT (email) DO NOTHING;

        -- Unverified test user
        INSERT INTO users (email, email_verified, password_hash, name, roles) VALUES
        ('unverified@example.com', false, '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewdBPj3QJflHQrxG', 'Unverified User', '["user"]')
        ON CONFLICT (email) DO NOTHING;

        -- OAuth2-only user (no password)
        INSERT INTO users (email, email_verified, password_hash, name, roles, avatar_url) VALUES
        ('oauth@example.com', true, null, 'OAuth User', '["user"]', 'https://example.com/avatar.jpg')
        ON CONFLICT (email) DO NOTHING;

        RAISE NOTICE 'Test users seeded successfully';
    END IF;
END $$;

-- Insert OAuth2 provider test data
DO $$
BEGIN
    -- Only run in development environment
    IF current_setting('is_superuser', true) = 'on' THEN
        -- Get the OAuth2 test user ID
        INSERT INTO oauth_providers (user_id, provider, provider_id, profile_data, is_active)
        SELECT
            u.id,
            'google' as provider,
            '123456789' as provider_id,
            '{
                "id": "123456789",
                "email": "oauth@example.com",
                "name": "OAuth User",
                "picture": "https://example.com/avatar.jpg",
                "verified": true
            }'::jsonb as profile_data,
            true as is_active
        FROM users u
        WHERE u.email = 'oauth@example.com'
        ON CONFLICT (provider, provider_id) DO NOTHING;

        -- Add GitHub provider for same user
        INSERT INTO oauth_providers (user_id, provider, provider_id, profile_data, is_active)
        SELECT
            u.id,
            'github' as provider,
            'github123' as provider_id,
            '{
                "id": 123456,
                "login": "oauthuser",
                "email": "oauth@example.com",
                "name": "OAuth User",
                "avatar_url": "https://github.com/avatar.jpg"
            }'::jsonb as profile_data,
            true as is_active
        FROM users u
        WHERE u.email = 'oauth@example.com'
        ON CONFLICT (provider, provider_id) DO NOTHING;

        RAISE NOTICE 'OAuth2 provider test data seeded successfully';
    END IF;
END $$;

-- Create test data for OAuth2 flows
DO $$
BEGIN
    -- Only run in development environment
    IF current_setting('is_superuser', true) = 'on' THEN
        -- Add OAuth2 provider for regular test user
        INSERT INTO oauth_providers (user_id, provider, provider_id, profile_data, is_active)
        SELECT
            u.id,
            'google' as provider,
            '987654321' as provider_id,
            '{
                "id": "987654321",
                "email": "test@example.com",
                "name": "Test User",
                "picture": "https://example.com/test-avatar.jpg",
                "verified": true
            }'::jsonb as profile_data,
            true as is_active
        FROM users u
        WHERE u.email = 'test@example.com'
        ON CONFLICT (provider, provider_id) DO NOTHING;

        RAISE NOTICE 'Additional OAuth2 test data seeded successfully';
    END IF;
END $$;

-- Note: All passwords are 'password123' (hashed with bcrypt)
-- Use these test accounts for development and testing:
--
-- Local Authentication Users:
-- - Email: test@example.com, Password: password123 (verified, user role)
-- - Email: admin@example.com, Password: password123 (verified, admin role)
-- - Email: unverified@example.com, Password: password123 (unverified)
--
-- OAuth2 Users:
-- - Email: oauth@example.com (Google + GitHub providers linked)
-- - Email: test@example.com (Google provider linked)
--
-- These accounts are only created in development/superuser environment