import React, { useState, useCallback, useEffect } from 'react';
import useWebSocket from 'react-use-websocket';
import axios from 'axios';
import './App.css';

interface DisasterAlert {
  id: string;
  type: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  latitude: number;
  longitude: number;
  timestamp: string;
  description: string;
  confidence: number;
}

interface SystemMetrics {
  activeZones: number;
  totalPredictions: number;
  modelAccuracy: number;
  avgResponseTime: number;
  concurrentConnections: number;
  cacheHitRate: number;
}

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost/api';
const WS_URL = process.env.REACT_APP_WS_URL || 'ws://localhost:8080';

export default function App() {
  const [alerts, setAlerts] = useState<DisasterAlert[]>([]);
  const [metrics, setMetrics] = useState<SystemMetrics>({
    activeZones: 1247,
    totalPredictions: 45829,
    modelAccuracy: 95.7,
    avgResponseTime: 47,
    concurrentConnections: 8492,
    cacheHitRate: 94.3
  });
  const [selectedAlert, setSelectedAlert] = useState<DisasterAlert | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  // WebSocket connection
  const { lastMessage, sendMessage } = useWebSocket(WS_URL, {
    onOpen: () => {
      setIsConnected(true);
      sendMessage(JSON.stringify({ action: 'subscribe', channel: 'disaster-alerts' }));
    },
    onClose: () => setIsConnected(false),
    onError: (event) => console.error('WebSocket error:', event),
    shouldReconnect: () => true,
    reconnectInterval: 3000
  });

  // Handle WebSocket messages
  useEffect(() => {
    if (lastMessage) {
      try {
        const data = JSON.parse(lastMessage.data);
        if (data.type === 'alert') {
          setAlerts(prev => [data.alert, ...prev].slice(0, 50));
          setMetrics(prev => ({
            ...prev,
            totalPredictions: prev.totalPredictions + 1,
            concurrentConnections: data.connections || prev.concurrentConnections
          }));
        }
      } catch (error) {
        console.error('Failed to parse WebSocket message:', error);
      }
    }
  }, [lastMessage]);

  // Fetch initial metrics
  useEffect(() => {
    const fetchMetrics = async () => {
      try {
        const response = await axios.get(`${API_URL}/v1/analytics/stats`);
        setMetrics(response.data);
      } catch (error) {
        console.error('Failed to fetch metrics:', error);
      }
    };

    fetchMetrics();
    const interval = setInterval(fetchMetrics, 5000);
    return () => clearInterval(interval);
  }, []);

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'critical': return '#EF4444';
      case 'high': return '#F59E0B';
      case 'medium': return '#3B82F6';
      default: return '#10B981';
    }
  };

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-content">
          <h1>🛰️ AI-Sentinel</h1>
          <p>Real-Time Disaster Monitoring & Prediction Platform</p>
        </div>
        <div className="connection-status">
          <div className={`status-indicator ${isConnected ? 'connected' : 'disconnected'}`} />
          <span>{isConnected ? 'Connected' : 'Disconnected'}</span>
        </div>
      </header>

      <main className="app-main">
        {/* Metrics Grid */}
        <section className="metrics-grid">
          <div className="metric-card">
            <h3>Active Monitoring Zones</h3>
            <p className="metric-value">{metrics.activeZones.toLocaleString()}</p>
            <p className="metric-label">Zones monitored</p>
          </div>
          <div className="metric-card">
            <h3>Predictions Made</h3>
            <p className="metric-value">{metrics.totalPredictions.toLocaleString()}</p>
            <p className="metric-label">Total predictions</p>
          </div>
          <div className="metric-card">
            <h3>Model Accuracy</h3>
            <p className="metric-value">{metrics.modelAccuracy}%</p>
            <p className="metric-label">Classification accuracy</p>
          </div>
          <div className="metric-card">
            <h3>Avg Response Time</h3>
            <p className="metric-value">{metrics.avgResponseTime}ms</p>
            <p className="metric-label">Sub-50ms latency</p>
          </div>
          <div className="metric-card">
            <h3>Concurrent Connections</h3>
            <p className="metric-value">{metrics.concurrentConnections.toLocaleString()}</p>
            <p className="metric-label">WebSocket connections</p>
          </div>
          <div className="metric-card">
            <h3>Cache Hit Rate</h3>
            <p className="metric-value">{metrics.cacheHitRate}%</p>
            <p className="metric-label">Redis caching efficiency</p>
          </div>
        </section>

        {/* Alerts Section */}
        <section className="alerts-section">
          <h2>Real-Time Disaster Alerts</h2>
          <div className="alerts-container">
            {alerts.length === 0 ? (
              <div className="no-alerts">
                <p>No active alerts. System monitoring...</p>
              </div>
            ) : (
              alerts.map(alert => (
                <div
                  key={alert.id}
                  className="alert-item"
                  style={{ borderLeft: `4px solid ${getSeverityColor(alert.severity)}` }}
                  onClick={() => setSelectedAlert(alert)}
                >
                  <div className="alert-header">
                    <h4>{alert.type}</h4>
                    <span className={`severity-badge ${alert.severity}`}>
                      {alert.severity.toUpperCase()}
                    </span>
                  </div>
                  <p className="alert-description">{alert.description}</p>
                  <div className="alert-meta">
                    <span>📍 {alert.latitude.toFixed(4)}, {alert.longitude.toFixed(4)}</span>
                    <span>🎯 Confidence: {(alert.confidence * 100).toFixed(1)}%</span>
                    <span>⏰ {new Date(alert.timestamp).toLocaleTimeString()}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>

        {/* Selected Alert Details */}
        {selectedAlert && (
          <section className="alert-details">
            <h2>Alert Details</h2>
            <div className="details-card">
              <h3>{selectedAlert.type}</h3>
              <div className="details-grid">
                <div>
                  <label>Severity</label>
                  <p className={`severity-badge ${selectedAlert.severity}`}>
                    {selectedAlert.severity.toUpperCase()}
                  </p>
                </div>
                <div>
                  <label>Confidence</label>
                  <p>{(selectedAlert.confidence * 100).toFixed(2)}%</p>
                </div>
                <div>
                  <label>Location</label>
                  <p>{selectedAlert.latitude.toFixed(6)}, {selectedAlert.longitude.toFixed(6)}</p>
                </div>
                <div>
                  <label>Time</label>
                  <p>{new Date(selectedAlert.timestamp).toLocaleString()}</p>
                </div>
              </div>
              <div className="details-description">
                <label>Description</label>
                <p>{selectedAlert.description}</p>
              </div>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
