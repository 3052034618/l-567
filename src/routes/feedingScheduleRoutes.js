const express = require('express');
const {
  getFeedingSchedules,
  getFeedingScheduleById,
  createFeedingSchedule,
  updateFeedingSchedule,
  suspendFeeding,
  resumeFeeding
} = require('../controllers/feedingScheduleController');
const { authMiddleware, roleMiddleware } = require('../middleware/auth');

const router = express.Router();

router.use(authMiddleware);

router.get('/', getFeedingSchedules);
router.get('/:id', getFeedingScheduleById);

router.use(roleMiddleware('admin', 'supervisor'));

router.post('/', createFeedingSchedule);
router.put('/:id', updateFeedingSchedule);
router.post('/:id/suspend', suspendFeeding);
router.post('/:id/resume', resumeFeeding);

module.exports = router;
