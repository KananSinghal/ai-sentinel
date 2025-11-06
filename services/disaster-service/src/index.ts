import express from 'express';
import pg from 'pg';
import redis from 'redis';
import { Kafka } from 'kafkajs';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(express.json());
app.use(cors());

// Database
const pool = new pg.Pool({
  connectionString: process.env.TIMESCALE_URL
});

// Redis
const redisClient = redis.createClient({
  url: process.env.REDIS_URL
});

redisClient.connect();

// Kafka
const kafka = new Kafka({
  clientId: 'disaster-service',
  brokers: [process.env.KAFKA_BROKER || 'kafka:9092']
});

const producer = kafka.producer();
const consumer = kafka.consumer({ groupId: 'disaster-service-group' });

// Types
interface DisasterEvent {
  id?: string;
  event_type: string;
  latitude: number;
  longitude: number;
  severity: string;
  description: string;
  confidence: number;
  metadata?: Record<string, any>;
}

// Initialize Kafka
async function initKafka() {
  await producer.connect();
  await consumer.connect();
  await consumer.subscribe({ topic: 'disaster-alerts' });

  await consumer.run({
    eachMessage: async ({ topic, partition, message }) => {
      console.log('Received Kafka message:', message.value?.toString());
    }
  });
}

initKafka().catch(console.error);

// Create disaster event
app.post('/api/v1/disasters', async (req, res) => {
  try {
    const { event_type, latitude, longitude, severity, description, confidence, metadata } = req.body;

    if (!event_type || !latitude || !longitude || !severity || !description) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const result = await pool.query(
      `INSERT INTO disaster_events (event_type, latitude, longitude, severity, description, confidence, metadata, timestamp)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
       RETURNING id, event_type, latitude, longitude, severity, description, confidence, timestamp`,
      [event_type, latitude, longitude, severity, description, confidence, JSON.stringify(metadata || {})]
    );

    const event = result.rows;

    // Publish to Kafka
    await producer.send({
      topic: 'disaster-events',
      messages: [
        {
          value: JSON.stringify({
            type: 'disaster_detected',
            event: event,
            timestamp: new Date().toISOString()
          })
        }
      ]
    });

    // Cache event
    await redisClient.setEx(
      `disaster:${event.id}`,
      3600,
      JSON.stringify(event)
    );

    res.status(201).json({
      message: 'Disaster event recorded',
      event
    });
  } catch (error) {
    console.error('Error creating disaster:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get disasters
app.get('/api/v1/disasters', async (req, res) => {
  try {
    const { limit = 50, offset = 0, type, severity } = req.query;

    let query = 'SELECT * FROM disaster_events WHERE 1=1';
    const params: any[] = [];

    if (type) {
      query += ' AND event_type = $' + (params.length + 1);
      params.push(type);
    }

    if (severity) {
      query += ' AND severity = $' + (params.length + 1);
      params.push(severity);
    }

    query += ' ORDER BY timestamp DESC LIMIT $' + (params.length + 1) + ' OFFSET $' + (params.length + 2);
    params.push(Number(limit), Number(offset));

    const result = await pool.query(query, params);

    res.json({
      disasters: result.rows,
      total: result.rows.length,
      limit,
      offset
    });
  } catch (error) {
    console.error('Error fetching disasters:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get disasters nearby
app.get('/api/v1/disasters/nearby', async (req, res) => {
  try {
    const { latitude, longitude, radius = 10 } = req.query;

    if (!latitude || !longitude) {
      return res.status(400).json({ error: 'Latitude and longitude required' });
    }

    const result = await pool.query(
      `SELECT *,
              earth_distance(ll_to_earth($1, $2), ll_to_earth(latitude, longitude)) as distance
       FROM disaster_events
       WHERE earth_distance(ll_to_earth($1, $2), ll_to_earth(latitude, longitude)) < $3 * 1000
       ORDER BY distance
       LIMIT 50`,
      [latitude, longitude, radius]
    );

    res.json({
      disasters: result.rows,
      total: result.rows.length
    });
  } catch (error) {
    console.error('Error fetching nearby disasters:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get disaster by ID
app.get('/api/v1/disasters/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const cached = await redisClient.get(`disaster:${id}`);
    if (cached) {
      return res.json(JSON.parse(cached));
    }

    const result = await pool.query(
      'SELECT * FROM disaster_events WHERE id = $1',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Disaster not found' });
    }

    const disaster = result.rows;

    await redisClient.setEx(`disaster:${id}`, 3600, JSON.stringify(disaster));

    res.json(disaster);
  } catch (error) {
    console.error('Error fetching disaster:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'disaster-service' });
});

const PORT = process.env.PORT || 4002;
app.listen(PORT, () => {
  console.log(`Disaster service listening on port ${PORT}`);
});

export default app;
