const express = require('express');
const {
  getEnergyRecords,
  getEnergyStatistics,
  getPondEnergyStats
} = require('../controllers/energyController');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

router.use(authMiddleware);

router.get('/', getEnergyRecords);
router.get('/statistics', getEnergyStatistics);
router.get('/pond/:pondId', getPondEnergyStats);

module.exports = router;
