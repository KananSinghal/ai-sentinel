CREATE EXTENSION IF NOT EXISTS timescaledb;
CREATE EXTENSION IF NOT EXISTS earthdistance;
CREATE EXTENSION IF NOT EXISTS cube;

CREATE TABLE disaster_events (
    id BIGSERIAL PRIMARY KEY,
    timestamp TIMESTAMPTZ NOT NULL,
    event_type VARCHAR(50) NOT NULL,
    latitude DECIMAL(9, 6) NOT NULL,
    longitude DECIMAL(9, 6) NOT NULL,
    severity VARCHAR(20) NOT NULL,
    description TEXT,
    confidence DECIMAL(3, 2),
    metadata JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

SELECT create_hypertable('disaster_events', 'timestamp', if_not_exists => TRUE);

CREATE INDEX idx_disasters_event_type ON disaster_events(event_type, timestamp DESC);
CREATE INDEX idx_disasters_severity ON disaster_events(severity, timestamp DESC);
CREATE INDEX idx_disasters_location ON disaster_events USING GIST(ll_to_earth(latitude, longitude));

CREATE MATERIALIZED VIEW disaster_events_hourly
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('1 hour', timestamp) AS hour,
    event_type,
    COUNT(*) as event_count,
    AVG(confidence) as avg_confidence
FROM disaster_events
GROUP BY hour, event_type;
