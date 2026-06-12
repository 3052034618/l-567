const FeedingRecord = require('../models/FeedingRecord');
const Pond = require('../models/Pond');
const FishSpecies = require('../models/FishSpecies');
const Device = require('../models/Device');
const WorkOrder = require('../models/WorkOrder');
const config = require('../config');
const websocket = require('../utils/websocket');
const { generateOrderNo, autoAssignWorkOrder } = require('./workOrderController');
const mongoose = require('mongoose');

const calculateFeedAmount = async (pondId) => {
  try {
    const pond = await Pond.findById(pondId).populate('fishSpecies');
    
    if (!pond) {
      return { error: '养殖池不存在' };
    }
    
    const species = pond.fishSpecies;
    if (!species) {
      return { error: '鱼种信息不存在' };
    }
    
    const daysSinceStock = Math.floor((Date.now() - new Date(pond.stockDate)) / (1000 * 60 * 60 * 24));
    const growthStage = getCurrentGrowthStage(species, daysSinceStock);
    
    if (!growthStage) {
      return { error: '无法确定生长阶段' };
    }
    
    const biomass = pond.totalBiomass || (pond.currentStockCount * pond.averageWeight);
    
    if (biomass <= 0) {
      return { error: '生物量数据无效' };
    }
    
    let baseFeedAmount = biomass * growthStage.feedRate / 100;
    
    const temperature = pond.currentWaterQuality?.temperature;
    const temperatureFactor = calculateTemperatureFactor(temperature, species);
    baseFeedAmount *= temperatureFactor;
    
    const activity = pond.currentWaterQuality?.activity;
    const activityFactor = calculateActivityFactor(activity);
    baseFeedAmount *= activityFactor;
    
    const historicalRate = await calculateHistoricalFeedRate(pondId);
    baseFeedAmount *= historicalRate;
    
    baseFeedAmount = Math.max(0, baseFeedAmount);
    
    return {
      amount: Math.round(baseFeedAmount * 100) / 100,
      factors: {
        biomass,
        feedRate: growthStage.feedRate,
        temperature: temperature || null,
        temperatureFactor,
        activity: activity || null,
        activityFactor,
        historicalRate,
        growthStage: growthStage.name
      }
    };
  } catch (error) {
    console.error('计算投喂量失败:', error);
    return { error: error.message };
  }
};

const getCurrentGrowthStage = (species, daysSinceStock) => {
  if (!species.growthStages || species.growthStages.length === 0) {
    return null;
  }
  
  let accumulatedDays = 0;
  let currentStage = species.growthStages[0];
  
  for (const stage of species.growthStages) {
    accumulatedDays += stage.days;
    if (daysSinceStock <= accumulatedDays) {
      currentStage = stage;
      break;
    }
    currentStage = stage;
  }
  
  return currentStage;
};

const calculateTemperatureFactor = (temperature, species) => {
  if (!temperature || !species) return 1;
  
  const optimal = species.optimalTemperature?.optimal;
  if (!optimal) return 1;
  
  const diff = Math.abs(temperature - optimal);
  
  if (diff <= 1) return 1;
  if (diff <= 3) return 0.9;
  if (diff <= 5) return 0.7;
  return 0.5;
};

const calculateActivityFactor = (activity) => {
  if (!activity) return 1;
  
  if (activity >= 80) return 1.1;
  if (activity >= 60) return 1;
  if (activity >= 40) return 0.9;
  if (activity >= 20) return 0.7;
  return 0.5;
};

const calculateHistoricalFeedRate = async (pondId) => {
  try {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    
    const records = await FeedingRecord.find({
      pond: pondId,
      status: 'completed',
      date: { $gte: sevenDaysAgo }
    }).sort({ date: -1 }).limit(7);
    
    if (records.length === 0) return 1;
    
    let totalConsumedRatio = 0;
    let count = 0;
    
    for (const record of records) {
      if (record.consumedRatio !== undefined && record.consumedRatio !== null) {
        totalConsumedRatio += record.consumedRatio;
        count++;
      }
    }
    
    if (count === 0) return 1;
    
    const avgConsumedRatio = totalConsumedRatio / count / 100;
    
    if (avgConsumedRatio > 0.95) return 1.05;
    if (avgConsumedRatio > 0.85) return 1;
    if (avgConsumedRatio > 0.7) return 0.9;
    if (avgConsumedRatio > 0.5) return 0.8;
    return 0.7;
  } catch (error) {
    console.error('计算历史摄食率失败:', error);
    return 1;
  }
};

const triggerFeeding = async (req, res, next) => {
  try {
    const { pondId, amount, feedingType = 'manual' } = req.body;
    
    if (!pondId) {
      return res.status(400).json({ message: '缺少养殖池ID' });
    }
    
    const pond = await Pond.findById(pondId);
    if (!pond) {
      return res.status(404).json({ message: '养殖池不存在' });
    }
    
    let feedAmount = amount;
    let calculationFactors = {};
    
    if (!feedAmount) {
      const result = await calculateFeedAmount(pondId);
      if (result.error) {
        return res.status(400).json({ message: result.error });
      }
      feedAmount = result.amount;
      calculationFactors = result.factors;
    }
    
    const feeder = await Device.findOne({
      pond: pondId,
      type: config.deviceTypes.FEEDER,
      status: { $ne: config.deviceStatus.FAULT }
    });
    
    const feedingRecord = new FeedingRecord({
      pond: pondId,
      feeder: feeder?._id || null,
      scheduledTime: Date.now(),
      actualTime: null,
      plannedAmount: feedAmount,
      actualAmount: null,
      feedingType,
      status: feeder ? 'scheduled' : 'failed',
      calculationFactors,
      triggeredBy: req.user?.id || null,
      failureReason: feeder ? null : '没有可用的投喂设备',
      date: new Date().setHours(0, 0, 0, 0)
    });
    
    await feedingRecord.save();
    await feedingRecord.populate('pond', 'pondNo name');
    
    if (feeder) {
      const success = await executeFeedingCommand(feeder, feedAmount, feedingRecord);
      if (!success) {
        feedingRecord.status = 'failed';
        feedingRecord.failureReason = '投喂设备执行失败';
        await feedingRecord.save();
        
        await generateFeederFaultOrder(pondId, feeder, '投喂执行失败');
      }
    }
    
    websocket.emitToAll('feeding:new', feedingRecord);
    
    res.status(201).json({
      success: true,
      data: feedingRecord
    });
  } catch (error) {
    next(error);
  }
};

const executeFeedingCommand = async (feeder, amount, feedingRecord) => {
  try {
    feeder.status = config.deviceStatus.RUNNING;
    await feeder.save();
    
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    feedingRecord.status = 'completed';
    feedingRecord.actualTime = Date.now();
    feedingRecord.actualAmount = amount;
    feedingRecord.consumedRatio = 85 + Math.random() * 15;
    await feedingRecord.save();
    
    feeder.status = config.deviceStatus.STOPPED;
    await feeder.save();
    
    websocket.emitToAll('feeding:complete', feedingRecord);
    
    return true;
  } catch (error) {
    console.error('执行投喂指令失败:', error);
    return false;
  }
};

const generateFeederFaultOrder = async (pondId, feeder, faultMessage) => {
  try {
    const order = new WorkOrder({
      orderNo: generateOrderNo(),
      type: config.workOrderType.FEEDER_FAULT,
      level: config.alertLevels.HIGH,
      pond: pondId,
      device: feeder._id,
      alertType: 'feeder_fault',
      description: `投喂设备故障：${faultMessage}`,
      priority: 3
    });
    
    await order.save();
    await order.populate('pond', 'pondNo name');
    await order.populate('device', 'name');
    
    await autoAssignWorkOrder(order);
    
    websocket.emitToAll('workOrder:new', order);
    
    return order;
  } catch (error) {
    console.error('生成投喂设备故障工单失败:', error);
    return null;
  }
};

const getFeedingRecords = async (req, res, next) => {
  try {
    const { 
      pondId, status, feedingType, 
      page = 1, limit = 20,
      startTime, endTime
    } = req.query;
    
    const query = {};
    
    if (pondId) query.pond = pondId;
    if (status) query.status = status;
    if (feedingType) query.feedingType = feedingType;
    
    if (startTime || endTime) {
      query.date = {};
      if (startTime) query.date.$gte = new Date(startTime);
      if (endTime) query.date.$lte = new Date(endTime);
    }
    
    const records = await FeedingRecord.find(query)
      .skip((page - 1) * limit)
      .limit(Number(limit))
      .sort({ scheduledTime: -1 })
      .populate('pond', 'pondNo name')
      .populate('feeder', 'name')
      .populate('triggeredBy', 'realName');
    
    const total = await FeedingRecord.countDocuments(query);
    
    res.json({
      success: true,
      data: records,
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

const getFeedingRecordById = async (req, res, next) => {
  try {
    const record = await FeedingRecord.findById(req.params.id)
      .populate('pond', 'pondNo name')
      .populate('feeder', 'name type status')
      .populate('triggeredBy', 'realName');
    
    if (!record) {
      return res.status(404).json({ message: '投喂记录不存在' });
    }
    
    res.json({
      success: true,
      data: record
    });
  } catch (error) {
    next(error);
  }
};

const getFeedingStatistics = async (req, res, next) => {
  try {
    const { pondId, startTime, endTime } = req.query;
    
    const match = {};
    if (pondId) match.pond = mongoose.Types.ObjectId(pondId);
    if (startTime || endTime) {
      match.date = {};
      if (startTime) match.date.$gte = new Date(startTime);
      if (endTime) match.date.$lte = new Date(endTime);
    }
    
    const stats = await FeedingRecord.aggregate([
      { $match: match },
      {
        $group: {
          _id: null,
          totalFeed: { $sum: '$actualAmount' },
          totalPlanned: { $sum: '$plannedAmount' },
          count: { $sum: 1 },
          completedCount: {
            $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] }
          },
          avgConsumedRatio: { $avg: '$consumedRatio' }
        }
      }
    ]);
    
    const dailyStats = await FeedingRecord.aggregate([
      { $match: match },
      {
        $group: {
          _id: '$date',
          totalFeed: { $sum: '$actualAmount' },
          count: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]);
    
    res.json({
      success: true,
      data: {
        summary: stats[0] || {
          totalFeed: 0,
          totalPlanned: 0,
          count: 0,
          completedCount: 0,
          avgConsumedRatio: 0
        },
        daily: dailyStats
      }
    });
  } catch (error) {
    next(error);
  }
};

const calculateFeedAmountApi = async (req, res, next) => {
  try {
    const { pondId } = req.params;
    
    const result = await calculateFeedAmount(pondId);
    
    if (result.error) {
      return res.status(400).json({ message: result.error });
    }
    
    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    next(error);
  }
};

const scheduleFeeding = async (pondId, scheduledTime) => {
  try {
    const result = await calculateFeedAmount(pondId);
    
    if (result.error) {
      console.error('计划投喂失败:', result.error);
      return null;
    }
    
    const feeder = await Device.findOne({
      pond: pondId,
      type: config.deviceTypes.FEEDER,
      status: { $ne: config.deviceStatus.FAULT }
    });
    
    const feedingRecord = new FeedingRecord({
      pond: pondId,
      feeder: feeder?._id || null,
      scheduledTime: scheduledTime || Date.now(),
      plannedAmount: result.amount,
      feedingType: 'scheduled',
      status: feeder ? 'scheduled' : 'failed',
      calculationFactors: result.factors,
      failureReason: feeder ? null : '没有可用的投喂设备',
      date: new Date().setHours(0, 0, 0, 0)
    });
    
    await feedingRecord.save();
    
    return feedingRecord;
  } catch (error) {
    console.error('创建计划投喂失败:', error);
    return null;
  }
};

module.exports = {
  calculateFeedAmount,
  triggerFeeding,
  getFeedingRecords,
  getFeedingRecordById,
  getFeedingStatistics,
  calculateFeedAmountApi,
  scheduleFeeding,
  generateFeederFaultOrder
};
