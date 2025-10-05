-- Add user association to tasks table
-- This migration adds user ownership to existing tasks

-- Add user_id column to tasks table
ALTER TABLE tasks
ADD COLUMN user_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
ADD COLUMN user_email VARCHAR(255) NOT NULL DEFAULT 'system@example.com';

-- Create index for user_id for better query performance
CREATE INDEX IF NOT EXISTS idx_tasks_user_id ON tasks(user_id);

-- Create index for user_email for better query performance
CREATE INDEX IF NOT EXISTS idx_tasks_user_email ON tasks(user_email);

-- Add foreign key constraint if users table exists
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'users') THEN
        ALTER TABLE tasks
        ADD CONSTRAINT fk_tasks_user_id
        FOREIGN KEY (user_id) REFERENCES users(id)
        ON DELETE CASCADE;
    END IF;
END
$$;

-- Add created_at and updated_at timestamps if they don't exist
ALTER TABLE tasks
ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;

-- Create index for created_at
CREATE INDEX IF NOT EXISTS idx_tasks_created_at ON tasks(created_at);

-- Create trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_tasks_updated_at ON tasks;
CREATE TRIGGER update_tasks_updated_at
    BEFORE UPDATE ON tasks
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Add comments for documentation
COMMENT ON COLUMN tasks.user_id IS 'UUID of the user who created the task';
COMMENT ON COLUMN tasks.user_email IS 'Email of the user who created the task';
COMMENT ON COLUMN tasks.created_at IS 'Timestamp when the task was created';
COMMENT ON COLUMN tasks.updated_at IS 'Timestamp when the task was last updated';

-- Update existing tasks to have system user ownership
UPDATE tasks
SET user_id = '00000000-0000-0000-0000-000000000000',
    user_email = 'system@example.com'
WHERE user_id = '00000000-0000-0000-0000-000000000000' AND user_email = 'system@example.com';

-- Create a default system user if it doesn't exist
INSERT INTO users (id, email, name, email_verified, roles, created_at, updated_at)
VALUES (
    '00000000-0000-0000-0000-000000000000',
    'system@example.com',
    'System User',
    true,
    ARRAY['admin'],
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
) ON CONFLICT (id) DO NOTHING;