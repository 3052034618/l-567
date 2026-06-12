const express = require('express');
const {
  getDevices,
  getDeviceById,
  createDevice,
  updateDevice,
  deleteDevice,
  controlDevice,
  reportDeviceFault,
  getDeviceStatus
} = require('../controllers/deviceController');
const { authMiddleware, roleMiddleware } = require('../middleware/auth');

const router = express.Router();

router.use(authMiddleware);

router.get('/status', getDeviceStatus);
router.get('/', getDevices);
router.get('/:id', getDeviceById);

router.post('/:id/control', roleMiddleware('admin', 'supervisor', 'worker'), controlDevice);
router.post('/:id/fault', reportDeviceFault);

router.use(roleMiddleware('admin', 'supervisor'));

router.post('/', createDevice);
router.put('/:id', updateDevice);
router.delete('/:id', deleteDevice);

module.exports = router;
