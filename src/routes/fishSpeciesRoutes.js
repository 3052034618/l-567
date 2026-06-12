const express = require('express');
const {
  getFishSpecies,
  getFishSpeciesById,
  createFishSpecies,
  updateFishSpecies,
  deleteFishSpecies
} = require('../controllers/fishSpeciesController');
const { authMiddleware, roleMiddleware } = require('../middleware/auth');

const router = express.Router();

router.use(authMiddleware);

router.get('/', getFishSpecies);
router.get('/:id', getFishSpeciesById);

router.use(roleMiddleware('admin', 'supervisor'));

router.post('/', createFishSpecies);
router.put('/:id', updateFishSpecies);
router.delete('/:id', deleteFishSpecies);

module.exports = router;
