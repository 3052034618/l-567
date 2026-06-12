const Alert = require('../models/Alert');
const Pond = require('../models/Pond');
const WorkOrder = require('../models/WorkOrder');
const config = require('../config');
const websocket = require('../utils/websocket');
const { autoAssignWorkOrder, generateOrderNo } = require('./workOrderController');
const mongoose = require('mongoose');

const generateAlertNo = () => {
  const now = new Date();
  const dateStr = now.getFullYear().toString() + 
    (now.getMonth() + 1).toString().padStart(2, '0') +
    now.getDate().toString().padStart(2, '0');
  const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  return `ALT${dateStr}${random}`;
};

const checkAndGenerateAlert = async (pondId, sensorType, value, status, forceLevel, forceDirection, forceThreshold, deviation) => {
  try {
    const pond = await Pond.findById(pondId);
    if (!pond) return null;
    
    let threshold = forceThreshold;
    if (!threshold) {
      const thresholdResult = getThresholdForSensor(sensorType, pond.thresholds, value);
      threshold = thresholdResult.threshold;
      forceDirection = forceDirection || thresholdResult.direction;
    }
    
    const alertLevel = forceLevel || (status === 'critical' ? config.alertLevels.CRITICAL : 
                       status === 'warning' ? config.alertLevels.MEDIUM : 
                       config.alertLevels.LOW);
    
    const alertType = forceDirection || (value < threshold ? 'below_threshold' : 'over_threshold');
    
    const existingActiveAlert = await Alert.findOne({
      pond: pondId,
      sensorType,
      status: 'active',
      type: alertType
    });
    
    if (existingActiveAlert) {
      existingActiveAlert.value = value;
      existingActiveAlert.level = alertLevel;
      existingActiveAlert.threshold = threshold;
      existingActiveAlert.message = generateAlertMessage(sensorType, alertType, value, threshold, alertLevel, deviation);
      await existingActiveAlert.save();
      
      websocket.emitToAll('alert:update', existingActiveAlert);
      
      if (existingActiveAlert.workOrder) {
        await updateWorkOrderFromAlert(existingActiveAlert, threshold, deviation);
      } else if (alertLevel === config.alertLevels.HIGH || alertLevel === config.alertLevels.CRITICAL) {
        await generateWorkOrderFromAlert(existingActiveAlert, pond);
      }
      
      return existingActiveAlert;
    }
    
    const alert = new Alert({
      alertNo: generateAlertNo(),
      pond: pondId,
      sensorType,
      level: alertLevel,
      type: alertType,
      value,
      threshold,
      unit: getSensorUnit(sensorType),
      message: generateAlertMessage(sensorType, alertType, value, threshold, alertLevel, deviation)
    });
    
    await alert.save();
    
    updatePondStatus(pondId, alertLevel);
    
    if (alertLevel === config.alertLevels.HIGH || alertLevel === config.alertLevels.CRITICAL) {
      await generateWorkOrderFromAlert(alert, pond);
    }
    
    websocket.emitToAll('alert:new', alert);
    
    return alert;
  } catch (error) {
    console.error('生成告警失败:', error);
    return null;
  }
};

const getAlerts = async (req, res, next) => {
  try {
    const { pondId, level, status, type, page = 1, limit = 20, startTime, endTime } = req.query;
    
    const query = {};
    
    if (pondId) query.pond = pondId;
    if (level) query.level = level;
    if (status) query.status = status;
    if (type) query.type = type;
    
    if (startTime || endTime) {
      query.timestamp = {};
      if (startTime) query.timestamp.$gte = new Date(startTime);
      if (endTime) query.timestamp.$lte = new Date(endTime);
    }
    
    const alerts = await Alert.find(query)
      .skip((page - 1) * limit)
      .limit(Number(limit))
      .sort({ timestamp: -1 })
      .populate('pond', 'pondNo name')
      .populate('acknowledgedBy', 'realName')
      .populate('resolvedBy', 'realName');
    
    const total = await Alert.countDocuments(query);
    
    res.json({
      success: true,
      data: alerts,
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

const getAlertById = async (req, res, next) => {
  try {
    const alert = await Alert.findById(req.params.id)
      .populate('pond', 'pondNo name')
      .populate('acknowledgedBy', 'realName')
      .populate('resolvedBy', 'realName')
      .populate('workOrder');
    
    if (!alert) {
      return res.status(404).json({ message: '告警不存在' });
    }
    
    res.json({
      success: true,
      data: alert
    });
  } catch (error) {
    next(error);
  }
};

const acknowledgeAlert = async (req, res, next) => {
  try {
    const alert = await Alert.findById(req.params.id);
    
    if (!alert) {
      return res.status(404).json({ message: '告警不存在' });
    }
    
    if (alert.status !== 'active') {
      return res.status(400).json({ message: '告警不是活跃状态' });
    }
    
    alert.status = 'acknowledged';
    alert.acknowledgedBy = req.user.id;
    alert.acknowledgedAt = Date.now();
    
    await alert.save();
    
    websocket.emitToAll('alert:update', alert);
    
    res.json({
      success: true,
      data: alert
    });
  } catch (error) {
    next(error);
  }
};

const resolveAlert = async (req, res, next) => {
  try {
    const alert = await Alert.findById(req.params.id);
    
    if (!alert) {
      return res.status(404).json({ message: '告警不存在' });
    }
    
    alert.status = 'resolved';
    alert.resolvedBy = req.user.id;
    alert.resolvedAt = Date.now();
    
    const now = new Date();
    alert.duration = (now - new Date(alert.timestamp)) / 1000 / 60;
    
    await alert.save();
    
    checkAndUpdatePondStatus(alert.pond);
    
    websocket.emitToAll('alert:update', alert);
    
    res.json({
      success: true,
      data: alert
    });
  } catch (error) {
    next(error);
  }
};

const getAlertStatistics = async (req, res, next) => {
  try {
    const { startTime, endTime, pondId } = req.query;
    
    const match = {};
    if (startTime || endTime) {
      match.timestamp = {};
      if (startTime) match.timestamp.$gte = new Date(startTime);
      if (endTime) match.timestamp.$lte = new Date(endTime);
    }
    if (pondId) match.pond = mongoose.Types.ObjectId(pondId);
    
    const stats = await Alert.aggregate([
      { $match: match },
      {
        $group: {
          _id: '$level',
          count: { $sum: 1 }
        }
      }
    ]);
    
    const statusStats = await Alert.aggregate([
      { $match: match },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      }
    ]);
    
    const result = {
      total: 0,
      low: 0,
      medium: 0,
      high: 0,
      critical: 0,
      active: 0,
      acknowledged: 0,
      resolved: 0,
      closed: 0
    };
    
    stats.forEach(item => {
      result.total += item.count;
      result[item._id] = item.count;
    });
    
    statusStats.forEach(item => {
      result[item._id] = item.count;
    });
    
    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    next(error);
  }
};

const getThresholdForSensor = (sensorType, thresholds, value) => {
  if (!thresholds) return { threshold: 0, direction: null, thresholdType: null };
  
  let min = null, max = null;
  
  switch (sensorType) {
    case 'temperature':
      min = thresholds.temperatureMin;
      max = thresholds.temperatureMax;
      break;
    case 'oxygen':
      min = thresholds.oxygenMin;
      max = null;
      break;
    case 'ph':
      min = thresholds.phMin;
      max = thresholds.phMax;
      break;
    default:
      return { threshold: 0, direction: null, thresholdType: null };
  }
  
  if (min !== null && value !== undefined && value < min) {
    return { threshold: min, direction: 'below_threshold', thresholdType: '下限' };
  }
  if (max !== null && value !== undefined && value > max) {
    return { threshold: max, direction: 'over_threshold', thresholdType: '上限' };
  }
  
  if (min !== null) {
    return { threshold: min, direction: 'below_threshold', thresholdType: '下限' };
  }
  return { threshold: max, direction: 'over_threshold', thresholdType: '上限' };
};

const getSensorUnit = (sensorType) => {
  const units = {
    temperature: '°C',
    oxygen: 'mg/L',
    ph: '',
    activity: '%',
    water_level: 'm',
    turbidity: 'NTU'
  };
  return units[sensorType] || '';
};

const generateAlertMessage = (sensorType, alertType, value, threshold, level, deviation) => {
  const sensorNames = {
    temperature: '水温',
    oxygen: '溶氧',
    ph: 'pH值',
    activity: '鱼群活动量',
    water_level: '水位',
    turbidity: '浊度'
  };
  
  const levelNames = {
    low: '低',
    medium: '中',
    high: '高',
    critical: '严重'
  };
  
  const sensorName = sensorNames[sensorType] || sensorType;
  const direction = alertType === 'below_threshold' ? '低于' : '超过';
  const thresholdType = alertType === 'below_threshold' ? '下限' : '上限';
  const levelName = levelNames[level] || level;
  const unit = getSensorUnit(sensorType);
  const devText = deviation !== undefined && deviation !== null ? `，偏离${Math.round(deviation * 100) / 100}%` : '';
  
  return `【${levelName}级预警】${sensorName}${direction}${thresholdType}阈值：当前值${value}${unit}，${thresholdType}阈值${threshold}${unit}${devText}`;
};

const updatePondStatus = async (pondId, alertLevel) => {
  const pond = await Pond.findById(pondId);
  if (!pond) return;
  
  if (alertLevel === config.alertLevels.CRITICAL || alertLevel === config.alertLevels.HIGH) {
    if (pond.status !== 'critical') {
      pond.status = 'critical';
      await pond.save();
      websocket.emitToAll('pond:update', pond);
    }
  } else if (alertLevel === config.alertLevels.MEDIUM) {
    if (pond.status === 'normal') {
      pond.status = 'warning';
      await pond.save();
      websocket.emitToAll('pond:update', pond);
    }
  }
};

const checkAndUpdatePondStatus = async (pondId) => {
  const activeAlerts = await Alert.find({
    pond: pondId,
    status: { $in: ['active', 'acknowledged'] }
  });
  
  const pond = await Pond.findById(pondId);
  if (!pond) return;
  
  if (activeAlerts.length === 0) {
    pond.status = 'normal';
  } else {
    const hasCritical = activeAlerts.some(a => 
      a.level === config.alertLevels.CRITICAL || a.level === config.alertLevels.HIGH
    );
    
    pond.status = hasCritical ? 'critical' : 'warning';
  }
  
  await pond.save();
  websocket.emitToAll('pond:update', pond);
};

const generateWorkOrderFromAlert = async (alert, pond) => {
  try {
    const existingOrder = await WorkOrder.findOne({
      pond: alert.pond,
      type: config.workOrderType.WATER_QUALITY_ALERT,
      alertType: alert.sensorType,
      status: { $in: [
        config.workOrderStatus.PENDING,
        config.workOrderStatus.ASSIGNED,
        config.workOrderStatus.IN_PROGRESS
      ]}
    });
    
    const thresholdType = alert.type === 'below_threshold' ? '下限' : '上限';
    const workOrderDescription = alert.message + `（阈值类型：${thresholdType}）`;
    const levelPriority = {
      low: 1,
      medium: 2,
      high: 3,
      critical: 4
    };
    
    if (existingOrder) {
      existingOrder.level = alert.level;
      existingOrder.description = workOrderDescription;
      existingOrder.priority = levelPriority[alert.level] || existingOrder.priority;
      existingOrder.sensorData = [{
        sensorType: alert.sensorType,
        value: alert.value,
        threshold: alert.threshold,
        thresholdType: thresholdType,
        unit: alert.unit
      }];
      await existingOrder.save();
      
      alert.workOrder = existingOrder._id;
      await alert.save();
      
      websocket.emitToAll('workOrder:update', existingOrder);
      
      return existingOrder;
    }
    
    const order = new WorkOrder({
      orderNo: generateOrderNo(),
      type: config.workOrderType.WATER_QUALITY_ALERT,
      level: alert.level,
      pond: alert.pond,
      alertType: alert.sensorType,
      description: workOrderDescription,
      sensorData: [{
        sensorType: alert.sensorType,
        value: alert.value,
        threshold: alert.threshold,
        thresholdType: thresholdType,
        unit: alert.unit
      }],
      priority: levelPriority[alert.level] || (alert.level === config.alertLevels.CRITICAL ? 4 : 3)
    });
    
    await order.save();
    
    alert.workOrder = order._id;
    await alert.save();
    
    await autoAssignWorkOrder(order);
    
    websocket.emitToAll('workOrder:new', order);
    
    return order;
  } catch (error) {
    console.error('从告警生成工单失败:', error);
    return null;
  }
};

const updateWorkOrderFromAlert = async (alert, threshold, deviation) => {
  try {
    if (!alert.workOrder) return;
    
    const order = await WorkOrder.findById(alert.workOrder);
    if (!order) return;
    
    const thresholdType = alert.type === 'below_threshold' ? '下限' : '上限';
    order.level = alert.level;
    order.description = alert.message + `（阈值类型：${thresholdType}）`;
    order.sensorData = [{
      sensorType: alert.sensorType,
      value: alert.value,
      threshold: threshold || alert.threshold,
      thresholdType: thresholdType,
      unit: alert.unit,
      deviation: deviation
    }];
    
    const levelPriority = {
      low: 1,
      medium: 2,
      high: 3,
      critical: 4
    };
    order.priority = levelPriority[alert.level] || order.priority;
    
    await order.save();
    websocket.emitToAll('workOrder:update', order);
  } catch (error) {
    console.error('更新关联工单失败:', error);
  }
};

module.exports = {
  checkAndGenerateAlert,
  getAlerts,
  getAlertById,
  acknowledgeAlert,
  resolveAlert,
  getAlertStatistics,
  updatePondStatus,
  checkAndUpdatePondStatus,
  generateWorkOrderFromAlert,
  updateWorkOrderFromAlert
};
