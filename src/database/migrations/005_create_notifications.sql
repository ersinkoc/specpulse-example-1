-- Migration: Create notifications system tables
-- Description: Creates tables for real-time notifications system

-- Create notifications table
CREATE TABLE IF NOT EXISTS notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    category VARCHAR(50) NOT NULL,
    type VARCHAR(100),
    priority VARCHAR(20) NOT NULL DEFAULT 'medium',
    data JSONB DEFAULT '{}'::jsonb,
    expires_at TIMESTAMP,
    read_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create user notification preferences table
CREATE TABLE IF NOT EXISTS user_notification_preferences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    category_preferences JSONB DEFAULT '{
        "security": {"enabled": true, "websocket": true, "email": true, "quiet_hours": false},
        "system": {"enabled": true, "websocket": true, "email": false, "quiet_hours": true},
        "social": {"enabled": true, "websocket": true, "email": false, "quiet_hours": true},
        "task": {"enabled": true, "websocket": true, "email": true, "quiet_hours": false},
        "administrative": {"enabled": true, "websocket": true, "email": true, "quiet_hours": false}
    }'::jsonb,
    priority_preferences JSONB DEFAULT '{
        "low": {"websocket": false, "email": false},
        "medium": {"websocket": true, "email": false},
        "high": {"websocket": true, "email": true},
        "critical": {"websocket": true, "email": true}
    }'::jsonb,
    quiet_hours_enabled BOOLEAN DEFAULT FALSE,
    quiet_hours_start TIME DEFAULT '22:00:00',
    quiet_hours_end TIME DEFAULT '08:00:00',
    quiet_hours_timezone VARCHAR(50) DEFAULT 'UTC',
    max_notifications_per_hour INTEGER DEFAULT 50,
    group_similar_notifications BOOLEAN DEFAULT TRUE,
    sound_enabled BOOLEAN DEFAULT TRUE,
    vibration_enabled BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create notification delivery tracking table
CREATE TABLE IF NOT EXISTS notification_delivery (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    notification_id UUID NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
    channel VARCHAR(50) NOT NULL, -- 'websocket', 'email', 'sms', etc.
    status VARCHAR(20) NOT NULL DEFAULT 'pending', -- 'pending', 'sent', 'delivered', 'failed', 'expired'
    sent_at TIMESTAMP,
    delivered_at TIMESTAMP,
    failure_reason TEXT,
    retry_count INTEGER DEFAULT 0,
    max_retries INTEGER DEFAULT 3,
    next_retry_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create notification actions table
CREATE TABLE IF NOT EXISTS notification_actions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    notification_id UUID NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
    action_id VARCHAR(100) NOT NULL,
    label VARCHAR(255) NOT NULL,
    url VARCHAR(500),
    action_type VARCHAR(50) NOT NULL, -- 'navigate', 'confirm', 'dismiss', 'api_call'
    style VARCHAR(20) DEFAULT 'primary', -- 'primary', 'secondary', 'danger', 'warning'
    action_data JSONB DEFAULT '{}'::jsonb,
    clicked_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create notification templates table (for admin use)
CREATE TABLE IF NOT EXISTS notification_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) UNIQUE NOT NULL,
    category VARCHAR(50) NOT NULL,
    type VARCHAR(100) NOT NULL,
    priority VARCHAR(20) NOT NULL DEFAULT 'medium',
    title_template TEXT NOT NULL,
    message_template TEXT NOT NULL,
    default_actions JSONB DEFAULT '[]'::jsonb,
    variables JSONB DEFAULT '{}'::jsonb, -- Template variables and their descriptions
    is_active BOOLEAN DEFAULT TRUE,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create notification statistics table
CREATE TABLE IF NOT EXISTS notification_statistics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    date DATE NOT NULL,
    category VARCHAR(50) NOT NULL,
    priority VARCHAR(20) NOT NULL,
    total_sent INTEGER DEFAULT 0,
    total_delivered INTEGER DEFAULT 0,
    total_read INTEGER DEFAULT 0,
    total_failed INTEGER DEFAULT 0,
    websocket_delivered INTEGER DEFAULT 0,
    email_delivered INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(date, category, priority)
);

-- Create indexes for notifications table
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_category ON notifications(category);
CREATE INDEX IF NOT EXISTS idx_notifications_priority ON notifications(priority);
CREATE INDEX IF NOT EXISTS idx_notifications_read_at ON notifications(read_at);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at);
CREATE INDEX IF NOT EXISTS idx_notifications_expires_at ON notifications(expires_at);
CREATE INDEX IF NOT EXISTS idx_notifications_user_category ON notifications(user_id, category);
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON notifications(user_id, read_at) WHERE read_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_notifications_type ON notifications(type);

-- Create GIN index for notification data
CREATE INDEX IF NOT EXISTS idx_notifications_data ON notifications USING GIN(data);

-- Create indexes for user preferences table
CREATE INDEX IF NOT EXISTS idx_user_notification_preferences_user_id ON user_notification_preferences(user_id);

-- Create indexes for delivery tracking table
CREATE INDEX IF NOT EXISTS idx_notification_delivery_notification_id ON notification_delivery(notification_id);
CREATE INDEX IF NOT EXISTS idx_notification_delivery_status ON notification_delivery(status);
CREATE INDEX IF NOT EXISTS idx_notification_delivery_channel ON notification_delivery(channel);
CREATE INDEX IF NOT EXISTS idx_notification_delivery_next_retry ON notification_delivery(next_retry_at) WHERE status = 'failed';
CREATE INDEX IF NOT EXISTS idx_notification_delivery_created_at ON notification_delivery(created_at);

-- Create indexes for notification actions table
CREATE INDEX IF NOT EXISTS idx_notification_actions_notification_id ON notification_actions(notification_id);
CREATE INDEX IF NOT EXISTS idx_notification_actions_clicked_at ON notification_actions(clicked_at);

-- Create indexes for notification templates table
CREATE INDEX IF NOT EXISTS idx_notification_templates_category ON notification_templates(category);
CREATE INDEX IF NOT EXISTS idx_notification_templates_type ON notification_templates(type);
CREATE INDEX IF NOT EXISTS idx_notification_templates_is_active ON notification_templates(is_active);

-- Create indexes for statistics table
CREATE INDEX IF NOT EXISTS idx_notification_statistics_date ON notification_statistics(date);
CREATE INDEX IF NOT EXISTS idx_notification_statistics_category ON notification_statistics(category);

-- Add constraints for notifications table
ALTER TABLE notifications ADD CONSTRAINT chk_notifications_category
    CHECK (category IN ('security', 'system', 'social', 'task', 'administrative'));

ALTER TABLE notifications ADD CONSTRAINT chk_notifications_priority
    CHECK (priority IN ('low', 'medium', 'high', 'critical'));

ALTER TABLE notifications ADD CONSTRAINT chk_notifications_title_not_empty
    CHECK (LENGTH(TRIM(title)) > 0);

ALTER TABLE notifications ADD CONSTRAINT chk_notifications_message_not_empty
    CHECK (LENGTH(TRIM(message)) > 0);

-- Add constraints for delivery tracking table
ALTER TABLE notification_delivery ADD CONSTRAINT chk_notification_delivery_channel
    CHECK (channel IN ('websocket', 'email', 'sms', 'push', 'webhook'));

ALTER TABLE notification_delivery ADD CONSTRAINT chk_notification_delivery_status
    CHECK (status IN ('pending', 'sent', 'delivered', 'failed', 'expired'));

ALTER TABLE notification_delivery ADD CONSTRAINT chk_notification_delivery_retry_count
    CHECK (retry_count >= 0 AND retry_count <= max_retries);

-- Add constraints for notification actions table
ALTER TABLE notification_actions ADD CONSTRAINT chk_notification_actions_action_type
    CHECK (action_type IN ('navigate', 'confirm', 'dismiss', 'api_call', 'download'));

ALTER TABLE notification_actions ADD CONSTRAINT chk_notification_actions_style
    CHECK (style IN ('primary', 'secondary', 'danger', 'warning', 'success', 'info'));

-- Add constraints for user preferences table
ALTER TABLE user_notification_preferences ADD CONSTRAINT chk_user_notification_preferences_max_notifications
    CHECK (max_notifications_per_hour > 0 AND max_notifications_per_hour <= 1000);

-- Add constraints for templates table
ALTER TABLE notification_templates ADD CONSTRAINT chk_notification_templates_category
    CHECK (category IN ('security', 'system', 'social', 'task', 'administrative'));

ALTER TABLE notification_templates ADD CONSTRAINT chk_notification_templates_priority
    CHECK (priority IN ('low', 'medium', 'high', 'critical'));

ALTER TABLE notification_templates ADD CONSTRAINT chk_notification_templates_name_not_empty
    CHECK (LENGTH(TRIM(name)) > 0);

-- Add constraints for statistics table
ALTER TABLE notification_statistics ADD CONSTRAINT chk_notification_statistics_totals
    CHECK (
        total_sent >= 0 AND
        total_delivered >= 0 AND
        total_read >= 0 AND
        total_failed >= 0 AND
        websocket_delivered >= 0 AND
        email_delivered >= 0
    );

-- Create trigger to update updated_at timestamp for notifications
CREATE TRIGGER update_notifications_updated_at
    BEFORE UPDATE ON notifications
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Create trigger to update updated_at timestamp for user preferences
CREATE TRIGGER update_user_notification_preferences_updated_at
    BEFORE UPDATE ON user_notification_preferences
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Create trigger to update updated_at timestamp for delivery tracking
CREATE TRIGGER update_notification_delivery_updated_at
    BEFORE UPDATE ON notification_delivery
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Create trigger to update updated_at timestamp for templates
CREATE TRIGGER update_notification_templates_updated_at
    BEFORE UPDATE ON notification_templates
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Create trigger to update updated_at timestamp for statistics
CREATE TRIGGER update_notification_statistics_updated_at
    BEFORE UPDATE ON notification_statistics
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Create function to automatically delete expired notifications
CREATE OR REPLACE FUNCTION cleanup_expired_notifications()
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM notifications
    WHERE expires_at IS NOT NULL AND expires_at < CURRENT_TIMESTAMP;

    GET DIAGNOSTICS deleted_count = ROW_COUNT;

    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Create function to update notification statistics
CREATE OR REPLACE FUNCTION update_notification_statistics()
RETURNS VOID AS $$
BEGIN
    INSERT INTO notification_statistics (
        date,
        category,
        priority,
        total_sent,
        total_delivered,
        total_read,
        total_failed,
        websocket_delivered,
        email_delivered
    )
    SELECT
        CURRENT_DATE - INTERVAL '1 day' as date,
        n.category,
        n.priority,
        COUNT(*) as total_sent,
        COUNT(CASE WHEN nd.status = 'delivered' THEN 1 END) as total_delivered,
        COUNT(CASE WHEN n.read_at IS NOT NULL THEN 1 END) as total_read,
        COUNT(CASE WHEN nd.status = 'failed' THEN 1 END) as total_failed,
        COUNT(CASE WHEN nd.channel = 'websocket' AND nd.status = 'delivered' THEN 1 END) as websocket_delivered,
        COUNT(CASE WHEN nd.channel = 'email' AND nd.status = 'delivered' THEN 1 END) as email_delivered
    FROM notifications n
    LEFT JOIN notification_delivery nd ON n.id = nd.notification_id
    WHERE DATE(n.created_at) = CURRENT_DATE - INTERVAL '1 day'
    GROUP BY n.category, n.priority
    ON CONFLICT (date, category, priority)
    DO UPDATE SET
        total_sent = EXCLUDED.total_sent,
        total_delivered = EXCLUDED.total_delivered,
        total_read = EXCLUDED.total_read,
        total_failed = EXCLUDED.total_failed,
        websocket_delivered = EXCLUDED.websocket_delivered,
        email_delivered = EXCLUDED.email_delivered,
        updated_at = CURRENT_TIMESTAMP;
END;
$$ LANGUAGE plpgsql;

-- Add comments for documentation
COMMENT ON TABLE notifications IS 'Main notifications table storing all user notifications';
COMMENT ON COLUMN notifications.id IS 'Primary key UUID';
COMMENT ON COLUMN notifications.user_id IS 'Foreign key to users table';
COMMENT ON COLUMN notifications.title IS 'Notification title';
COMMENT ON COLUMN notifications.message IS 'Notification message content';
COMMENT ON COLUMN notifications.category IS 'Notification category (security, system, social, task, administrative)';
COMMENT ON COLUMN notifications.type IS 'Specific notification type';
COMMENT ON COLUMN notifications.priority IS 'Priority level (low, medium, high, critical)';
COMMENT ON COLUMN notifications.data IS 'Additional notification data as JSONB';
COMMENT ON COLUMN notifications.expires_at IS 'Expiration timestamp for notification';
COMMENT ON COLUMN notifications.read_at IS 'When notification was marked as read';

COMMENT ON TABLE user_notification_preferences IS 'User notification preferences and settings';
COMMENT ON COLUMN user_notification_preferences.category_preferences IS 'Per-category notification preferences';
COMMENT ON COLUMN user_notification_preferences.priority_preferences IS 'Per-priority notification preferences';
COMMENT ON COLUMN user_notification_preferences.quiet_hours_enabled IS 'Whether quiet hours are enabled';
COMMENT ON COLUMN user_notification_preferences.quiet_hours_start IS 'Quiet hours start time';
COMMENT ON COLUMN user_notification_preferences.quiet_hours_end IS 'Quiet hours end time';

COMMENT ON TABLE notification_delivery IS 'Notification delivery tracking across different channels';
COMMENT ON COLUMN notification_delivery.channel IS 'Delivery channel (websocket, email, sms, push, webhook)';
COMMENT ON COLUMN notification_delivery.status IS 'Delivery status (pending, sent, delivered, failed, expired)';
COMMENT ON COLUMN notification_delivery.retry_count IS 'Number of retry attempts';
COMMENT ON COLUMN notification_delivery.next_retry_at IS 'Next retry timestamp';

COMMENT ON TABLE notification_actions IS 'Actions associated with notifications';
COMMENT ON COLUMN notification_actions.action_type IS 'Type of action (navigate, confirm, dismiss, api_call)';
COMMENT ON COLUMN notification_actions.clicked_at IS 'When action was clicked';

COMMENT ON TABLE notification_templates IS 'Notification templates for administrative use';
COMMENT ON COLUMN notification_templates.title_template IS 'Template for notification title with variables';
COMMENT ON COLUMN notification_templates.message_template IS 'Template for notification message with variables';

COMMENT ON TABLE notification_statistics IS 'Daily notification statistics for reporting';
COMMENT ON COLUMN notification_statistics.total_sent IS 'Total notifications sent';
COMMENT ON COLUMN notification_statistics.total_delivered IS 'Total notifications delivered';
COMMENT ON COLUMN notification_statistics.total_read IS 'Total notifications read';
COMMENT ON COLUMN notification_statistics.total_failed IS 'Total notifications failed';

-- Insert default notification templates
INSERT INTO notification_templates (name, category, type, priority, title_template, message_template, default_actions) VALUES
('login_success', 'security', 'login_success', 'low', 'Successful Login', 'You have successfully logged in to your account', '[
    {
        "action_id": "dismiss",
        "label": "Dismiss",
        "action_type": "dismiss",
        "style": "secondary"
    }
]'),
('login_failed', 'security', 'login_failed', 'high', 'Failed Login Attempt', 'There was a failed login attempt on your account', '[
    {
        "action_id": "review_account",
        "label": "Review Account",
        "action_type": "navigate",
        "url": "/security/recent-activity",
        "style": "primary"
    },
    {
        "action_id": "dismiss",
        "label": "Dismiss",
        "action_type": "dismiss",
        "style": "secondary"
    }
]'),
('system_maintenance', 'system', 'system_maintenance', 'medium', 'Scheduled Maintenance', 'System maintenance is scheduled for {{scheduled_time}}', '[
    {
        "action_id": "view_details",
        "label": "View Details",
        "action_type": "navigate",
        "url": "/system/maintenance",
        "style": "primary"
    }
]'),
('task_assigned', 'task', 'task_assigned', 'medium', 'New Task Assigned', 'You have been assigned a new task: {{task_title}}', '[
    {
        "action_id": "view_task",
        "label": "View Task",
        "action_type": "navigate",
        "url": "/tasks/{{task_id}}",
        "style": "primary"
    }
]') ON CONFLICT (name) DO NOTHING;