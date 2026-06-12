const Pond = require('../models/Pond');
const FishSpecies = require('../models/FishSpecies');
const SensorData = require('../models/SensorData');
const FeedingRecord = require('../models/FeedingRecord');
const Alert = require('../models/Alert');
const WorkOrder = require('../models/WorkOrder');
const Device = require('../models/Device');
const { getGrowthStage, calculateOptimalThresholds } = require('./fishSpeciesController');

const getPonds = async (req, res, next) => {
  try {
    const { status, fishSpecies, page = 1, limit = 10, keyword } = req.query;
    
    const query = {};
    
    if (status) query.status = status;
    if (fishSpecies) query.fishSpecies = fishSpecies;
    if (keyword) {
      query.$or = [
        { pondNo: { $regex: keyword, $options: 'i' } },
        { name: { $regex: keyword, $options: 'i' } }
      ];
    }
    
    const ponds = await Pond.find(query)
      .skip((page - 1) * limit)
      .limit(Number(limit))
      .sort({ pondNo: 1 })
      .populate('fishSpecies', 'name')
      .populate('assignedWorker', 'realName phone');
    
    const total = await Pond.countDocuments(query);
    
    res.json({
      success: true,
      data: ponds,
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

const getPondById = async (req, res, next) => {
  try {
    const pond = await Pond.findById(req.params.id)
      .populate('fishSpecies')
      .populate('assignedWorker', 'realName phone role')
      .populate('devices');
    
    if (!pond) {
      return res.status(404).json({ message: '养殖池不存在' });
    }
    
    res.json({
      success: true,
      data: pond
    });
  } catch (error) {
    next(error);
  }
};

const createPond = async (req, res, next) => {
  try {
    const { pondNo, name, area, depth, fishSpecies, stockDate, initialStockCount, averageWeight, location, assignedWorker } = req.body;
    
    const volume = area * depth;
    
    const species = await FishSpecies.findById(fishSpecies);
    if (!species) {
      return res.status(400).json({ message: '鱼种不存在' });
    }
    
    const daysSinceStock = Math.floor((Date.now() - new Date(stockDate)) / (1000 * 60 * 60 * 24));
    const growthStage = getGrowthStage(species, daysSinceStock);
    const thresholds = calculateOptimalThresholds(species, growthStage);
    
    const pond = new Pond({
      pondNo,
      name,
      area,
      depth,
      volume,
      fishSpecies,
      stockDate,
      initialStockCount,
      currentStockCount: initialStockCount,
      averageWeight: averageWeight || 0,
      location,
      assignedWorker,
      thresholds,
      growthStage: growthStage?.name
    });
    
    await pond.save();
    
    res.status(201).json({
      success: true,
      data: pond
    });
  } catch (error) {
    next(error);
  }
};

const updatePond = async (req, res, next) => {
  try {
    const pond = await Pond.findById(req.params.id);
    
    if (!pond) {
      return res.status(404).json({ message: '养殖池不存在' });
    }
    
    const { area, depth, fishSpecies, stockDate, currentStockCount, averageWeight } = req.body;
    
    if (area || depth) {
      pond.area = area || pond.area;
      pond.depth = depth || pond.depth;
      pond.volume = pond.area * pond.depth;
    }
    
    if (fishSpecies && fishSpecies !== pond.fishSpecies.toString()) {
      const species = await FishSpecies.findById(fishSpecies);
      if (!species) {
        return res.status(400).json({ message: '鱼种不存在' });
      }
      pond.fishSpecies = fishSpecies;
    }
    
    if (currentStockCount !== undefined) pond.currentStockCount = currentStockCount;
    if (averageWeight !== undefined) pond.averageWeight = averageWeight;
    
    if (req.body.name) pond.name = req.body.name;
    if (req.body.location) pond.location = req.body.location;
    if (req.body.assignedWorker !== undefined) pond.assignedWorker = req.body.assignedWorker;
    if (req.body.status) pond.status = req.body.status;
    if (req.body.notes !== undefined) pond.notes = req.body.notes;
    if (stockDate) pond.stockDate = stockDate;
    
    if (fishSpecies || stockDate || pond.fishSpecies) {
      const species = await FishSpecies.findById(pond.fishSpecies);
      if (species && pond.stockDate) {
        const daysSinceStock = Math.floor((Date.now() - new Date(pond.stockDate)) / (1000 * 60 * 60 * 24));
        const growthStage = getGrowthStage(species, daysSinceStock);
        pond.thresholds = calculateOptimalThresholds(species, growthStage);
        pond.growthStage = growthStage?.name;
      }
    }
    
    await pond.save();
    
    res.json({
      success: true,
      data: pond
    });
  } catch (error) {
    next(error);
  }
};

const deletePond = async (req, res, next) => {
  try {
    const pond = await Pond.findByIdAndDelete(req.params.id);
    
    if (!pond) {
      return res.status(404).json({ message: '养殖池不存在' });
    }
    
    res.json({
      success: true,
      message: '养殖池已删除'
    });
  } catch (error) {
    next(error);
  }
};

const getPondSummary = async (req, res, next) => {
  try {
    const totalPonds = await Pond.countDocuments();
    const normalPonds = await Pond.countDocuments({ status: 'normal' });
    const warningPonds = await Pond.countDocuments({ status: 'warning' });
    const criticalPonds = await Pond.countDocuments({ status: 'critical' });
    
    const allPonds = await Pond.find({}, 'currentWaterQuality totalBiomass currentStockCount');
    
    let totalBiomass = 0;
    let totalStock = 0;
    allPonds.forEach(pond => {
      totalBiomass += pond.totalBiomass || 0;
      totalStock += pond.currentStockCount || 0;
    });
    
    res.json({
      success: true,
      data: {
        totalPonds,
        normalPonds,
        warningPonds,
        criticalPonds,
        totalBiomass,
        totalStock
      }
    });
  } catch (error) {
    next(error);
  }
};

const updatePondThresholds = async (pondId) => {
  const pond = await Pond.findById(pondId).populate('fishSpecies');
  if (!pond || !pond.fishSpecies || !pond.stockDate) return;
  
  const daysSinceStock = Math.floor((Date.now() - new Date(pond.stockDate)) / (1000 * 60 * 60 * 24));
  const growthStage = getGrowthStage(pond.fishSpecies, daysSinceStock);
  const thresholds = calculateOptimalThresholds(pond.fishSpecies, growthStage);
  
  pond.thresholds = thresholds;
  pond.growthStage = growthStage?.name;
  await pond.save();
  
  return { pond, growthStage, thresholds };
};

const getPondDailyTimeline = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { date } = req.query;
    
    const pond = await Pond.findById(id).populate('fishSpecies');
    if (!pond) {
      return res.status(404).json({ message: '养殖池不存在' });
    }
    
    const targetDate = date ? new Date(date) : new Date();
    targetDate.setHours(0, 0, 0, 0);
    const nextDate = new Date(targetDate);
    nextDate.setDate(nextDate.getDate() + 1);
    
    const timeRange = { $gte: targetDate, $lt: nextDate };
    
    const [sensorData, feedingRecords, alerts, workOrders] = await Promise.all([
      SensorData.find({
        pond: id,
        timestamp: timeRange
      }).sort({ timestamp: 1 }).select('sensorType value unit status timestamp'),
      
      FeedingRecord.find({
        pond: id,
        scheduledTime: timeRange
      }).sort({ scheduledTime: 1 }).select('plannedAmount actualAmount status feedingType scheduledTime actualTime consumedRatio'),
      
      Alert.find({
        pond: id,
        timestamp: timeRange
      }).sort({ timestamp: 1 }).select('alertNo sensorType level type value threshold message timestamp'),
      
      WorkOrder.find({
        pond: id,
        createdAt: timeRange
      }).sort({ createdAt: 1 }).select('orderNo type level status description createdAt')
    ]);
    
    const series = {
      temperature: [],
      oxygen: [],
      ph: [],
      activity: []
    };
    
    sensorData.forEach(d => {
      const point = {
        time: d.timestamp,
        value: d.value,
        status: d.status
      };
      if (series[d.sensorType]) {
        series[d.sensorType].push(point);
      }
    });
    
    const feedingEvents = feedingRecords.map(r => ({
      time: r.actualTime || r.scheduledTime,
      type: 'feeding',
      feedingType: r.feedingType,
      status: r.status,
      plannedAmount: r.plannedAmount,
      actualAmount: r.actualAmount,
      consumedRatio: r.consumedRatio
    }));
    
    const alertEvents = alerts.map(a => ({
      time: a.timestamp,
      type: 'alert',
      alertNo: a.alertNo,
      sensorType: a.sensorType,
      level: a.level,
      alertType: a.type,
      value: a.value,
      threshold: a.threshold,
      message: a.message
    }));
    
    const workOrderEvents = workOrders.map(w => ({
      time: w.createdAt,
      type: 'workOrder',
      orderNo: w.orderNo,
      orderType: w.type,
      level: w.level,
      status: w.status,
      description: w.description
    }));
    
    const allEvents = [...feedingEvents, ...alertEvents, ...workOrderEvents]
      .sort((a, b) => new Date(a.time) - new Date(b.time));
    
    const thresholds = pond.thresholds || {};
    const thresholdLines = {};
    if (thresholds.temperatureMin !== undefined || thresholds.temperatureMax !== undefined) {
      thresholdLines.temperature = {
        min: thresholds.temperatureMin,
        max: thresholds.temperatureMax,
        optimal: pond.fishSpecies?.optimalTemperature?.optimal || null
      };
    }
    if (thresholds.oxygenMin !== undefined) {
      thresholdLines.oxygen = {
        min: thresholds.oxygenMin,
        optimal: pond.fishSpecies?.optimalOxygen?.optimal || null
      };
    }
    if (thresholds.phMin !== undefined || thresholds.phMax !== undefined) {
      thresholdLines.ph = {
        min: thresholds.phMin,
        max: thresholds.phMax,
        optimal: pond.fishSpecies?.optimalPH?.optimal || null
      };
    }
    
    res.json({
      success: true,
      data: {
        pondId: id,
        pondNo: pond.pondNo,
        pondName: pond.name,
        date: targetDate,
        series,
        events: allEvents,
        thresholdLines,
        summary: {
          sensorDataPoints: sensorData.length,
          feedingCount: feedingRecords.length,
          alertCount: alerts.length,
          workOrderCount: workOrders.length
        }
      }
    });
  } catch (error) {
    next(error);
  }
};

const getPondHealthScores = async (req, res, next) => {
  try {
    const { sortBy = 'risk', order = 'desc' } = req.query;
    
    const ponds = await Pond.find({ status: { $ne: 'maintenance' } })
      .populate('fishSpecies')
      .populate('assignedWorker', 'realName');
    
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    
    const scores = [];
    
    for (const pond of ponds) {
      const [recentSensorData, recentAlerts, recentFeedings, recentDeviceFaults] = await Promise.all([
        SensorData.find({
          pond: pond._id,
          timestamp: { $gte: sevenDaysAgo }
        }).sort({ timestamp: 1 }),
        
        Alert.find({
          pond: pond._id,
          timestamp: { $gte: sevenDaysAgo }
        }),
        
        FeedingRecord.find({
          pond: pond._id,
          date: { $gte: sevenDaysAgo }
        }),
        
        Device.find({
          pond: pond._id,
          status: 'fault',
          lastFaultTime: { $gte: sevenDaysAgo }
        })
      ]);
      
      let stabilityScore = 100;
      if (recentSensorData.length > 1) {
        const byType = {};
        recentSensorData.forEach(d => {
          if (!byType[d.sensorType]) byType[d.sensorType] = [];
          byType[d.sensorType].push(d.value);
        });
        
        let totalCV = 0;
        let typeCount = 0;
        for (const [type, values] of Object.entries(byType)) {
          if (values.length < 2) continue;
          const mean = values.reduce((a, b) => a + b, 0) / values.length;
          if (mean === 0) continue;
          const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length;
          const cv = Math.sqrt(variance) / Math.abs(mean);
          totalCV += cv;
          typeCount++;
        }
        
        if (typeCount > 0) {
          const avgCV = totalCV / typeCount;
          stabilityScore = Math.max(0, Math.min(100, 100 - avgCV * 500));
        }
      } else {
        stabilityScore = 50;
      }
      
      let alertScore = 100;
      recentAlerts.forEach(alert => {
        switch (alert.level) {
          case 'low': alertScore -= 3; break;
          case 'medium': alertScore -= 8; break;
          case 'high': alertScore -= 15; break;
          case 'critical': alertScore -= 25; break;
        }
      });
      alertScore = Math.max(0, Math.min(100, alertScore));
      
      let feedingScore = 100;
      const totalFeedings = recentFeedings.length;
      const completedFeedings = recentFeedings.filter(f => f.status === 'completed').length;
      const failedFeedings = recentFeedings.filter(f => f.status === 'failed').length;
      
      if (totalFeedings > 0) {
        const completionRate = completedFeedings / totalFeedings;
        feedingScore = completionRate * 80;
        
        const feedingsWithConsumed = recentFeedings.filter(f => f.consumedRatio != null);
        if (feedingsWithConsumed.length > 0) {
          const avgConsumed = feedingsWithConsumed.reduce((sum, f) => sum + f.consumedRatio, 0) / feedingsWithConsumed.length;
          feedingScore += Math.min(20, avgConsumed / 5);
        }
        
        feedingScore -= failedFeedings * 10;
      } else {
        feedingScore = 60;
      }
      feedingScore = Math.max(0, Math.min(100, feedingScore));
      
      let deviceScore = 100;
      deviceScore -= recentDeviceFaults.length * 20;
      deviceScore = Math.max(0, Math.min(100, deviceScore));
      
      const overallScore = Math.round(
        stabilityScore * 0.3 + alertScore * 0.25 + feedingScore * 0.25 + deviceScore * 0.2
      );
      
      let riskLevel;
      if (overallScore >= 80) riskLevel = 'low';
      else if (overallScore >= 60) riskLevel = 'medium';
      else if (overallScore >= 40) riskLevel = 'high';
      else riskLevel = 'critical';
      
      scores.push({
        pondId: pond._id,
        pondNo: pond.pondNo,
        pondName: pond.name,
        status: pond.status,
        fishSpecies: pond.fishSpecies?.name,
        assignedWorker: pond.assignedWorker?.realName,
        currentWaterQuality: pond.currentWaterQuality,
        overallScore,
        riskLevel,
        dimensions: {
          waterQualityStability: Math.round(stabilityScore),
          alertScore: Math.round(alertScore),
          feedingCompletion: Math.round(feedingScore),
          deviceHealth: Math.round(deviceScore)
        },
        details: {
          recentAlertCount: recentAlerts.length,
          criticalAlertCount: recentAlerts.filter(a => a.level === 'critical').length,
          feedingCompletionRate: totalFeedings > 0 ? Math.round(completedFeedings / totalFeedings * 100) : null,
          feedingFailureCount: failedFeedings,
          deviceFaultCount: recentDeviceFaults.length
        }
      });
    }
    
    if (sortBy === 'risk') {
      scores.sort((a, b) => order === 'desc' ? a.overallScore - b.overallScore : b.overallScore - a.overallScore);
    } else if (sortBy === 'score') {
      scores.sort((a, b) => order === 'desc' ? b.overallScore - a.overallScore : a.overallScore - b.overallScore);
    }
    
    res.json({
      success: true,
      data: scores
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getPonds,
  getPondById,
  createPond,
  updatePond,
  deletePond,
  getPondSummary,
  updatePondThresholds,
  getPondDailyTimeline,
  getPondHealthScores
};
