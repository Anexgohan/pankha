-- Pankha Fan Control System Database Schema
-- PostgreSQL Database Schema for Multi-System Fan Control

-- Systems/Machines with Agents
CREATE TABLE IF NOT EXISTS systems (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  agent_id VARCHAR(255) UNIQUE NOT NULL,
  ip_address VARCHAR(45),
  api_endpoint VARCHAR(500),
  websocket_endpoint VARCHAR(500),
  auth_token VARCHAR(255),
  agent_version VARCHAR(50),
  status VARCHAR(50) CHECK(status IN ('online', 'offline', 'error', 'installing')) DEFAULT 'offline',
  last_seen TIMESTAMP,
  last_data_received TIMESTAMP,
  capabilities JSONB, -- JSON data for agent capabilities and hardware info
  config_data JSONB,  -- JSON data for system-specific configuration
  fan_update_interval INTEGER DEFAULT 2000, -- Fan profile controller update interval in milliseconds
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Temperature Sensors (Dynamically Detected)
CREATE TABLE IF NOT EXISTS sensors (
  id SERIAL PRIMARY KEY,
  system_id INTEGER NOT NULL,
  sensor_name VARCHAR(255) NOT NULL,        -- 'Tctl', 'temp1', 'Composite'
  sensor_label VARCHAR(255),                -- User-friendly display name
  sensor_type VARCHAR(100),                 -- 'cpu', 'gpu', 'motherboard', 'nvme', 'acpi'
  sensor_chip VARCHAR(255) NOT NULL,        -- 'k10temp-pci-00c3', 'it8628-isa-0a40'
  hwmon_path VARCHAR(500),                  -- Physical hardware path
  temp_input_path VARCHAR(500),             -- Path to temperature reading
  temp_max DECIMAL(8,2),                    -- Maximum safe temperature
  temp_crit DECIMAL(8,2),                   -- Critical temperature threshold
  current_temp DECIMAL(8,2),                -- Last recorded temperature
  detection_regex VARCHAR(500),             -- Regex pattern for parsing
  is_available BOOLEAN DEFAULT true,        -- Sensor is working/accessible
  is_primary BOOLEAN DEFAULT false,         -- Primary sensor for this type
  user_selected BOOLEAN DEFAULT false,      -- User has manually selected this sensor
  last_reading TIMESTAMP,                   -- Last successful reading
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (system_id) REFERENCES systems(id) ON DELETE CASCADE
);

-- Fan Controls with Sensor Assignments
CREATE TABLE IF NOT EXISTS fans (
  id SERIAL PRIMARY KEY,
  system_id INTEGER NOT NULL,
  fan_name VARCHAR(255) NOT NULL,
  fan_label VARCHAR(255),                   -- User-friendly display name
  fan_id INTEGER,                           -- Physical fan ID (1-5)
  pwm_path VARCHAR(500),                    -- PWM control path
  pwm_enable_path VARCHAR(500),             -- PWM enable control path
  rpm_path VARCHAR(500),                    -- RPM reading path
  primary_sensor_id INTEGER,                -- Primary sensor for this fan
  secondary_sensor_id INTEGER,              -- Optional secondary sensor
  sensor_logic VARCHAR(50) DEFAULT 'max',  -- 'max', 'avg', 'primary_only'
  min_speed INTEGER DEFAULT 0,
  max_speed INTEGER DEFAULT 100,
  current_speed INTEGER,
  current_rpm INTEGER,
  target_speed INTEGER,
  is_controllable BOOLEAN DEFAULT true,     -- Can PWM be controlled
  enabled BOOLEAN DEFAULT true,
  last_command TIMESTAMP,                   -- Last control command sent
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (system_id) REFERENCES systems(id) ON DELETE CASCADE,
  FOREIGN KEY (primary_sensor_id) REFERENCES sensors(id) ON DELETE SET NULL,
  FOREIGN KEY (secondary_sensor_id) REFERENCES sensors(id) ON DELETE SET NULL
);

-- Fan Profiles (Enhanced for Advanced Curve Management)
CREATE TABLE IF NOT EXISTS fan_profiles (
  id SERIAL PRIMARY KEY,
  system_id INTEGER,                        -- NULL for global profiles
  profile_name VARCHAR(255) NOT NULL,
  description TEXT,
  profile_type VARCHAR(50) DEFAULT 'custom', -- 'silent', 'balanced', 'performance', 'custom'
  is_global BOOLEAN DEFAULT false,          -- Can be used across systems
  is_active BOOLEAN DEFAULT false,
  created_by VARCHAR(255),                  -- User who created the profile
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (system_id) REFERENCES systems(id) ON DELETE CASCADE
);

-- Fan Curve Points (Temperature -> Speed mappings)
CREATE TABLE IF NOT EXISTS fan_curve_points (
  id SERIAL PRIMARY KEY,
  profile_id INTEGER NOT NULL,
  temperature DECIMAL(8,2) NOT NULL,        -- Temperature threshold (°C)
  fan_speed INTEGER NOT NULL,               -- Fan speed percentage (0-100)
  point_order INTEGER NOT NULL,             -- Order of points in curve
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (profile_id) REFERENCES fan_profiles(id) ON DELETE CASCADE,
  UNIQUE(profile_id, temperature),
  UNIQUE(profile_id, point_order)
);

-- Fan Profile Assignments (Which fans use which profiles)
CREATE TABLE IF NOT EXISTS fan_profile_assignments (
  id SERIAL PRIMARY KEY,
  fan_id INTEGER NOT NULL,
  profile_id INTEGER NOT NULL,
  sensor_id INTEGER,                        -- Which sensor to monitor for this assignment (regular sensor DB ID)
  sensor_identifier VARCHAR(255),           -- Special identifier like "__highest__" or "__group__<name>"
  is_active BOOLEAN DEFAULT true,
  assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (fan_id) REFERENCES fans(id) ON DELETE CASCADE,
  FOREIGN KEY (profile_id) REFERENCES fan_profiles(id) ON DELETE CASCADE,
  FOREIGN KEY (sensor_id) REFERENCES sensors(id) ON DELETE SET NULL,
  UNIQUE(fan_id, profile_id)
);

-- Fan Configurations (Independent sensor assignments for fans)
-- This table stores sensor selections independently of profile assignments
-- Allows users to select Control Sensor without requiring a Fan Profile
CREATE TABLE IF NOT EXISTS fan_configurations (
  id SERIAL PRIMARY KEY,
  fan_id INTEGER NOT NULL UNIQUE,
  sensor_id INTEGER,                        -- Regular sensor DB ID
  sensor_identifier VARCHAR(255),           -- Special identifier like "__highest__" or "__group__<name>"
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (fan_id) REFERENCES fans(id) ON DELETE CASCADE,
  FOREIGN KEY (sensor_id) REFERENCES sensors(id) ON DELETE SET NULL
);

-- Historical Monitoring Data
CREATE TABLE IF NOT EXISTS monitoring_data (
  id SERIAL PRIMARY KEY,
  system_id INTEGER NOT NULL,
  sensor_id INTEGER,
  fan_id INTEGER,
  temperature DECIMAL(8,2),
  fan_speed INTEGER,
  fan_rpm INTEGER,
  timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (system_id) REFERENCES systems(id) ON DELETE CASCADE,
  FOREIGN KEY (sensor_id) REFERENCES sensors(id) ON DELETE SET NULL,
  FOREIGN KEY (fan_id) REFERENCES fans(id) ON DELETE SET NULL
);

-- Indexes for better performance
CREATE INDEX IF NOT EXISTS idx_systems_agent_id ON systems(agent_id);
CREATE INDEX IF NOT EXISTS idx_systems_status ON systems(status);
CREATE INDEX IF NOT EXISTS idx_sensors_system_id ON sensors(system_id);
CREATE INDEX IF NOT EXISTS idx_sensors_type ON sensors(sensor_type);
CREATE INDEX IF NOT EXISTS idx_fans_system_id ON fans(system_id);
CREATE INDEX IF NOT EXISTS idx_monitoring_data_system_id ON monitoring_data(system_id);
CREATE INDEX IF NOT EXISTS idx_monitoring_data_timestamp ON monitoring_data(timestamp);
CREATE INDEX IF NOT EXISTS idx_fan_profiles_system_id ON fan_profiles(system_id);
CREATE INDEX IF NOT EXISTS idx_fan_profiles_global ON fan_profiles(is_global);
CREATE INDEX IF NOT EXISTS idx_fan_curve_points_profile_id ON fan_curve_points(profile_id);
CREATE INDEX IF NOT EXISTS idx_fan_curve_points_temperature ON fan_curve_points(temperature);
CREATE INDEX IF NOT EXISTS idx_fan_profile_assignments_fan_id ON fan_profile_assignments(fan_id);
CREATE INDEX IF NOT EXISTS idx_fan_profile_assignments_profile_id ON fan_profile_assignments(profile_id);
CREATE INDEX IF NOT EXISTS idx_fan_configurations_fan_id ON fan_configurations(fan_id);

-- Functions for updating timestamps (PostgreSQL style)
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers for updating timestamps
DROP TRIGGER IF EXISTS update_systems_timestamp ON systems;
CREATE TRIGGER update_systems_timestamp
    BEFORE UPDATE ON systems
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_sensors_timestamp ON sensors;
CREATE TRIGGER update_sensors_timestamp
    BEFORE UPDATE ON sensors
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_fans_timestamp ON fans;
CREATE TRIGGER update_fans_timestamp
    BEFORE UPDATE ON fans
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_fan_profiles_timestamp ON fan_profiles;
CREATE TRIGGER update_fan_profiles_timestamp
    BEFORE UPDATE ON fan_profiles
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Insert default fan profiles
INSERT INTO fan_profiles (id, profile_name, description, profile_type, is_global, created_by)
VALUES
(1, 'Silent', 'Prioritizes quiet operation with low fan speeds', 'silent', true, 'system'),
(2, 'Balanced', 'Balanced cooling and noise levels', 'balanced', true, 'system'),
(3, 'Performance', 'Maximum cooling with higher fan speeds', 'performance', true, 'system')
ON CONFLICT (id) DO NOTHING;

-- Reset sequence for fan_profiles to start after pre-inserted records
SELECT setval('fan_profiles_id_seq', (SELECT MAX(id) FROM fan_profiles));

-- Default curve points for Silent profile (low speeds)
INSERT INTO fan_curve_points (profile_id, temperature, fan_speed, point_order)
VALUES
(1, 30.0, 20, 1),
(1, 40.0, 25, 2),
(1, 50.0, 35, 3),
(1, 60.0, 45, 4),
(1, 70.0, 60, 5),
(1, 80.0, 80, 6)
ON CONFLICT (profile_id, temperature) DO NOTHING;

-- Default curve points for Balanced profile (moderate speeds)
INSERT INTO fan_curve_points (profile_id, temperature, fan_speed, point_order)
VALUES
(2, 30.0, 25, 1),
(2, 40.0, 30, 2),
(2, 50.0, 45, 3),
(2, 60.0, 60, 4),
(2, 70.0, 75, 5),
(2, 80.0, 90, 6)
ON CONFLICT (profile_id, temperature) DO NOTHING;

-- Default curve points for Performance profile (high speeds)
INSERT INTO fan_curve_points (profile_id, temperature, fan_speed, point_order)
VALUES
(3, 30.0, 40, 1),
(3, 40.0, 50, 2),
(3, 50.0, 65, 3),
(3, 60.0, 75, 4),
(3, 70.0, 85, 5),
(3, 80.0, 100, 6)
ON CONFLICT (profile_id, temperature) DO NOTHING;

-- Backend Settings (Global Configuration)
CREATE TABLE IF NOT EXISTS backend_settings (
  id SERIAL PRIMARY KEY,
  setting_key VARCHAR(255) UNIQUE NOT NULL,
  setting_value TEXT NOT NULL,
  description TEXT,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Trigger for backend_settings timestamp
DROP TRIGGER IF EXISTS update_backend_settings_timestamp ON backend_settings;
CREATE TRIGGER update_backend_settings_timestamp
    BEFORE UPDATE ON backend_settings
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Insert default controller interval setting (2000ms = 2 seconds)
INSERT INTO backend_settings (setting_key, setting_value, description)
VALUES ('controller_update_interval', '2000', 'Fan Profile Controller update interval in milliseconds')
ON CONFLICT (setting_key) DO NOTHING;

-- Create index for faster setting lookups
CREATE INDEX IF NOT EXISTS idx_backend_settings_key ON backend_settings(setting_key);
