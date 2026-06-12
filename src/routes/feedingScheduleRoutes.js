const express = require('express');
const {
  getFeedingSchedules,
  getFeedingScheduleById,
  createFeedingSchedule,
  updateFeedingSchedule,
  suspendFeeding,
  resumeFeeding,
  getPondScheduleTimeline
} = require('../controllers/feedingScheduleController');
const { authMiddleware, roleMiddleware } = require('../middleware/auth');

const router = express.Router();

router.use(authMiddleware);

router.get('/', getFeedingSchedules);
router.get('/pond/:pondId/timeline', getPondScheduleTimeline);
router.get('/:id', getFeedingScheduleById);

router.use(roleMiddleware('admin', 'supervisor'));

router.post('/', createFeedingSchedule);
router.put('/:id', updateFeedingSchedule);
router.post('/suspend', suspendFeeding);
router.post('/resume', resumeFeeding);

module.exports = router;
