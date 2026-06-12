require('dotenv').config();

const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const connectDB = require('./config/database');
const config = require('./config');
const websocket = require('./utils/websocket');
const { initCronJobs } = require('./utils/cronJobs');
const { errorHandler, notFound } = require('./middleware/errorHandler');

const authRoutes = require('./routes/authRoutes');
const userRoutes = require('./routes/userRoutes');
const fishSpeciesRoutes = require('./routes/fishSpeciesRoutes');
const pondRoutes = require('./routes/pondRoutes');
const sensorDataRoutes = require('./routes/sensorDataRoutes');
const alertRoutes = require('./routes/alertRoutes');
const workOrderRoutes = require('./routes/workOrderRoutes');
const feedingRoutes = require('./routes/feedingRoutes');
const deviceRoutes = require('./routes/deviceRoutes');
const energyRoutes = require('./routes/energyRoutes');
const dailyLogRoutes = require('./routes/dailyLogRoutes');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

websocket.init(io);

connectDB();

app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

if (config.nodeEnv === 'development') {
  app.use(morgan('dev'));
} else {
  app.use(morgan('combined'));
}

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  message: '请求过于频繁，请稍后再试'
});
app.use('/api', limiter);

app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

app.get('/', (req, res) => {
  res.json({
    message: '智慧水产养殖环境监测与自动投喂调度系统 API',
    version: '1.0.0',
    status: 'running'
  });
});

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/fish-species', fishSpeciesRoutes);
app.use('/api/ponds', pondRoutes);
app.use('/api/sensor-data', sensorDataRoutes);
app.use('/api/alerts', alertRoutes);
app.use('/api/work-orders', workOrderRoutes);
app.use('/api/feeding', feedingRoutes);
app.use('/api/devices', deviceRoutes);
app.use('/api/energy', energyRoutes);
app.use('/api/daily-logs', dailyLogRoutes);

app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

app.use(notFound);
app.use(errorHandler);

const PORT = config.port || 3000;

server.listen(PORT, () => {
  console.log(`服务器运行在端口 ${PORT}`);
  console.log(`环境: ${config.nodeEnv}`);
  console.log(`API 文档: http://localhost:${PORT}/`);
  
  initCronJobs();
});

process.on('unhandledRejection', (err) => {
  console.error('未处理的Promise拒绝:', err);
  server.close(() => process.exit(1));
});

process.on('SIGTERM', () => {
  console.log('SIGTERM信号收到，正在关闭服务器...');
  server.close(() => {
    console.log('服务器已关闭');
    process.exit(0);
  });
});

module.exports = app;
