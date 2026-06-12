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
    
    const existingSchedules = await FeedingSchedule.find({
      pond: pondId,
      status: { $in: ['active', 'superseded'] },
      effectiveFrom: { $lte: effectiveDate }
    }).sort({ effectiveFrom: -1, version: -1 });
    
    const previousSchedules = [];
    existingSchedules.forEach(s => {
      if (s.status === 'active' && s.effectiveFrom.getTime() <= effectiveDate.getTime()) {
        previousSchedules.push(s);
      }
    });
    
    const allExistingActive = await FeedingSchedule.find({
      pond: pondId,
      status: 'active'
    });
    
    let previousVersionId = null;
    let previousScheduleForMerge = null;
    for (const s of allExistingActive) {
      s.status = 'superseded';
      s.supersededAt = Date.now();
      s.updatedBy = req.user?.id;
      s.isActive = false;
      await s.save();
      if (!previousVersionId && s.version > (previousVersionId ? 1 : 0)) {
        previousVersionId = s._id;
        previousScheduleForMerge = s;
      }
    }
    
    const nextVersion = existingSchedules.length > 0 ? 
      Math.max(...existingSchedules.map(s => s.version)) + 1 : 1;
    
    const schedule = new FeedingSchedule({
      pond: pondId,
      fishSpecies: speciesId,
      growthStage: growthStageName,
      meals: meals.map(m => ({
        time: m.time,
        ratio: m.ratio
      })),
      totalDailyRate: scheduleRate,
      status: 'active',
      isActive: true,
      effectiveFrom: effectiveDate,
      createdBy: req.user?.id,
      notes,
      version: nextVersion,
      previousVersion: previousVersionId
    });
    
    if (previousScheduleForMerge) {
      schedule.mergeSuspensionsFrom(previousScheduleForMerge);
    }
    
    await schedule.save();
    
    const populatedSchedule = await FeedingSchedule.findById(schedule._id)
      .populate('pond', 'pondNo name')
      .populate('fishSpecies', 'name')
      .populate('createdBy', 'realName')
      .populate('previousVersion')
      .populate('suspensions.createdBy', 'realName');
    
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
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    const scheduleEffectiveDate = new Date(schedule.effectiveFrom);
    scheduleEffectiveDate.setHours(0, 0, 0, 0);
    
    let effectiveTargetDate;
    if (scheduleEffectiveDate.getTime() >= today.getTime()) {
      effectiveTargetDate = new Date(schedule.effectiveFrom);
    } else {
      effectiveTargetDate = tomorrow;
    }
    
    const schedulesToCheck = await FeedingSchedule.find({
      pond: schedule.pond,
      status: { $in: ['active', 'superseded'] },
      effectiveFrom: { $gte: today, $lte: effectiveTargetDate }
    });
    
    let allSuspensions = [];
    schedulesToCheck.forEach(s => {
      s.suspensions.forEach(sus => {
        const key = new Date(sus.date).setHours(0,0,0,0);
        if (!allSuspensions.find(existing => 
          new Date(existing.date).setHours(0,0,0,0) === key)) {
          allSuspensions.push(sus);
        }
      });
    });
    
    const allActiveSchedules = await FeedingSchedule.find({
      pond: schedule.pond,
      status: 'active'
    });
    
    for (const s of allActiveSchedules) {
      s.status = 'superseded';
      s.supersededAt = Date.now();
      s.updatedBy = req.user?.id;
      s.isActive = false;
      await s.save();
      s.suspensions.forEach(sus => {
        const key = new Date(sus.date).setHours(0,0,0,0);
        if (!allSuspensions.find(existing => 
          new Date(existing.date).setHours(0,0,0,0) === key)) {
          allSuspensions.push(sus);
        }
      });
    }
    
    const newSchedule = new FeedingSchedule({
      pond: schedule.pond,
      fishSpecies: schedule.fishSpecies,
      growthStage: schedule.growthStage,
      meals: meals ? meals.map(m => ({ time: m.time, ratio: m.ratio })) : schedule.meals,
      totalDailyRate: totalDailyRate !== undefined ? totalDailyRate : schedule.totalDailyRate,
      status: 'active',
      isActive: true,
      effectiveFrom: effectiveTargetDate,
      suspensions: allSuspensions.map(s => ({
        date: s.date,
        reason: s.reason,
        createdBy: s.createdBy,
        createdAt: s.createdAt
      })),
      createdBy: schedule.createdBy,
      updatedBy: req.user?.id,
      notes: notes !== undefined ? notes : schedule.notes,
      version: schedule.version + 1,
      previousVersion: schedule._id
    });
    
    await newSchedule.save();
    
    const populatedSchedule = await FeedingSchedule.findById(newSchedule._id)
      .populate('pond', 'pondNo name')
      .populate('fishSpecies', 'name')
      .populate('createdBy', 'realName')
      .populate('updatedBy', 'realName')
      .populate('previousVersion')
      .populate('suspensions.createdBy', 'realName');
    
    websocket.emitToAll('feedingSchedule:update', {
      oldScheduleId: id,
      newSchedule: populatedSchedule,
      effectiveFrom: effectiveTargetDate,
      message: scheduleEffectiveDate.getTime() >= today.getTime() 
        ? '计划已修改，因原计划尚未生效，新计划立即按原生效日期执行' 
        : '计划已修改，新餐次明日生效，今日仍按原计划执行'
    });
    
    res.json({
      success: true,
      data: populatedSchedule,
      message: scheduleEffectiveDate.getTime() >= today.getTime() 
        ? '计划已修改，新计划立即按原生效日期执行' 
        : '投喂计划已修改，新餐次明日生效，今日仍按原计划执行'
    });
  } catch (error) {
    console.error('修改投喂计划失败:', error);
    next(error);
  }
};

const suspendFeeding = async (req, res, next) => {
  try {
    const { pondId, date, reason } = req.body;
    
    if (!pondId || !date) {
      return res.status(400).json({ message: '必须指定养殖池ID和停喂日期' });
    }
    
    const targetDate = new Date(date);
    targetDate.setHours(0, 0, 0, 0);
    
    const pond = await Pond.findById(pondId);
    if (!pond) {
      return res.status(404).json({ message: '养殖池不存在' });
    }
    
    const allSchedules = await FeedingSchedule.find({
      pond: pondId,
      status: { $in: ['active', 'superseded'] },
      effectiveFrom: { $lte: targetDate }
    }).sort({ effectiveFrom: -1 });
    
    if (allSchedules.length === 0) {
      return res.status(404).json({ message: '该养殖池没有有效的投喂计划' });
    }
    
    const effectiveFromCutoff = new Date(targetDate);
    effectiveFromCutoff.setDate(effectiveFromCutoff.getDate() - 1);
    
    let updatedCount = 0;
    for (const schedule of allSchedules) {
      const scheduleEffective = new Date(schedule.effectiveFrom);
      scheduleEffective.setHours(0, 0, 0, 0);
      
      if (scheduleEffective.getTime() <= targetDate.getTime()) {
        if (!schedule.isSuspendedOn(date)) {
          schedule.addSuspension(date, reason, req.user?.id);
          await schedule.save();
          updatedCount++;
        }
      }
    }
    
    const currentSchedule = await FeedingSchedule.findEffectiveForDate(pondId, date);
    
    websocket.emitToAll('feedingSchedule:suspend', {
      pondId,
      pondNo: pond.pondNo,
      date,
      reason: reason || '临时停喂',
      updatedScheduleCount: updatedCount
    });
    
    res.json({
      success: true,
      data: {
        pondId,
        pondNo: pond.pondNo,
        date,
        reason: reason || '临时停喂',
        updatedScheduleCount: updatedCount,
        currentScheduleForDate: currentSchedule
      },
      message: `已为${new Date(date).toLocaleDateString('zh-CN')}添加停喂记录，同步到${updatedCount}个计划版本`
    });
  } catch (error) {
    console.error('停喂设置失败:', error);
    next(error);
  }
};

const resumeFeeding = async (req, res, next) => {
  try {
    const { pondId, date } = req.body;
    
    if (!pondId || !date) {
      return res.status(400).json({ message: '必须指定养殖池ID和恢复日期' });
    }
    
    const targetDate = new Date(date);
    targetDate.setHours(0, 0, 0, 0);
    
    const pond = await Pond.findById(pondId);
    if (!pond) {
      return res.status(404).json({ message: '养殖池不存在' });
    }
    
    const allSchedules = await FeedingSchedule.find({
      pond: pondId,
      status: { $in: ['active', 'superseded'] }
    });
    
    let updatedCount = 0;
    for (const schedule of allSchedules) {
      const beforeCount = schedule.suspensions.length;
      schedule.removeSuspension(date);
      if (schedule.suspensions.length !== beforeCount) {
        await schedule.save();
        updatedCount++;
      }
    }
    
    const currentSchedule = await FeedingSchedule.findEffectiveForDate(pondId, date);
    
    res.json({
      success: true,
      data: {
        pondId,
        pondNo: pond.pondNo,
        date,
        updatedScheduleCount: updatedCount,
        currentScheduleForDate: currentSchedule
      },
      message: `已取消${new Date(date).toLocaleDateString('zh-CN')}的停喂记录，同步到${updatedCount}个计划版本`
    });
  } catch (error) {
    console.error('恢复投喂失败:', error);
    next(error);
  }
};

const executeScheduledFeedings = async () => {
  try {
    const now = new Date();
    const currentTime = now.getHours().toString().padStart(2, '0') + ':' + now.getMinutes().toString().padStart(2, '0');
    
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    
    const allPonds = await Pond.find({ status: { $ne: 'maintenance' } });
    
    if (allPonds.length === 0) return;
    
    for (const pond of allPonds) {
      try {
        const schedule = await FeedingSchedule.findEffectiveForDate(pond._id, now);
        
        if (!schedule) continue;
        
        if (schedule.isSuspendedOn(now)) continue;
        
        if (!schedule.hasMealAt(currentTime)) continue;
        
        const mealRatio = schedule.getMealRatio(currentTime);
        if (!mealRatio) continue;
        
        const calcResult = await calculateFeedAmount(pond._id.toString());
        if (calcResult.error) continue;
        
        const dailyTotal = calcResult.amount;
        const mealAmount = Math.round(dailyTotal * mealRatio * 100) / 100;
        
        if (mealAmount <= 0) continue;
        
        const existingRecord = await FeedingRecord.findOne({
          pond: pond._id,
          feedingType: 'scheduled',
          scheduledTime: {
            $gte: new Date(now.getTime() - 5 * 60 * 1000),
            $lte: new Date(now.getTime() + 5 * 60 * 1000)
          }
        });
        
        if (existingRecord) continue;
        
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
            mealRatio,
            mealTime: currentTime,
            dailyTotal,
            scheduleId: schedule._id,
            scheduleVersion: schedule.version
          },
          failureReason: feeder ? null : '没有可用的投喂设备',
          date: todayStart
        });
        
        await feedingRecord.save();
        await feedingRecord.populate('pond', 'pondNo name');
        
        if (!feeder) {
          const faultFeeder = await Device.findOne({
            pond: pond._id,
            type: config.deviceTypes.FEEDER
          });
          
          const feederInfo = faultFeeder || {
            _id: new mongoose.Types.ObjectId(),
            name: '投喂机(未配置)'
          };
          
          const workOrder = await generateFeederFaultOrder(
            pond._id, 
            feederInfo, 
            '没有可用的投喂设备或所有设备均处于故障状态',
            feedingRecord._id
          );
          
          if (workOrder) {
            feedingRecord.workOrder = workOrder._id;
            await feedingRecord.save();
          }
          
          websocket.emitToAll('feeding:new', feedingRecord);
          continue;
        }
        
        const success = await executeFeedingCommand(feeder, mealAmount, feedingRecord);
        
        if (!success) {
          feedingRecord.status = 'failed';
          feedingRecord.actualTime = Date.now();
          feedingRecord.failureReason = '投喂设备执行失败';
          await feedingRecord.save();
          
          const workOrder = await generateFeederFaultOrder(
            pond._id, 
            feeder, 
            '定时投喂执行失败，设备运行异常',
            feedingRecord._id
          );
          
          if (workOrder) {
            feedingRecord.workOrder = workOrder._id;
            await feedingRecord.save();
          }
        }
        
        websocket.emitToAll('feeding:new', feedingRecord);
        websocket.emitToAll('feeding:complete', feedingRecord);
      } catch (pondError) {
        console.error(`[定时投喂] 处理池${pond.pondNo || pond._id}时出错:`, pondError.message);
      }
    }
  } catch (error) {
    console.error('[定时投喂] 执行失败:', error);
  }
};

const getPondScheduleTimeline = async (req, res, next) => {
  try {
    const { pondId } = req.params;
    
    const pond = await Pond.findById(pondId).populate('fishSpecies');
    if (!pond) {
      return res.status(404).json({ message: '养殖池不存在' });
    }
    
    const allVersions = await FeedingSchedule.findAllVersions(pondId);
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    const dayAfterTomorrow = new Date(today);
    dayAfterTomorrow.setDate(dayAfterTomorrow.getDate() + 2);
    
    const currentSchedule = await FeedingSchedule.findEffectiveForDate(pondId, today);
    const tomorrowSchedule = await FeedingSchedule.findEffectiveForDate(pondId, tomorrow);
    const dayAfterTomorrowSchedule = await FeedingSchedule.findEffectiveForDate(pondId, dayAfterTomorrow);
    
    const todaySuspensions = [];
    allVersions.forEach(s => {
      s.suspensions.forEach(sus => {
        const sd = new Date(sus.date);
        sd.setHours(0, 0, 0, 0);
        if (sd.getTime() >= today.getTime()) {
          if (!todaySuspensions.find(ts => 
            new Date(ts.date).setHours(0,0,0,0) === sd.getTime())) {
            todaySuspensions.push({
              ...sus._doc,
              fromVersion: s.version,
              fromVersionId: s._id
            });
          }
        }
      });
    });
    
    const timeline = allVersions.map((s, idx) => {
      const prev = s.previousVersion;
      const next = allVersions[idx + 1];
      
      const startDate = new Date(s.effectiveFrom);
      let endDate;
      if (s.status === 'active' && s.supersededAt) {
        endDate = new Date(s.supersededAt);
      } else if (next) {
        endDate = new Date(next.effectiveFrom);
        endDate.setDate(endDate.getDate() - 1);
      } else {
        endDate = null;
      }
      
      const isCurrent = currentSchedule && currentSchedule._id.toString() === s._id.toString();
      const isTomorrow = tomorrowSchedule && tomorrowSchedule._id.toString() === s._id.toString() && !isCurrent;
      const isFuture = dayAfterTomorrowSchedule && dayAfterTomorrowSchedule._id.toString() === s._id.toString() && !isCurrent && !isTomorrow;
      
      return {
        _id: s._id,
        version: s.version,
        status: s.status,
        growthStage: s.growthStage,
        totalDailyRate: s.totalDailyRate,
        meals: s.meals,
        mealsSummary: s.meals.map(m => `${m.time}(${(m.ratio * 100).toFixed(0)}%)`).join(', '),
        suspensions: s.suspensions,
        effectiveFrom: s.effectiveFrom,
        effectiveUntil: endDate,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
        supersededAt: s.supersededAt,
        createdBy: s.createdBy,
        updatedBy: s.updatedBy,
        previousVersion: prev ? {
          _id: prev._id,
          version: prev.version,
          mealsSummary: (prev.meals || []).map(m => `${m.time}(${(m.ratio * 100).toFixed(0)}%)`).join(', ')
        } : null,
        role: isCurrent ? 'current' : (isTomorrow ? 'tomorrow' : (isFuture ? 'future' : (s.status === 'archived' ? 'archived' : 'historical'))),
        notes: s.notes
      };
    });
    
    res.json({
      success: true,
      data: {
        pondId,
        pondNo: pond.pondNo,
        pondName: pond.name,
        fishSpecies: pond.fishSpecies?.name,
        current: timeline.find(t => t.role === 'current') || null,
        tomorrow: timeline.find(t => t.role === 'tomorrow') || null,
        timeline,
        upcomingSuspensions: todaySuspensions,
        versionCount: allVersions.length,
        currentVersion: currentSchedule?.version || null,
        tomorrowVersion: tomorrowSchedule?.version || null,
        changePreview: currentSchedule && tomorrowSchedule && currentSchedule.version !== tomorrowSchedule.version ? {
          fromVersion: currentSchedule.version,
          toVersion: tomorrowSchedule.version,
          fromMeals: currentSchedule.meals.map(m => `${m.time}(${(m.ratio * 100).toFixed(0)}%)`).join(', '),
          toMeals: tomorrowSchedule.meals.map(m => `${m.time}(${(m.ratio * 100).toFixed(0)}%)`).join(', ')
        } : null
      }
    });
  } catch (error) {
    console.error('查询时间线失败:', error);
    next(error);
  }
};

module.exports = {
  getFeedingSchedules,
  getFeedingScheduleById,
  createFeedingSchedule,
  updateFeedingSchedule,
  suspendFeeding,
  resumeFeeding,
  executeScheduledFeedings,
  getPondScheduleTimeline
};
