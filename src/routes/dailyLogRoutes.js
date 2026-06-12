const express = require('express');
const {
  getDailyLogs,
  getDailyLogById,
  createDailyLog,
  updateDailyLog,
  exportDailyLogs,
  getDailyLogSummary
} = require('../controllers/dailyLogController');
const { authMiddleware, roleMiddleware } = require('../middleware/auth');

const router = express.Router();

router.use(authMiddleware);

router.get('/', getDailyLogs);
router.get('/summary', getDailyLogSummary);
router.get('/export', exportDailyLogs);
router.get('/:id', getDailyLogById);

router.use(roleMiddleware('admin', 'supervisor'));

router.post('/', createDailyLog);
router.put('/:id', updateDailyLog);

module.exports = router;
