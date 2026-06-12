const express = require('express');
const {
  getPonds,
  getPondById,
  createPond,
  updatePond,
  deletePond,
  getPondSummary,
  getPondDailyTimeline,
  getPondHealthScores
} = require('../controllers/pondController');
const { authMiddleware, roleMiddleware } = require('../middleware/auth');

const router = express.Router();

router.use(authMiddleware);

router.get('/summary', getPondSummary);
router.get('/health-scores', getPondHealthScores);
router.get('/', getPonds);
router.get('/:id/timeline', getPondDailyTimeline);
router.get('/:id', getPondById);

router.use(roleMiddleware('admin', 'supervisor'));

router.post('/', createPond);
router.put('/:id', updatePond);
router.delete('/:id', deletePond);

module.exports = router;
