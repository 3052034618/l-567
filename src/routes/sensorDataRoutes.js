const express = require('express');
const {
  uploadSensorData,
  batchUploadSensorData,
  getSensorData,
  getLatestSensorData,
  getSensorStatistics
} = require('../controllers/sensorDataController');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

router.post('/upload', uploadSensorData);
router.post('/batch-upload', batchUploadSensorData);

router.use(authMiddleware);

router.get('/', getSensorData);
router.get('/latest/:pondId', getLatestSensorData);
router.get('/statistics', getSensorStatistics);

module.exports = router;
