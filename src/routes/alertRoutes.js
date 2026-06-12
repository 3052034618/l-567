const express = require('express');
const {
  getAlerts,
  getAlertById,
  acknowledgeAlert,
  resolveAlert,
  getAlertStatistics
} = require('../controllers/alertController');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

router.use(authMiddleware);

router.get('/', getAlerts);
router.get('/statistics', getAlertStatistics);
router.get('/:id', getAlertById);
router.put('/:id/acknowledge', acknowledgeAlert);
router.put('/:id/resolve', resolveAlert);

module.exports = router;
