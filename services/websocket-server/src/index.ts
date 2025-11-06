import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import redis from 'redis';
import { Kafka } from 'kafkajs';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// Redis
const redisClient = redis.createClient({
  url: process.env.REDIS_URL
});

const redisSubscriber = redis.createClient({
  url: process.env.REDIS_URL
});

redisClient.connect();
redisSubscriber.connect();

// Kafka
const kafka = new Kafka({
  clientId: 'websocket-server',
  brokers: [process.env.KAFKA_BROKER || 'kafka:9092']
});

const consumer = kafka.consumer({ groupId: 'websocket-server-group' });

// Types
interface ClientInfo {
  id: string;
  connectedAt: Date;
  subscribed: string[];
}

// Track connected clients
const clients = new Map<string, ClientInfo>();

// Initialize Kafka
async function initKafka() {
  await consumer.connect();
  await consumer.subscribe({ topics: ['disaster-events', 'disaster-alerts'] });

  await consumer.run({
    eachMessage: async ({ topic, partition, message }) => {
      try {
        const event = JSON.parse(message.value.toString());
        
        io.emit('kafka-event', {
          topic,
          data: event,
          timestamp: new Date().toISOString()
        });

        await redisClient.publish('websocket-events', JSON.stringify({
          topic,
          data: event
        }));

        console.log(`Published Kafka event from ${topic}`);
      } catch (error) {
        console.error('Kafka message processing error:', error);
      }
    }
  });
}

// Socket.io events
io.on('connection', (socket) => {
  console.log(`Client connected: ${socket.id}`);

  const clientInfo: ClientInfo = {
    id: socket.id,
    connectedAt: new Date(),
    subscribed: []
  };

  clients.set(socket.id, clientInfo);

  socket.emit('connected', {
    socketId: socket.id,
    timestamp: new Date().toISOString(),
    message: 'Connected to AI-Sentinel WebSocket server'
  });

  socket.on('subscribe', (data: { channel: string }) => {
    const { channel } = data;
    socket.join(channel);
    clientInfo.subscribed.push(channel);

    console.log(`Client ${socket.id} subscribed to ${channel}`);

    socket.emit('subscribed', {
      channel,
      timestamp: new Date().toISOString()
    });
  });

  socket.on('unsubscribe', (data: { channel: string }) => {
    const { channel } = data;
    socket.leave(channel);
    clientInfo.subscribed = clientInfo.subscribed.filter(c => c !== channel);

    console.log(`Client ${socket.id} unsubscribed from ${channel}`);

    socket.emit('unsubscribed', { channel });
  });

  socket.on('send-alert', async (data) => {
    try {
      const alert = {
        id: Math.random().toString(36).substr(2, 9),
        ...data,
        timestamp: new Date().toISOString(),
        sourceSocketId: socket.id
      };

      io.to('disaster-alerts').emit('alert', alert);

      await redisClient.setEx(
        `alert:${alert.id}`,
        3600,
        JSON.stringify(alert)
      );

      socket.emit('alert-sent', { alertId: alert.id });
      console.log(`Alert sent: ${alert.id}`);
    } catch (error) {
      console.error('Error sending alert:', error);
      socket.emit('error', { message: 'Failed to send alert' });
    }
  });

  socket.on('get-stats', () => {
    const stats = {
      totalConnections: clients.size,
      activeChannels: Array.from(io.sockets.adapter.rooms.keys()),
      timestamp: new Date().toISOString()
    };

    socket.emit('stats', stats);
  });

  socket.on('disconnect', () => {
    clients.delete(socket.id);
    console.log(`Client disconnected: ${socket.id}`);

    io.emit('connection-count', {
      total: clients.size,
      timestamp: new Date().toISOString()
    });
  });

  socket.on('error', (error) => {
    console.error(`Socket error for ${socket.id}:`, error);
  });
});

// Redis subscription
redisSubscriber.subscribe('websocket-events', (message) => {
  try {
    const event = JSON.parse(message);
    io.emit('redis-event', {
      ...event,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Redis message processing error:', error);
  }
});

// HTTP Routes
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'websocket-server',
    connections: clients.size,
    uptime: process.uptime()
  });
});

app.get('/stats', (req, res) => {
  res.json({
    totalConnections: clients.size,
    connectedClients: Array.from(clients.values()).map(c => ({
      id: c.id,
      connectedAt: c.connectedAt,
      subscribed: c.subscribed
    })),
    rooms: Array.from(io.sockets.adapter.rooms.entries()).map(([room, sockets]) => ({
      room,
      connections: sockets.size
    })),
    timestamp: new Date().toISOString()
  });
});

app.post('/broadcast', express.json(), (req, res) => {
  const { event, data, channel } = req.body;

  if (!event || !data) {
    return res.status(400).json({ error: 'event and data required' });
  }

  if (channel) {
    io.to(channel).emit(event, data);
  } else {
    io.emit(event, data);
  }

  res.json({ message: 'Event broadcasted', recipients: clients.size });
});

// Initialize
async function start() {
  try {
    await initKafka();
    console.log('Kafka initialized');

    const PORT = process.env.PORT || 8080;
    server.listen(PORT, () => {
      console.log(`WebSocket server listening on port ${PORT}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

start();

export default app;
