-- Security Audit System Database Schema
-- Migration 001: Create security tables with audit capabilities

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Audit logs table with time-series capabilities
CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    event_type VARCHAR(50) NOT NULL,
    event_subtype VARCHAR(50) NOT NULL,
    user_id VARCHAR(255),
    ip_address INET,
    user_agent TEXT,
    method VARCHAR(10),
    url TEXT,
    status_code INTEGER,
    response_time INTEGER,
    severity VARCHAR(20) NOT NULL CHECK (severity IN ('debug', 'info', 'warning', 'error', 'critical')),
    message TEXT NOT NULL,
    metadata JSONB,
    signature_hash VARCHAR(128), -- Cryptographic signature for integrity
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    INDEX idx_audit_logs_timestamp (timestamp),
    INDEX idx_audit_logs_user_id (user_id),
    INDEX idx_audit_logs_severity (severity),
    INDEX idx_audit_logs_event_type (event_type),
    INDEX idx_audit_logs_timestamp_type (timestamp, event_type)
);

-- Create partition for audit logs by month (time-series optimization)
CREATE TABLE audit_logs_y2024m12 PARTITION OF audit_logs
    FOR VALUES FROM ('2024-12-01') TO ('2025-01-01');

-- Vulnerabilities table
CREATE TABLE vulnerabilities (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    severity VARCHAR(20) NOT NULL CHECK (severity IN ('info', 'low', 'medium', 'high', 'critical')),
    cvss_score DECIMAL(3,1),
    cve VARCHAR(20),
    affected_component VARCHAR(100),
    version_affected VARCHAR(50),
    version_fixed VARCHAR(50),
    scanner VARCHAR(50),
    discovered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    status VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved', 'false_positive', 'wont_fix')),
    resolved_at TIMESTAMPTZ,
    resolved_by VARCHAR(255),
    remediation_steps TEXT,
    references JSONB,
    metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    INDEX idx_vulnerabilities_severity (severity),
    INDEX idx_vulnerabilities_status (status),
    INDEX idx_vulnerabilities_discovered_at (discovered_at),
    INDEX idx_vulnerabilities_component (affected_component)
);

-- Security incidents table
CREATE TABLE security_incidents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title VARCHAR(255) NOT NULL,
    description TEXT NOT NULL,
    severity VARCHAR(20) NOT NULL CHECK (severity IN ('info', 'low', 'medium', 'high', 'critical')),
    status VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'investigating', 'contained', 'resolved', 'closed')),
    incident_type VARCHAR(50) NOT NULL,
    source VARCHAR(100),
    affected_assets JSONB,
    impact_assessment TEXT,
    detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    reported_by VARCHAR(255),
    assigned_to VARCHAR(255),
    resolved_at TIMESTAMPTZ,
    resolution_summary TEXT,
    lessons_learned TEXT,
    related_events JSONB, -- Array of related audit log IDs
    metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    INDEX idx_security_incidents_severity (severity),
    INDEX idx_security_incidents_status (status),
    INDEX idx_security_incidents_detected_at (detected_at),
    INDEX idx_security_incidents_type (incident_type)
);

-- Compliance reports table
CREATE TABLE compliance_reports (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    framework VARCHAR(50) NOT NULL, -- GDPR, SOC2, ISO27001, etc.
    report_type VARCHAR(50) NOT NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'completed', 'failed', 'cancelled')),
    compliance_score DECIMAL(5,2), -- 0-100 percentage
    controls_assessed INTEGER,
    controls_passed INTEGER,
    controls_failed INTEGER,
    findings JSONB,
    recommendations JSONB,
    evidence_files JSONB,
    generated_by VARCHAR(255),
    approved_by VARCHAR(255),
    approved_at TIMESTAMPTZ,
    metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    INDEX idx_compliance_reports_framework (framework),
    INDEX idx_compliance_reports_period (period_start, period_end),
    INDEX idx_compliance_reports_status (status)
);

-- Security policies table
CREATE TABLE security_policies (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL UNIQUE,
    description TEXT,
    category VARCHAR(50) NOT NULL, -- authentication, authorization, data_protection, etc.
    policy_type VARCHAR(50) NOT NULL, -- rule, guideline, standard, procedure
    severity VARCHAR(20) NOT NULL CHECK (severity IN ('info', 'low', 'medium', 'high', 'critical')),
    status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'deprecated')),
    rules JSONB NOT NULL, -- Policy rules and conditions
    enforcement_mode VARCHAR(20) NOT NULL DEFAULT 'audit' CHECK (enforcement_mode IN ('audit', 'warn', 'block')),
    violations JSONB, -- Track policy violations
    created_by VARCHAR(255),
    approved_by VARCHAR(255),
    version INTEGER NOT NULL DEFAULT 1,
    effective_date DATE,
    expiry_date DATE,
    metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    INDEX idx_security_policies_category (category),
    INDEX idx_security_policies_status (status),
    INDEX idx_security_policies_effective_date (effective_date)
);

-- Security metrics table for analytics
CREATE TABLE security_metrics (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    metric_name VARCHAR(100) NOT NULL,
    metric_type VARCHAR(50) NOT NULL, -- counter, gauge, histogram, etc.
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    value DECIMAL(15,6) NOT NULL,
    unit VARCHAR(20), -- count, percentage, milliseconds, etc.
    tags JSONB, -- Additional dimensions for filtering
    metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    INDEX idx_security_metrics_name_timestamp (metric_name, timestamp),
    INDEX idx_security_metrics_timestamp (timestamp),
    INDEX idx_security_metrics_tags USING GIN (tags)
);

-- Security alerts table
CREATE TABLE security_alerts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    alert_type VARCHAR(50) NOT NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    severity VARCHAR(20) NOT NULL CHECK (severity IN ('info', 'low', 'medium', 'high', 'critical')),
    status VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'acknowledged', 'investigating', 'resolved', 'closed', 'false_positive')),
    source VARCHAR(100),
    rule_id UUID REFERENCES security_policies(id),
    incident_id UUID REFERENCES security_incidents(id),
    trigger_event JSONB, -- Event that triggered the alert
    context JSONB, -- Additional context data
    assigned_to VARCHAR(255),
    acknowledged_at TIMESTAMPTZ,
    acknowledged_by VARCHAR(255),
    resolved_at TIMESTAMPTZ,
    resolved_by VARCHAR(255),
    resolution_notes TEXT,
    metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    INDEX idx_security_alerts_severity (severity),
    INDEX idx_security_alerts_status (status),
    INDEX idx_security_alerts_created_at (created_at),
    INDEX idx_security_alerts_type (alert_type)
);

-- Create trigger for updating updated_at timestamps
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply triggers to tables with updated_at columns
CREATE TRIGGER update_vulnerabilities_updated_at BEFORE UPDATE ON vulnerabilities FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_security_incidents_updated_at BEFORE UPDATE ON security_incidents FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_compliance_reports_updated_at BEFORE UPDATE ON compliance_reports FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_security_policies_updated_at BEFORE UPDATE ON security_policies FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_security_alerts_updated_at BEFORE UPDATE ON security_alerts FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Create function for audit log integrity verification
CREATE OR REPLACE FUNCTION verify_audit_log_integrity(log_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
    stored_hash VARCHAR(128);
    computed_hash VARCHAR(128);
    log_data TEXT;
BEGIN
    -- Get stored hash and log data
    SELECT signature_hash,
           timestamp::TEXT || event_type || event_subtype ||
           COALESCE(user_id, '') || COALESCE(ip_address::TEXT, '') ||
           COALESCE(user_agent, '') || COALESCE(method, '') ||
           COALESCE(url, '') || COALESCE(status_code::TEXT, '') ||
           COALESCE(response_time::TEXT, '') || severity || message ||
           COALESCE(metadata::TEXT, '')
    INTO stored_hash, log_data
    FROM audit_logs
    WHERE id = log_id;

    -- Compute hash using SHA-256
    SELECT encode(digest(log_data, 'sha256'), 'hex')
    INTO computed_hash;

    -- Compare hashes
    RETURN stored_hash = computed_hash;
END;
$$ LANGUAGE plpgsql;

-- Create view for security dashboard
CREATE VIEW security_dashboard AS
SELECT
    (SELECT COUNT(*) FROM audit_logs WHERE timestamp >= NOW() - INTERVAL '24 hours') as events_last_24h,
    (SELECT COUNT(*) FROM security_incidents WHERE status IN ('open', 'investigating')) as active_incidents,
    (SELECT COUNT(*) FROM vulnerabilities WHERE status = 'open') as open_vulnerabilities,
    (SELECT AVG(compliance_score) FROM compliance_reports WHERE status = 'completed' AND period_end >= NOW() - INTERVAL '30 days') as avg_compliance_score,
    (SELECT COUNT(*) FROM security_alerts WHERE status = 'open') as open_alerts;

-- Grant permissions (adjust based on your security requirements)
-- REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
-- GRANT SELECT ON security_dashboard TO security_reader;
-- GRANT SELECT, INSERT ON audit_logs TO audit_writer;
-- GRANT SELECT, INSERT, UPDATE ON security_incidents TO incident_manager;
-- GRANT SELECT, INSERT, UPDATE ON vulnerabilities TO vulnerability_scanner;

-- Add comments for documentation
COMMENT ON TABLE audit_logs IS 'Tamper-proof audit log with cryptographic integrity verification';
COMMENT ON TABLE vulnerabilities IS 'Security vulnerabilities discovered through scanning and assessment';
COMMENT ON TABLE security_incidents IS 'Security incidents with lifecycle management';
COMMENT ON TABLE compliance_reports IS 'Compliance reports for various frameworks (GDPR, SOC2, etc.)';
COMMENT ON TABLE security_policies IS 'Security policies and rules for enforcement';
COMMENT ON TABLE security_metrics IS 'Time-series security metrics for analytics and monitoring';
COMMENT ON TABLE security_alerts IS 'Security alerts generated from policy violations and threat detection';