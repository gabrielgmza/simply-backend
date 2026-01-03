-- Simply Backend v3.8.0 - Security Tables Migration
-- Run with: psql -h host -U user -d simply -f 20250103_add_security_tables.sql

-- Trust Scores
CREATE TABLE IF NOT EXISTS trust_scores (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    score INTEGER NOT NULL,
    tier VARCHAR(20) NOT NULL,
    identity_score INTEGER NOT NULL,
    financial_score INTEGER NOT NULL,
    behavioral_score INTEGER NOT NULL,
    transactional_score INTEGER NOT NULL,
    social_score INTEGER NOT NULL,
    calculated_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_trust_scores_user ON trust_scores(user_id);
CREATE INDEX IF NOT EXISTS idx_trust_scores_tier ON trust_scores(tier);

-- User Devices
CREATE TABLE IF NOT EXISTS user_devices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    fingerprint VARCHAR(64) NOT NULL,
    platform VARCHAR(20) NOT NULL,
    os_version VARCHAR(50),
    device_model VARCHAR(100),
    app_version VARCHAR(20),
    screen_resolution VARCHAR(20),
    timezone VARCHAR(50),
    language VARCHAR(10),
    trust_level VARCHAR(20) DEFAULT 'NEW',
    first_seen_at TIMESTAMP DEFAULT NOW(),
    last_seen_at TIMESTAMP DEFAULT NOW(),
    last_ip VARCHAR(45),
    login_count INTEGER DEFAULT 0,
    successful_ops INTEGER DEFAULT 0,
    failed_ops INTEGER DEFAULT 0,
    is_emulator BOOLEAN DEFAULT FALSE,
    is_rooted BOOLEAN DEFAULT FALSE,
    is_blocked BOOLEAN DEFAULT FALSE,
    blocked_reason TEXT,
    blocked_at TIMESTAMP,
    trusted_at TIMESTAMP,
    metadata JSONB,
    UNIQUE(user_id, fingerprint)
);
CREATE INDEX IF NOT EXISTS idx_user_devices_user ON user_devices(user_id);

-- Risk Assessments
CREATE TABLE IF NOT EXISTS risk_assessments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    session_id VARCHAR(100) NOT NULL,
    operation VARCHAR(50) NOT NULL,
    risk_score INTEGER NOT NULL,
    risk_level VARCHAR(20) NOT NULL,
    required_action VARCHAR(30) NOT NULL,
    risk_factors JSONB NOT NULL,
    ip_address VARCHAR(45) NOT NULL,
    device_fingerprint VARCHAR(64),
    amount DECIMAL(18,2),
    challenge_completed BOOLEAN DEFAULT FALSE,
    completed_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_risk_assess_user ON risk_assessments(user_id);

-- IP Blacklist
CREATE TABLE IF NOT EXISTS ip_blacklist (
    ip_address VARCHAR(45) PRIMARY KEY,
    reason TEXT NOT NULL,
    source VARCHAR(30) NOT NULL,
    added_by UUID,
    added_at TIMESTAMP DEFAULT NOW(),
    expires_at TIMESTAMP,
    hit_count INTEGER DEFAULT 0,
    last_hit_at TIMESTAMP
);

-- Flagged Accounts
CREATE TABLE IF NOT EXISTS flagged_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cvu VARCHAR(22) UNIQUE NOT NULL,
    alias VARCHAR(50),
    reason TEXT NOT NULL,
    risk_level VARCHAR(20) NOT NULL,
    source VARCHAR(30) NOT NULL,
    flagged_by UUID,
    flagged_at TIMESTAMP DEFAULT NOW(),
    expires_at TIMESTAMP,
    metadata JSONB
);

-- Employee Anomalies
CREATE TABLE IF NOT EXISTS employee_anomalies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID NOT NULL,
    anomaly_type VARCHAR(50) NOT NULL,
    severity VARCHAR(20) NOT NULL,
    description TEXT NOT NULL,
    details JSONB,
    baseline JSONB,
    actual JSONB,
    deviation_percent FLOAT,
    ip_address VARCHAR(45) NOT NULL,
    user_agent TEXT,
    session_id VARCHAR(100),
    status VARCHAR(20) DEFAULT 'DETECTED',
    actions_taken JSONB,
    detected_at TIMESTAMP DEFAULT NOW(),
    resolved_at TIMESTAMP,
    resolved_by UUID,
    resolution_notes TEXT
);
CREATE INDEX IF NOT EXISTS idx_emp_anomalies_emp ON employee_anomalies(employee_id);

-- Employee Baselines
CREATE TABLE IF NOT EXISTS employee_baselines (
    employee_id UUID PRIMARY KEY,
    normal_work_hours JSONB NOT NULL,
    normal_work_days JSONB NOT NULL,
    avg_daily_actions FLOAT DEFAULT 0,
    avg_daily_data_access FLOAT DEFAULT 0,
    avg_daily_approvals FLOAT DEFAULT 0,
    avg_daily_exports FLOAT DEFAULT 0,
    assigned_client_ids JSONB DEFAULT '[]',
    avg_clients_accessed_daily FLOAT DEFAULT 0,
    known_ips JSONB DEFAULT '[]',
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Employee Notifications
CREATE TABLE IF NOT EXISTS employee_notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID NOT NULL,
    title VARCHAR(200) NOT NULL,
    body TEXT NOT NULL,
    type VARCHAR(50) NOT NULL,
    priority VARCHAR(20) DEFAULT 'MEDIUM',
    data JSONB,
    read BOOLEAN DEFAULT FALSE,
    read_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_emp_notif_emp ON employee_notifications(employee_id);

-- User Behavior Profiles
CREATE TABLE IF NOT EXISTS user_behavior_profiles (
    user_id UUID PRIMARY KEY,
    temporal JSONB NOT NULL,
    transactional JSONB NOT NULL,
    navigation JSONB NOT NULL,
    device JSONB NOT NULL,
    risk_indicators JSONB NOT NULL,
    segment VARCHAR(30) NOT NULL,
    profile_version INTEGER DEFAULT 1,
    data_points INTEGER DEFAULT 0,
    updated_at TIMESTAMP DEFAULT NOW()
);

-- User Analytics Events
CREATE TABLE IF NOT EXISTS user_analytics_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    event_type VARCHAR(50) NOT NULL,
    event_data JSONB,
    session_id VARCHAR(100),
    device_fingerprint VARCHAR(64),
    created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_analytics_user ON user_analytics_events(user_id);

-- Fraud Evaluations
CREATE TABLE IF NOT EXISTS fraud_evaluations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    transaction_id UUID,
    fraud_score INTEGER NOT NULL,
    risk_level VARCHAR(20) NOT NULL,
    confidence INTEGER NOT NULL,
    decision VARCHAR(30) NOT NULL,
    decision_reason TEXT NOT NULL,
    risk_factors JSONB NOT NULL,
    positive_factors JSONB NOT NULL,
    model_version VARCHAR(20) NOT NULL,
    model_scores JSONB NOT NULL,
    recommendations JSONB NOT NULL,
    context JSONB NOT NULL,
    processing_time_ms INTEGER NOT NULL,
    evaluated_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_fraud_eval_user ON fraud_evaluations(user_id);

-- Alerts
CREATE TABLE IF NOT EXISTS alerts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    category VARCHAR(30) NOT NULL,
    priority VARCHAR(20) NOT NULL,
    title VARCHAR(200) NOT NULL,
    message TEXT NOT NULL,
    target_type VARCHAR(20) NOT NULL,
    target_id UUID,
    target_role VARCHAR(30),
    source VARCHAR(50) NOT NULL,
    source_id UUID,
    data JSONB,
    action_url VARCHAR(500),
    channels JSONB NOT NULL,
    status VARCHAR(20) DEFAULT 'PENDING',
    escalation_level INTEGER DEFAULT 0,
    escalate_after_minutes INTEGER,
    escalate_to VARCHAR(100),
    created_at TIMESTAMP DEFAULT NOW(),
    sent_at TIMESTAMP,
    read_at TIMESTAMP,
    read_by UUID,
    actioned_at TIMESTAMP,
    actioned_by UUID,
    action_taken TEXT,
    expires_at TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_alerts_status ON alerts(status);

-- Alert Webhooks
CREATE TABLE IF NOT EXISTS alert_webhooks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    url VARCHAR(500) NOT NULL,
    secret VARCHAR(100),
    enabled BOOLEAN DEFAULT TRUE,
    categories JSONB NOT NULL,
    priorities JSONB NOT NULL,
    created_by UUID NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- System Settings
CREATE TABLE IF NOT EXISTS system_settings (
    key VARCHAR(100) PRIMARY KEY,
    value JSONB NOT NULL,
    description TEXT,
    category VARCHAR(50),
    updated_by UUID,
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Referrals
CREATE TABLE IF NOT EXISTS referrals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    referrer_id UUID NOT NULL,
    referred_id UUID NOT NULL,
    code VARCHAR(20) UNIQUE NOT NULL,
    status VARCHAR(20) DEFAULT 'PENDING',
    reward_amount DECIMAL(18,2),
    reward_paid BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT NOW(),
    completed_at TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals(referrer_id);

SELECT 'Security tables migration completed' as status;
