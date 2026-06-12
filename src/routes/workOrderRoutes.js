const express = require('express');
const {
  getWorkOrders,
  getWorkOrderById,
  createWorkOrder,
  assignWorkOrder,
  startWorkOrder,
  completeWorkOrder,
  approveWorkOrder,
  returnWorkOrder,
  getWorkOrderStatistics,
  getMyWorkOrders,
  uploadWorkOrderPhoto
} = require('../controllers/workOrderController');
const { authMiddleware, roleMiddleware } = require('../middleware/auth');
const { upload } = require('../middleware/upload');

const router = express.Router();

router.use(authMiddleware);

router.get('/my', getMyWorkOrders);
router.get('/statistics', getWorkOrderStatistics);
router.get('/', getWorkOrders);
router.get('/:id', getWorkOrderById);

router.post('/:id/start', startWorkOrder);
router.post('/:id/complete', completeWorkOrder);
router.post('/:id/photos', upload.single('photo'), uploadWorkOrderPhoto);

router.use(roleMiddleware('admin', 'supervisor'));

router.post('/', createWorkOrder);
router.put('/:id/assign', assignWorkOrder);
router.post('/:id/approve', approveWorkOrder);
router.post('/:id/return', returnWorkOrder);

module.exports = router;
