const FeedingSchedule = require('../models/FeedingSchedule');
const FeedingRecord = require('../models/FeedingRecord');
const Pond = require('../models/Pond');
const FishSpecies = require('../models/FishSpecies');
const Device = require('../models/Device');
const WorkOrder = require('../models/WorkOrder');
const config = require('../config');
const websocket = require('../utils/websocket');
const { generateOrderNo, autoAssignWorkOrder } = require('./workOrderController');
const { calculateFeedAmount, getCurrentGrowthStage, executeFeedingCommand, generateFeederFaultOrder } = require('./feedingController');
const mongoose = require('mongoose');

const getFeedingSchedules = async (req, res, next) => {
  try {
    const { pondId, isActive, page = 1, limit = 20 } = req.query;
    
    const query = {};
    if (pondId) query.pond = pondId;
    if (isActive !== undefined) query.isActive = isActive === 'true';
    
    const schedules = await FeedingSchedule.find(query)
      .skip((page - 1) * limit)
      .limit(Number(limit))
      .sort({ createdAt: -1 })
      .populate('pond', 'pondNo name')
      .populate('fishSpecies', 'name')
      .populate('createdBy', 'realName')
      .populate('updatedBy', 'realName');
    
    const total = await FeedingSchedule.countDocuments(query);
    
    res.json({
      success: true,
      data: schedules,
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

const getFeedingScheduleById = async (req, res, next) => {
  try {
    const schedule = await FeedingSchedule.findById(req.params.id)
      .populate('pond', 'pondNo name')
      .populate('fishSpecies', 'name growthStages')
      .populate('createdBy', 'realName')
      .populate('updatedBy', 'realName')
      .populate('suspensions.createdBy', 'realName');
    
    if (!schedule) {
      return res.status(404).json({ message: '投喂计划不存在' });
    }
    
    res.json({
      success: true,
      data: schedule
    });
  } catch (error) {
    next(error);
  }
};

const createFeedingSchedule = async (req, res, next) => {
  try {
    const { pondId, meals, totalDailyRate, effectiveFrom, notes } = req.body;
    
    if (!pondId || !meals || !meals.length) {
      return res.status(400).json({ message: '缺少必要参数：pondId和meals' });
    }
    
    const totalRatio = meals.reduce((sum, m) => sum + m.ratio, 0);
    if (Math.abs(totalRatio - 1) > 0.05) {
      return res.status(400).json({ 
        message: `餐次占比总和应接近1.0，当前为${totalRatio.toFixed(2)}` 
      });
    }
    
    const pond = await Pond.findById(pondId).populate('fishSpecies');
    if (!pond) {
      return res.status(404).json({ message: '养殖池不存在' });
    }
    
    let speciesId = pond.fishSpecies;
    if (speciesId && typeof speciesId === 'object' && speciesId._id) {
      speciesId = speciesId._id;
    }
    
    if (!speciesId) {
      return res.status(400).json({ message: '养殖池未关联鱼种' });
    }
    
    const species = await FishSpecies.findById(speciesId);
    if (!species) {
      return res.status(400).json({ message: '关联的鱼种不存在' });
    }
    
    let growthStageName = '未知';
    let feedRate = 3;
    if (pond.stockDate && species.growthStages && species.growthStages.length > 0) {
      const daysSinceStock = Math.floor((Date.now() - new Date(pond.stockDate)) / (1000 * 60 * 60 * 24));
      const growthStage = getCurrentGrowthStage(species, daysSinceStock);
      if (growthStage) {
        growthStageName = growthStage.name;
        feedRate = growthStage.feedRate;
      }
    }
    
    const scheduleRate = totalDailyRate || feedRate;
    
    const effectiveDate = effectiveFrom ? new Date(effectiveFrom) : new Date();
    effectiveDate.setHours(0, 0, 0, 0);
    
    const existingActive = await FeedingSchedule.findOne({
      pond: pondId,
      isActive: true
    });
    
    if (existingActive) {
      existingActive.isActive = false;
      existingActive.updatedBy = req.user?.id;
      await existingActive.save();
    }
    
    const schedule = new FeedingSchedule({
      pond: pondId,
      fishSpecies: speciesId,
      growthStage: growthStageName,
      meals: meals.map(m => ({
        time: m.time,
        ratio: m.ratio
      })),
      totalDailyRate: scheduleRate,
      isActive: true,
      effectiveFrom: effectiveDate,
      createdBy: req.user?.id,
      notes
    });
    
    await schedule.save();
    
    const populatedSchedule = await FeedingSchedule.findById(schedule._id)
      .populate('pond', 'pondNo name')
      .populate('fishSpecies', 'name')
      .populate('createdBy', 'realName');
    
    websocket.emitToAll('feedingSchedule:new', populatedSchedule);
    
    res.status(201).json({
      success: true,
      data: populatedSchedule
    });
  } catch (error) {
    console.error('创建投喂计划失败:', error);
    next(error);
  }
};

const updateFeedingSchedule = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { meals, totalDailyRate, notes } = req.body;
    
    const schedule = await FeedingSchedule.findById(id);
    if (!schedule) {
      return res.status(404).json({ message: '投喂计划不存在' });
    }
    
    if (meals) {
      const totalRatio = meals.reduce((sum, m) => sum + m.ratio, 0);
      if (Math.abs(totalRatio - 1) > 0.05) {
        return res.status(400).json({ 
          message: `餐次占比总和应接近1.0，当前为${totalRatio.toFixed(2)}` 
        });
      }
    }
    
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    
    const newSchedule = new FeedingSchedule({
      pond: schedule.pond,
      fishSpecies: schedule.fishSpecies,
      growthStage: schedule.growthStage,
      meals: meals ? meals.map(m => ({ time: m.time, ratio: m.ratio })) : schedule.meals,
      totalDailyRate: totalDailyRate !== undefined ? totalDailyRate : schedule.totalDailyRate,
      isActive: true,
      effectiveFrom: tomorrow,
      suspensions: schedule.suspensions.map(s => ({
        date: s.date,
        reason: s.reason,
        createdBy: s.createdBy,
        createdAt: s.createdAt
      })),
      createdBy: schedule.createdBy,
      updatedBy: req.user?.id,
      notes: notes !== undefined ? notes : schedule.notes,
      version: schedule.version + 1
    });
    
    await newSchedule.save();
    
    schedule.isActive = false;
    schedule.updatedBy = req.user?.id;
    await schedule.save();
    
    const populatedSchedule = await FeedingSchedule.findById(newSchedule._id)
      .populate('pond', 'pondNo name')
      .populate('fishSpecies', 'name')
      .populate('createdBy', 'realName')
      .populate('updatedBy', 'realName');
    
    websocket.emitToAll('feedingSchedule:update', {
      oldScheduleId: id,
      newSchedule: populatedSchedule,
      message: '计划已修改，新餐次明日生效，今日仍按原计划执行'
    });
    
    res.json({
      success: true,
      data: populatedSchedule,
      message: '投喂计划已修改，新餐次明日生效，今日仍按原计划执行'
    });
  } catch (error) {
    console.error('修改投喂计划失败:', error);
    next(error);
  }
};

const suspendFeeding = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { date, reason } = req.body;
    
    if (!date) {
      return res.status(400).json({ message: '必须指定停喂日期' });
    }
    
    const schedule = await FeedingSchedule.findById(id);
    if (!schedule) {
      return res.status(404).json({ message: '投喂计划不存在' });
    }
    
    schedule.addSuspension(date, reason, req.user.id);
    await schedule.save();
    await schedule.populate('pond', 'pondNo name');
    
    websocket.emitToAll('feedingSchedule:suspend', {
      scheduleId: id,
      pondNo: schedule.pond?.pondNo,
      date,
      reason
    });
    
    res.json({
      success: true,
      data: schedule,
      message: `已添加${new Date(date).toLocaleDateString('zh-CN')}的停喂记录`
    });
  } catch (error) {
    next(error);
  }
};

const resumeFeeding = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { date } = req.body;
    
    if (!date) {
      return res.status(400).json({ message: '必须指定恢复日期' });
    }
    
    const schedule = await FeedingSchedule.findById(id);
    if (!schedule) {
      return res.status(404).json({ message: '投喂计划不存在' });
    }
    
    schedule.removeSuspension(date);
    await schedule.save();
    await schedule.populate('pond', 'pondNo name');
    
    res.json({
      success: true,
      data: schedule,
      message: `已取消${new Date(date).toLocaleDateString('zh-CN')}的停喂记录`
    });
  } catch (error) {
    next(error);
  }
};

const executeScheduledFeedings = async () => {
  try {
    const now = new Date();
    const currentTime = now.getHours().toString().padStart(2, '0') + ':' + now.getMinutes().toString().padStart(2, '0');
    
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    
    const schedules = await FeedingSchedule.find({
      isActive: true,
      effectiveFrom: { $lte: now },
      'meals.time': currentTime
    });
    
    if (schedules.length === 0) {
      return;
    }
    
    for (const schedule of schedules) {
      try {
        const pond = await Pond.findById(schedule.pond).populate('fishSpecies');
        
        if (!pond || pond.status === 'maintenance') {
          console.log(`[定时投喂] 跳过池${schedule.pond}：维护中或不存在`);
          continue;
        }
        
        if (schedule.isSuspendedOn(now)) {
          console.log(`[定时投喂] 跳过池${pond.pondNo}：今日已停喂`);
          continue;
        }
        
        const currentMeal = schedule.meals.find(m => m.time === currentTime);
        if (!currentMeal) continue;
        
        const calcResult = await calculateFeedAmount(pond._id.toString());
        if (calcResult.error) {
          console.error(`[定时投喂] 池${pond.pondNo}计算投喂量失败: ${calcResult.error}`);
          continue;
        }
        
        const dailyTotal = calcResult.amount;
        const mealAmount = Math.round(dailyTotal * currentMeal.ratio * 100) / 100;
        
        if (mealAmount <= 0) {
          console.log(`[定时投喂] 池${pond.pondNo} ${currentTime} 计算投喂量为0，跳过`);
          continue;
        }
        
        const existingRecord = await FeedingRecord.findOne({
          pond: pond._id,
          feedingType: 'scheduled',
          scheduledTime: {
            $gte: new Date(now.getTime() - 5 * 60 * 1000),
            $lte: new Date(now.getTime() + 5 * 60 * 1000)
          }
        });
        
        if (existingRecord) {
          continue;
        }
        
        const feeder = await Device.findOne({
          pond: pond._id,
          type: config.deviceTypes.FEEDER,
          status: { $ne: config.deviceStatus.FAULT }
        });
        
        const feedingRecord = new FeedingRecord({
          pond: pond._id,
          feeder: feeder ? feeder._id : null,
          scheduledTime: now,
          plannedAmount: mealAmount,
          feedingType: 'scheduled',
          status: feeder ? 'scheduled' : 'failed',
          calculationFactors: {
            ...calcResult.factors,
            mealRatio: currentMeal.ratio,
            mealTime: currentMeal.time,
            dailyTotal
          },
          failureReason: feeder ? null : '没有可用的投喂设备',
          date: todayStart
        });
        
        await feedingRecord.save();
        await feedingRecord.populate('pond', 'pondNo name');
        
        if (!feeder) {
          console.warn(`[定时投喂] ${pond.pondNo}: 没有可用投喂设备，生成维修工单`);
          
          const faultFeeder = await Device.findOne({
            pond: pond._id,
            type: config.deviceTypes.FEEDER
          });
          
          const feederInfo = faultFeeder || {
            _id: new mongoose.Types.ObjectId(),
            name: '投喂机(未配置)'
          };
          
          await generateFeederFaultOrder(pond._id, feederInfo, '没有可用的投喂设备或所有设备均处于故障状态');
          
          websocket.emitToAll('feeding:new', feedingRecord);
          console.log(`[定时投喂] ${pond.pondNo} ${currentTime} 无投喂机，已记录失败并生成维修工单`);
          continue;
        }
        
        console.log(`[定时投喂] ${pond.pondNo} ${currentTime} 开始投喂，占比${(currentMeal.ratio * 100).toFixed(0)}%，计划${mealAmount}kg`);
        
        const success = await executeFeedingCommand(feeder, mealAmount, feedingRecord);
        
        if (!success) {
          feedingRecord.status = 'failed';
          feedingRecord.actualTime = Date.now();
          feedingRecord.failureReason = '投喂设备执行失败';
          await feedingRecord.save();
          
          await generateFeederFaultOrder(pond._id, feeder, '定时投喂执行失败，设备运行异常');
          console.error(`[定时投喂] ${pond.pondNo} ${currentTime} 投喂失败，已生成维修工单`);
        } else {
          console.log(`[定时投喂] ${pond.pondNo} ${currentTime} 投喂完成，实际${feedingRecord.actualAmount}kg`);
        }
        
        websocket.emitToAll('feeding:new', feedingRecord);
        websocket.emitToAll('feeding:complete', feedingRecord);
      } catch (scheduleError) {
        console.error(`[定时投喂] 处理计划${schedule._id}时出错:`, scheduleError.message);
      }
    }
  } catch (error) {
    console.error('[定时投喂] 执行失败:', error);
  }
};

module.exports = {
  getFeedingSchedules,
  getFeedingScheduleById,
  createFeedingSchedule,
  updateFeedingSchedule,
  suspendFeeding,
  resumeFeeding,
  executeScheduledFeedings
};
