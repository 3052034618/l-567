const Device = require('../models/Device');
const Pond = require('../models/Pond');
const EnergyRecord = require('../models/EnergyRecord');
const config = require('../config');
const websocket = require('../utils/websocket');
const { generateOrderNo, autoAssignWorkOrder } = require('./workOrderController');
const WorkOrder = require('../models/WorkOrder');
const mongoose = require('mongoose');

const getDevices = async (req, res, next) => {
  try {
    const { 
      type, status, pondId, 
      page = 1, limit = 20,
      keyword
    } = req.query;
    
    const query = {};
    
    if (type) query.type = type;
    if (status) query.status = status;
    if (pondId) query.pond = pondId;
    if (keyword) {
      query.$or = [
        { deviceId: { $regex: keyword, $options: 'i' } },
        { name: { $regex: keyword, $options: 'i' } }
      ];
    }
    
    const devices = await Device.find(query)
      .skip((page - 1) * limit)
      .limit(Number(limit))
      .sort({ createdAt: -1 })
      .populate('pond', 'pondNo name');
    
    const total = await Device.countDocuments(query);
    
    res.json({
      success: true,
      data: devices,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    next(error);
  }
};

const getDeviceById = async (req, res, next) => {
  try {
    const device = await Device.findById(req.params.id)
      .populate('pond', 'pondNo name');
    
    if (!device) {
      return res.status(404).json({ message: '设备不存在' });
    }
    
    res.json({
      success: true,
      data: device
    });
  } catch (error) {
    next(error);
  }
};

const createDevice = async (req, res, next) => {
  try {
    const {
      deviceId, name, type, pond,
      powerRating, manufacturer, model,
      autoControl, position, notes
    } = req.body;
    
    const existing = await Device.findOne({ deviceId });
    if (existing) {
      return res.status(400).json({ message: '设备编号已存在' });
    }
    
    const device = new Device({
      deviceId,
      name,
      type,
      pond,
      powerRating: powerRating || 0,
      manufacturer,
      model,
      autoControl: autoControl !== undefined ? autoControl : true,
      position,
      notes,
      installDate: Date.now()
    });
    
    await device.save();
    
    if (pond) {
      await Pond.findByIdAndUpdate(pond, {
        $push: { devices: device._id }
      });
    }
    
    res.status(201).json({
      success: true,
      data: device
    });
  } catch (error) {
    next(error);
  }
};

const updateDevice = async (req, res, next) => {
  try {
    const device = await Device.findById(req.params.id);
    
    if (!device) {
      return res.status(404).json({ message: '设备不存在' });
    }
    
    const {
      name, type, pond, status,
      powerRating, manufacturer, model,
      autoControl, position, notes,
      lastMaintenance, nextMaintenance
    } = req.body;
    
    if (name !== undefined) device.name = name;
    if (type !== undefined) device.type = type;
    if (status !== undefined) device.status = status;
    if (powerRating !== undefined) device.powerRating = powerRating;
    if (manufacturer !== undefined) device.manufacturer = manufacturer;
    if (model !== undefined) device.model = model;
    if (autoControl !== undefined) device.autoControl = autoControl;
    if (position !== undefined) device.position = position;
    if (notes !== undefined) device.notes = notes;
    if (lastMaintenance !== undefined) device.lastMaintenance = lastMaintenance;
    if (nextMaintenance !== undefined) device.nextMaintenance = nextMaintenance;
    
    if (pond !== undefined && pond !== device.pond?.toString()) {
      if (device.pond) {
        await Pond.findByIdAndUpdate(device.pond, {
          $pull: { devices: device._id }
        });
      }
      
      device.pond = pond;
      
      if (pond) {
        await Pond.findByIdAndUpdate(pond, {
          $push: { devices: device._id }
        });
      }
    }
    
    await device.save();
    
    websocket.emitToAll('device:update', device);
    
    res.json({
      success: true,
      data: device
    });
  } catch (error) {
    next(error);
  }
};

const deleteDevice = async (req, res, next) => {
  try {
    const device = await Device.findByIdAndDelete(req.params.id);
    
    if (!device) {
      return res.status(404).json({ message: '设备不存在' });
    }
    
    if (device.pond) {
      await Pond.findByIdAndUpdate(device.pond, {
        $pull: { devices: device._id }
      });
    }
    
    res.json({
      success: true,
      message: '设备已删除'
    });
  } catch (error) {
    next(error);
  }
};

const controlDevice = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { action, speed } = req.body;
    
    const device = await Device.findById(id);
    
    if (!device) {
      return res.status(404).json({ message: '设备不存在' });
    }
    
    if (device.status === config.deviceStatus.FAULT) {
      return res.status(400).json({ message: '设备故障，无法操作' });
    }
    
    const previousStatus = device.status;
    
    switch (action) {
      case 'start':
        if (device.status === config.deviceStatus.RUNNING) {
          return res.status(400).json({ message: '设备已在运行' });
        }
        device.status = config.deviceStatus.RUNNING;
        if (speed) device.currentSpeed = speed;
        
        startEnergyRecording(device);
        break;
        
      case 'stop':
        if (device.status === config.deviceStatus.STOPPED) {
          return res.status(400).json({ message: '设备已停止' });
        }
        device.status = config.deviceStatus.STOPPED;
        device.currentSpeed = 0;
        
        endEnergyRecording(device);
        break;
        
      case 'adjust':
        if (speed !== undefined) device.currentSpeed = speed;
        break;
        
      default:
        return res.status(400).json({ message: '无效的操作' });
    }
    
    await device.save();
    
    websocket.emitToAll('device:update', device);
    
    res.json({
      success: true,
      data: device,
      message: `设备${action === 'start' ? '启动' : action === 'stop' ? '停止' : '调节'}成功`
    });
  } catch (error) {
    next(error);
  }
};

const activeEnergyRecords = new Map();

const startEnergyRecording = (device) => {
  if (!device.pond || !device.powerRating) return;
  
  const record = new EnergyRecord({
    device: device._id,
    pond: device.pond,
    deviceType: device.type,
    startTime: Date.now(),
    startTimeStatus: device.status,
    date: new Date().setHours(0, 0, 0, 0)
  });
  
  record.save().then(savedRecord => {
    activeEnergyRecords.set(device._id.toString(), savedRecord._id);
  }).catch(err => {
    console.error('启动能耗记录失败:', err);
  });
};

const endEnergyRecording = async (device) => {
  const recordId = activeEnergyRecords.get(device._id.toString());
  
  if (!recordId) return;
  
  try {
    const record = await EnergyRecord.findById(recordId);
    
    if (record) {
      const endTime = Date.now();
      const durationHours = (endTime - new Date(record.startTime)) / 1000 / 3600;
      const powerConsumption = device.powerRating * durationHours;
      
      record.endTime = endTime;
      record.duration = durationHours * 60;
      record.powerConsumption = Math.round(powerConsumption * 100) / 100;
      record.endTimeStatus = device.status;
      
      await record.save();
    }
    
    activeEnergyRecords.delete(device._id.toString());
  } catch (error) {
    console.error('结束能耗记录失败:', error);
  }
};

const reportDeviceFault = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { faultCode, faultMessage } = req.body;
    
    const device = await Device.findById(id).populate('pond');
    
    if (!device) {
      return res.status(404).json({ message: '设备不存在' });
    }
    
    device.status = config.deviceStatus.FAULT;
    device.faultCode = faultCode;
    device.faultMessage = faultMessage;
    device.lastFaultTime = Date.now();
    
    await device.save();
    
    if (device.pond) {
      await endEnergyRecording(device);
      
      const order = new WorkOrder({
        orderNo: generateOrderNo(),
        type: config.workOrderType.EQUIPMENT_MAINTENANCE,
        level: config.alertLevels.HIGH,
        pond: device.pond._id,
        device: device._id,
        alertType: 'equipment_fault',
        description: `设备故障：${device.name} - ${faultMessage || faultCode || '未知故障'}`,
        priority: 3
      });
      
      await order.save();
      await order.populate('pond', 'pondNo name');
      await order.populate('device', 'name');
      
      await autoAssignWorkOrder(order);
      
      websocket.emitToAll('workOrder:new', order);
    }
    
    websocket.emitToAll('device:fault', device);
    
    res.json({
      success: true,
      data: device,
      message: '故障已上报，已生成维修工单'
    });
  } catch (error) {
    next(error);
  }
};

const autoControlDevices = async (pondId, waterQuality) => {
  try {
    const pond = await Pond.findById(pondId);
    if (!pond) return;
    
    const oxygenPumps = await Device.find({
      pond: pondId,
      type: config.deviceTypes.OXYGEN_PUMP,
      autoControl: true,
      status: { $ne: config.deviceStatus.FAULT }
    });
    
    const waterPumps = await Device.find({
      pond: pondId,
      type: config.deviceTypes.WATER_PUMP,
      autoControl: true,
      status: { $ne: config.deviceStatus.FAULT }
    });
    
    if (waterQuality.oxygen !== undefined && oxygenPumps.length > 0) {
      const oxygenMin = pond.thresholds?.oxygenMin || 5;
      
      if (waterQuality.oxygen < oxygenMin * 0.8) {
        for (const pump of oxygenPumps) {
          if (pump.status !== config.deviceStatus.RUNNING) {
            pump.status = config.deviceStatus.RUNNING;
            pump.currentSpeed = 100;
            await pump.save();
            startEnergyRecording(pump);
            websocket.emitToAll('device:update', pump);
          }
        }
      } else if (waterQuality.oxygen > oxygenMin * 1.5) {
        for (const pump of oxygenPumps) {
          if (pump.status === config.deviceStatus.RUNNING) {
            pump.status = config.deviceStatus.STOPPED;
            pump.currentSpeed = 0;
            await pump.save();
            await endEnergyRecording(pump);
            websocket.emitToAll('device:update', pump);
          }
        }
      }
    }
    
    if (waterQuality.temperature !== undefined && waterPumps.length > 0) {
      const tempMax = pond.thresholds?.temperatureMax || 30;
      
      if (waterQuality.temperature > tempMax) {
        for (const pump of waterPumps) {
          if (pump.status !== config.deviceStatus.RUNNING) {
            pump.status = config.deviceStatus.RUNNING;
            pump.currentSpeed = 80;
            await pump.save();
            startEnergyRecording(pump);
            websocket.emitToAll('device:update', pump);
          }
        }
      } else if (waterQuality.temperature < tempMax - 3) {
        for (const pump of waterPumps) {
          if (pump.status === config.deviceStatus.RUNNING) {
            pump.status = config.deviceStatus.STOPPED;
            pump.currentSpeed = 0;
            await pump.save();
            await endEnergyRecording(pump);
            websocket.emitToAll('device:update', pump);
          }
        }
      }
    }
  } catch (error) {
    console.error('设备自动控制失败:', error);
  }
};

const getDeviceStatus = async (req, res, next) => {
  try {
    const total = await Device.countDocuments();
    const running = await Device.countDocuments({ status: config.deviceStatus.RUNNING });
    const stopped = await Device.countDocuments({ status: config.deviceStatus.STOPPED });
    const fault = await Device.countDocuments({ status: config.deviceStatus.FAULT });
    const maintenance = await Device.countDocuments({ status: config.deviceStatus.MAINTENANCE });
    
    const byType = await Device.aggregate([
      {
        $group: {
          _id: '$type',
          count: { $sum: 1 },
          running: {
            $sum: { $cond: [{ $eq: ['$status', 'running'] }, 1, 0] }
          },
          fault: {
            $sum: { $cond: [{ $eq: ['$status', 'fault'] }, 1, 0] }
          }
        }
      }
    ]);
    
    res.json({
      success: true,
      data: {
        total,
        running,
        stopped,
        fault,
        maintenance,
        byType
      }
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getDevices,
  getDeviceById,
  createDevice,
  updateDevice,
  deleteDevice,
  controlDevice,
  reportDeviceFault,
  autoControlDevices,
  getDeviceStatus,
  startEnergyRecording,
  endEnergyRecording
};
