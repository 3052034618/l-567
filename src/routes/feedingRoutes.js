const express = require('express');
const {
  triggerFeeding,
  getFeedingRecords,
  getFeedingRecordById,
  getFeedingStatistics,
  calculateFeedAmountApi
} = require('../controllers/feedingController');
const { authMiddleware, roleMiddleware } = require('../middleware/auth');

const router = express.Router();

router.use(authMiddleware);

router.get('/', getFeedingRecords);
router.get('/statistics', getFeedingStatistics);
router.get('/calculate/:pondId', calculateFeedAmountApi);
router.get('/:id', getFeedingRecordById);

router.post('/trigger', roleMiddleware('admin', 'supervisor', 'worker'), triggerFeeding);

module.exports = router;
