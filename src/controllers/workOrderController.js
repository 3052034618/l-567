const WorkOrder = require('../models/WorkOrder');
const Alert = require('../models/Alert');
const Pond = require('../models/Pond');
const User = require('../models/User');
const config = require('../config');
const websocket = require('../utils/websocket');
const mongoose = require('mongoose');
const path = require('path');

const generateOrderNo = () => {
  const now = new Date();
  const dateStr = now.getFullYear().toString() + 
    (now.getMonth() + 1).toString().padStart(2, '0') +
    now.getDate().toString().padStart(2, '0');
  const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  return `WO${dateStr}${random}`;
};

const getWorkOrders = async (req, res, next) => {
  try {
    const { 
      pondId, status, level, type, assignedTo, 
      isStubbornDefect, page = 1, limit = 20,
      startTime, endTime
    } = req.query;
    
    const query = {};
    
    if (pondId) query.pond = pondId;
    if (status) query.status = status;
    if (level) query.level = level;
    if (type) query.type = type;
    if (assignedTo) query.assignedTo = assignedTo;
    if (isStubbornDefect !== undefined) query.isStubbornDefect = isStubbornDefect === 'true';
    
    if (startTime || endTime) {
      query.createdAt = {};
      if (startTime) query.createdAt.$gte = new Date(startTime);
      if (endTime) query.createdAt.$lte = new Date(endTime);
    }
    
    if (req.user.role === 'technician') {
      query.assignedTo = req.user.id;
    }
    
    const orders = await WorkOrder.find(query)
      .skip((page - 1) * limit)
      .limit(Number(limit))
      .sort({ priority: -1, createdAt: -1 })
      .populate('pond', 'pondNo name location')
      .populate('assignedTo', 'realName phone role')
      .populate('handledBy', 'realName')
      .populate('device', 'name type');
    
    const total = await WorkOrder.countDocuments(query);
    
    res.json({
      success: true,
      data: orders,
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

const getWorkOrderById = async (req, res, next) => {
  try {
    const order = await WorkOrder.findById(req.params.id)
      .populate('pond', 'pondNo name location')
      .populate('assignedTo', 'realName phone role')
      .populate('handledBy', 'realName')
      .populate('device', 'name type status')
      .populate('relatedOrders', 'orderNo status level createdAt');
    
    if (!order) {
      return res.status(404).json({ message: '工单不存在' });
    }
    
    res.json({
      success: true,
      data: order
    });
  } catch (error) {
    next(error);
  }
};

const createWorkOrder = async (req, res, next) => {
  try {
    const { 
      type, level, pond, device, alertType, description, 
      sensorData, priority 
    } = req.body;
    
    if (!type || !level || !pond) {
      return res.status(400).json({ message: '缺少必要参数' });
    }
    
    const pondDoc = await Pond.findById(pond);
    if (!pondDoc) {
      return res.status(404).json({ message: '养殖池不存在' });
    }
    
    const order = new WorkOrder({
      orderNo: generateOrderNo(),
      type,
      level,
      pond,
      device,
      alertType,
      description,
      sensorData,
      priority: priority || getDefaultPriority(level)
    });
    
    await order.save();
    
    await order.populate('pond', 'pondNo name');
    
    websocket.emitToAll('workOrder:new', order);
    
    res.status(201).json({
      success: true,
      data: order
    });
  } catch (error) {
    next(error);
  }
};

const assignWorkOrder = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { technicianId } = req.body;
    
    const order = await WorkOrder.findById(id);
    
    if (!order) {
      return res.status(404).json({ message: '工单不存在' });
    }
    
    if (order.status !== config.workOrderStatus.PENDING && 
        order.status !== config.workOrderStatus.ASSIGNED) {
      return res.status(400).json({ message: '当前工单状态不可分配' });
    }
    
    const technician = await User.findById(technicianId);
    if (!technician || technician.role !== 'technician' || technician.status !== 'active') {
      return res.status(400).json({ message: '技术员不存在或不可用' });
    }
    
    order.assignedTo = technicianId;
    order.status = config.workOrderStatus.ASSIGNED;
    order.assignedAt = Date.now();
    
    await order.save();
    await order.populate('assignedTo', 'realName phone');
    await order.populate('pond', 'pondNo name');
    
    websocket.emitToUser(technicianId, 'workOrder:assigned', order);
    websocket.emitToAll('workOrder:update', order);
    
    res.json({
      success: true,
      data: order
    });
  } catch (error) {
    next(error);
  }
};

const autoAssignWorkOrder = async (workOrder) => {
  try {
    const pond = await Pond.findById(workOrder.pond);
    if (!pond) return null;
    
    const technicians = await User.find({
      role: 'technician',
      status: 'active',
      'location.coordinates.0': { $ne: 0 },
      'location.coordinates.1': { $ne: 0 }
    });
    
    if (technicians.length === 0) {
      const allTechs = await User.find({
        role: 'technician',
        status: 'active'
      });
      if (allTechs.length > 0) {
        const techWithLeastOrders = await findTechnicianWithLeastOrders(allTechs);
        return await assignOrderToTechnician(workOrder, techWithLeastOrders._id);
      }
      return null;
    }
    
    const techniciansWithDistance = technicians.map(tech => ({
      tech,
      distance: calculateDistance(
        pond.location.coordinates[1],
        pond.location.coordinates[0],
        tech.location.coordinates[1],
        tech.location.coordinates[0]
      )
    }));
    
    techniciansWithDistance.sort((a, b) => a.distance - b.distance);
    
    const topCandidates = techniciansWithDistance.slice(0, 3);
    
    let bestTech = null;
    let bestScore = -1;
    
    for (const candidate of topCandidates) {
      const pendingOrders = await WorkOrder.countDocuments({
        assignedTo: candidate.tech._id,
        status: { $in: [config.workOrderStatus.PENDING, config.workOrderStatus.ASSIGNED, config.workOrderStatus.IN_PROGRESS] }
      });
      
      const distanceScore = Math.max(0, 100 - candidate.distance * 0.1);
      const workloadScore = Math.max(0, 100 - pendingOrders * 10);
      const skillScore = candidate.tech.skillLevel * 20;
      
      const totalScore = distanceScore * 0.4 + workloadScore * 0.3 + skillScore * 0.3;
      
      if (totalScore > bestScore) {
        bestScore = totalScore;
        bestTech = candidate.tech;
      }
    }
    
    if (bestTech) {
      return await assignOrderToTechnician(workOrder, bestTech._id);
    }
    
    return null;
  } catch (error) {
    console.error('自动分配工单失败:', error);
    return null;
  }
};

const assignOrderToTechnician = async (workOrder, technicianId) => {
  workOrder.assignedTo = technicianId;
  workOrder.status = config.workOrderStatus.ASSIGNED;
  workOrder.assignedAt = Date.now();
  await workOrder.save();
  
  websocket.emitToUser(technicianId.toString(), 'workOrder:assigned', workOrder);
  
  return workOrder;
};

const findTechnicianWithLeastOrders = async (technicians) => {
  let leastOrders = Infinity;
  let leastTech = null;
  
  for (const tech of technicians) {
    const count = await WorkOrder.countDocuments({
      assignedTo: tech._id,
      status: { $in: [config.workOrderStatus.PENDING, config.workOrderStatus.ASSIGNED, config.workOrderStatus.IN_PROGRESS] }
    });
    
    if (count < leastOrders) {
      leastOrders = count;
      leastTech = tech;
    }
  }
  
  return leastTech || technicians[0];
};

const calculateDistance = (lat1, lon1, lat2, lon2) => {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

const startWorkOrder = async (req, res, next) => {
  try {
    const { id } = req.params;
    
    const order = await WorkOrder.findById(id);
    
    if (!order) {
      return res.status(404).json({ message: '工单不存在' });
    }
    
    if (order.status !== config.workOrderStatus.ASSIGNED && 
        order.status !== config.workOrderStatus.PENDING) {
      return res.status(400).json({ message: '当前工单状态不可开始处理' });
    }
    
    if (req.user.role === 'technician' && order.assignedTo && 
        order.assignedTo.toString() !== req.user.id) {
      return res.status(403).json({ message: '无权限处理此工单' });
    }
    
    order.status = config.workOrderStatus.IN_PROGRESS;
    order.startedAt = Date.now();
    if (!order.assignedTo) {
      order.assignedTo = req.user.id;
      order.assignedAt = Date.now();
    }
    
    await order.save();
    await order.populate('pond', 'pondNo name');
    
    websocket.emitToAll('workOrder:update', order);
    
    res.json({
      success: true,
      data: order
    });
  } catch (error) {
    next(error);
  }
};

const completeWorkOrder = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { handlingNotes } = req.body;
    
    const order = await WorkOrder.findById(id);
    
    if (!order) {
      return res.status(404).json({ message: '工单不存在' });
    }
    
    if (order.status !== config.workOrderStatus.IN_PROGRESS && 
        order.status !== config.workOrderStatus.ASSIGNED) {
      return res.status(400).json({ message: '当前工单状态不可完成' });
    }
    
    order.status = config.workOrderStatus.COMPLETED;
    order.completedAt = Date.now();
    order.handledBy = req.user.id;
    order.handlingNotes = handlingNotes || order.handlingNotes;
    
    await order.save();
    await order.populate('pond', 'pondNo name');
    
    checkForStubbornDefect(order);
    
    resolveRelatedAlerts(order);
    
    websocket.emitToAll('workOrder:update', order);
    
    res.json({
      success: true,
      data: order
    });
  } catch (error) {
    next(error);
  }
};

const checkForStubbornDefect = async (workOrder, fromPhoto = false) => {
  try {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - config.stubbornDefectDays);
    
    const query = {
      _id: { $ne: workOrder._id },
      pond: workOrder.pond,
      type: workOrder.type,
      alertType: workOrder.alertType,
      $or: [
        { status: config.workOrderStatus.COMPLETED, completedAt: { $gte: thirtyDaysAgo } },
        { 'photos.0': { $exists: true }, createdAt: { $gte: thirtyDaysAgo } }
      ]
    };
    
    const similarOrders = await WorkOrder.find(query);
    
    const currentHasPhoto = workOrder.photos && workOrder.photos.length > 0;
    const isCurrentCompleted = workOrder.status === config.workOrderStatus.COMPLETED;
    
    let matchingCount = similarOrders.length;
    
    if (fromPhoto) {
      const photoSimilarOrders = similarOrders.filter(o => 
        (o.photos && o.photos.length > 0) || 
        o.status === config.workOrderStatus.COMPLETED
      );
      matchingCount = photoSimilarOrders.length;
    }
    
    if (matchingCount >= 2 && !workOrder.isStubbornDefect) {
      workOrder.isStubbornDefect = true;
      workOrder.relatedOrders = similarOrders.map(o => o._id);
      workOrder.notifiedSupervisor = true;
      await workOrder.save();
      
      await workOrder.populate('pond', 'pondNo name');
      
      const supervisors = await User.find({ role: 'supervisor', status: 'active' });
      supervisors.forEach(supervisor => {
        websocket.emitToUser(supervisor._id.toString(), 'stubbornDefect:new', {
          ...workOrder.toObject(),
          pond: workOrder.pond,
          triggeredBy: fromPhoto ? 'photo_upload' : 'completion',
          matchingCount: matchingCount + 1,
          message: `【顽固缺陷预警】${workOrder.pond?.pondNo || ''}${workOrder.alertType || workOrder.type}问题在30天内已出现${matchingCount + 1}次，请主管关注！`
        });
      });
      
      websocket.emitToAll('stubbornDefect:detected', {
        workOrderId: workOrder._id,
        pondNo: workOrder.pond?.pondNo,
        matchingCount: matchingCount + 1,
        triggeredBy: fromPhoto ? 'photo_upload' : 'completion'
      });
      
      for (const order of similarOrders) {
        if (!order.isStubbornDefect) {
          order.isStubbornDefect = true;
          await order.save();
        }
      }
      
      console.log(`[顽固缺陷] 检测到顽固缺陷！工单: ${workOrder.orderNo}, 池号: ${workOrder.pond?.pondNo}, 同类问题次数: ${matchingCount + 1}`);
      
      return true;
    }
    
    return false;
  } catch (error) {
    console.error('检查顽固缺陷失败:', error);
    return false;
  }
};

const resolveRelatedAlerts = async (workOrder) => {
  try {
    if (workOrder.type === config.workOrderType.WATER_QUALITY_ALERT) {
      const activeAlerts = await Alert.find({
        pond: workOrder.pond,
        status: { $in: ['active', 'acknowledged'] }
      });
      
      for (const alert of activeAlerts) {
        alert.workOrder = workOrder._id;
        alert.status = 'resolved';
        alert.resolvedAt = Date.now();
        await alert.save();
        websocket.emitToAll('alert:update', alert);
      }
    }
  } catch (error) {
    console.error('解决关联告警失败:', error);
  }
};

const getDefaultPriority = (level) => {
  const priorities = {
    low: 1,
    medium: 2,
    high: 3,
    critical: 4
  };
  return priorities[level] || 1;
};

const getWorkOrderStatistics = async (req, res, next) => {
  try {
    const { startTime, endTime, pondId } = req.query;
    
    const match = {};
    if (startTime || endTime) {
      match.createdAt = {};
      if (startTime) match.createdAt.$gte = new Date(startTime);
      if (endTime) match.createdAt.$lte = new Date(endTime);
    }
    if (pondId) match.pond = mongoose.Types.ObjectId(pondId);
    
    const statusStats = await WorkOrder.aggregate([
      { $match: match },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      }
    ]);
    
    const levelStats = await WorkOrder.aggregate([
      { $match: match },
      {
        $group: {
          _id: '$level',
          count: { $sum: 1 }
        }
      }
    ]);
    
    const typeStats = await WorkOrder.aggregate([
      { $match: match },
      {
        $group: {
          _id: '$type',
          count: { $sum: 1 }
        }
      }
    ]);
    
    const result = {
      total: 0,
      pending: 0,
      assigned: 0,
      in_progress: 0,
      completed: 0,
      cancelled: 0,
      low: 0,
      medium: 0,
      high: 0,
      critical: 0,
      byType: {}
    };
    
    statusStats.forEach(item => {
      result.total += item.count;
      result[item._id] = item.count;
    });
    
    levelStats.forEach(item => {
      result[item._id] = item.count;
    });
    
    typeStats.forEach(item => {
      result.byType[item._id] = item.count;
    });
    
    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    next(error);
  }
};

const getMyWorkOrders = async (req, res, next) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    
    const query = { assignedTo: req.user.id };
    if (status) query.status = status;
    
    const orders = await WorkOrder.find(query)
      .skip((page - 1) * limit)
      .limit(Number(limit))
      .sort({ priority: -1, createdAt: -1 })
      .populate('pond', 'pondNo name location')
      .populate('device', 'name type');
    
    const total = await WorkOrder.countDocuments(query);
    
    res.json({
      success: true,
      data: orders,
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

const uploadWorkOrderPhoto = async (req, res, next) => {
  try {
    const { id } = req.params;
    
    const order = await WorkOrder.findById(id);
    
    if (!order) {
      return res.status(404).json({ message: '工单不存在' });
    }
    
    if (!req.file) {
      return res.status(400).json({ message: '没有上传文件' });
    }
    
    if (req.user.role === 'technician' && order.assignedTo && 
        order.assignedTo.toString() !== req.user.id) {
      return res.status(403).json({ message: '无权限操作此工单' });
    }
    
    const photoUrl = `/uploads/photos/${req.file.filename}`;
    
    order.photos.push({
      url: photoUrl,
      uploadedAt: Date.now(),
      uploadedBy: req.user.id
    });
    
    await order.save();
    await order.populate('uploadedBy', 'realName');
    
    websocket.emitToAll('workOrder:photo', {
      orderId: order._id,
      photo: order.photos[order.photos.length - 1]
    });
    
    const isStubborn = await checkForStubbornDefect(order, true);
    
    res.json({
      success: true,
      data: {
        url: photoUrl,
        uploadedAt: Date.now(),
        isStubbornDefect: isStubborn,
        stubbornDefectNotified: isStubborn
      }
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getWorkOrders,
  getWorkOrderById,
  createWorkOrder,
  assignWorkOrder,
  autoAssignWorkOrder,
  startWorkOrder,
  completeWorkOrder,
  getWorkOrderStatistics,
  getMyWorkOrders,
  uploadWorkOrderPhoto,
  generateOrderNo
};
