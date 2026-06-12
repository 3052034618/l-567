const DailyLog = require('../models/DailyLog');
const Pond = require('../models/Pond');
const SensorData = require('../models/SensorData');
const FeedingRecord = require('../models/FeedingRecord');
const EnergyRecord = require('../models/EnergyRecord');
const Alert = require('../models/Alert');
const WorkOrder = require('../models/WorkOrder');
const config = require('../config');
const ExcelJS = require('exceljs');
const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');

const generateDailyLog = async (pondId, date) => {
  try {
    const pond = await Pond.findById(pondId);
    if (!pond) {
      return { error: '养殖池不存在' };
    }
    
    const logDate = date ? new Date(date) : new Date();
    logDate.setHours(0, 0, 0, 0);
    
    const nextDate = new Date(logDate);
    nextDate.setDate(nextDate.getDate() + 1);
    
    const existingLog = await DailyLog.findOne({ pond: pondId, date: logDate });
    if (existingLog) {
      await existingLog.remove();
    }
    
    const sensorStats = await calculateWaterQualityStats(pondId, logDate, nextDate);
    const feedingStats = await calculateFeedingStats(pondId, logDate, nextDate);
    const energyStats = await calculateEnergyStats(pondId, logDate, nextDate);
    const alertStats = await calculateAlertStats(pondId, logDate, nextDate);
    const workOrderStats = await calculateWorkOrderStats(pondId, logDate, nextDate);
    
    const dailyLog = new DailyLog({
      date: logDate,
      pond: pondId,
      pondNo: pond.pondNo,
      waterQuality: sensorStats,
      feeding: feedingStats,
      energy: energyStats,
      alerts: alertStats,
      workOrders: workOrderStats,
      growth: {
        avgWeight: pond.averageWeight,
        totalBiomass: pond.totalBiomass,
        stockCount: pond.currentStockCount,
        weightGain: 0,
        survivalRate: 0
      },
      generatedBy: 'auto'
    });
    
    await dailyLog.save();
    
    return dailyLog;
  } catch (error) {
    console.error('生成每日日志失败:', error);
    return { error: error.message };
  }
};

const calculateWaterQualityStats = async (pondId, startDate, endDate) => {
  try {
    const sensorTypes = ['temperature', 'oxygen', 'ph', 'activity'];
    const stats = {};
    
    for (const type of sensorTypes) {
      const data = await SensorData.find({
        pond: pondId,
        sensorType: type,
        timestamp: { $gte: startDate, $lt: endDate }
      });
      
      if (data.length === 0) {
        stats[`avg${type.charAt(0).toUpperCase() + type.slice(1)}`] = null;
        stats[`min${type.charAt(0).toUpperCase() + type.slice(1)}`] = null;
        stats[`max${type.charAt(0).toUpperCase() + type.slice(1)}`] = null;
        continue;
      }
      
      const values = data.map(d => d.value);
      const avg = values.reduce((a, b) => a + b, 0) / values.length;
      const min = Math.min(...values);
      const max = Math.max(...values);
      
      stats[`avg${type.charAt(0).toUpperCase() + type.slice(1)}`] = Math.round(avg * 100) / 100;
      stats[`min${type.charAt(0).toUpperCase() + type.slice(1)}`] = min;
      stats[`max${type.charAt(0).toUpperCase() + type.slice(1)}`] = max;
    }
    
    return stats;
  } catch (error) {
    console.error('计算水质统计失败:', error);
    return {};
  }
};

const calculateFeedingStats = async (pondId, startDate, endDate) => {
  try {
    const records = await FeedingRecord.find({
      pond: pondId,
      date: { $gte: startDate, $lt: endDate },
      status: 'completed'
    });
    
    const totalFeed = records.reduce((sum, r) => sum + (r.actualAmount || 0), 0);
    const count = records.length;
    const avgFeed = count > 0 ? totalFeed / count : 0;
    
    const avgConsumed = records.length > 0 
      ? records.reduce((sum, r) => sum + (r.consumedRatio || 0), 0) / records.length 
      : 0;
    
    return {
      totalFeedAmount: Math.round(totalFeed * 100) / 100,
      feedingCount: count,
      avgFeedAmount: Math.round(avgFeed * 100) / 100,
      feedEfficiency: Math.round(avgConsumed * 100) / 100
    };
  } catch (error) {
    console.error('计算投喂统计失败:', error);
    return {
      totalFeedAmount: 0,
      feedingCount: 0,
      avgFeedAmount: 0,
      feedEfficiency: 0
    };
  }
};

const calculateEnergyStats = async (pondId, startDate, endDate) => {
  try {
    const records = await EnergyRecord.find({
      pond: pondId,
      date: { $gte: startDate, $lt: endDate }
    });
    
    const totalPower = records.reduce((sum, r) => sum + (r.powerConsumption || 0), 0);
    const oxygenRecords = records.filter(r => r.deviceType === config.deviceTypes.OXYGEN_PUMP);
    const waterRecords = records.filter(r => r.deviceType === config.deviceTypes.WATER_PUMP);
    
    const oxygenRuntime = oxygenRecords.reduce((sum, r) => sum + (r.duration || 0), 0);
    const waterRuntime = waterRecords.reduce((sum, r) => sum + (r.duration || 0), 0);
    const oxygenPower = oxygenRecords.reduce((sum, r) => sum + (r.powerConsumption || 0), 0);
    const waterPower = waterRecords.reduce((sum, r) => sum + (r.powerConsumption || 0), 0);
    
    return {
      oxygenPumpRuntime: Math.round(oxygenRuntime * 100) / 100,
      waterPumpRuntime: Math.round(waterRuntime * 100) / 100,
      totalPowerConsumption: Math.round(totalPower * 100) / 100,
      oxygenPumpPower: Math.round(oxygenPower * 100) / 100,
      waterPumpPower: Math.round(waterPower * 100) / 100
    };
  } catch (error) {
    console.error('计算能耗统计失败:', error);
    return {
      oxygenPumpRuntime: 0,
      waterPumpRuntime: 0,
      totalPowerConsumption: 0,
      oxygenPumpPower: 0,
      waterPumpPower: 0
    };
  }
};

const calculateAlertStats = async (pondId, startDate, endDate) => {
  try {
    const alerts = await Alert.find({
      pond: pondId,
      timestamp: { $gte: startDate, $lt: endDate }
    });
    
    const stats = {
      totalCount: alerts.length,
      lowCount: 0,
      mediumCount: 0,
      highCount: 0,
      criticalCount: 0
    };
    
    alerts.forEach(alert => {
      switch (alert.level) {
        case config.alertLevels.LOW:
          stats.lowCount++;
          break;
        case config.alertLevels.MEDIUM:
          stats.mediumCount++;
          break;
        case config.alertLevels.HIGH:
          stats.highCount++;
          break;
        case config.alertLevels.CRITICAL:
          stats.criticalCount++;
          break;
      }
    });
    
    return stats;
  } catch (error) {
    console.error('计算告警统计失败:', error);
    return {
      totalCount: 0,
      lowCount: 0,
      mediumCount: 0,
      highCount: 0,
      criticalCount: 0
    };
  }
};

const calculateWorkOrderStats = async (pondId, startDate, endDate) => {
  try {
    const orders = await WorkOrder.find({
      pond: pondId,
      createdAt: { $gte: startDate, $lt: endDate }
    });
    
    const completedCount = orders.filter(o => o.status === config.workOrderStatus.COMPLETED).length;
    const pendingCount = orders.filter(o => 
      [config.workOrderStatus.PENDING, config.workOrderStatus.ASSIGNED, config.workOrderStatus.IN_PROGRESS].includes(o.status)
    ).length;
    
    return {
      totalCount: orders.length,
      completedCount,
      pendingCount
    };
  } catch (error) {
    console.error('计算工单统计失败:', error);
    return {
      totalCount: 0,
      completedCount: 0,
      pendingCount: 0
    };
  }
};

const generateAllPondsDailyLog = async (date) => {
  try {
    const ponds = await Pond.find({ status: { $ne: 'maintenance' } });
    
    const results = [];
    for (const pond of ponds) {
      const result = await generateDailyLog(pond._id, date);
      if (!result.error) {
        results.push(result);
      }
    }
    
    return {
      success: true,
      count: results.length,
      totalPonds: ponds.length
    };
  } catch (error) {
    console.error('生成所有养殖池日志失败:', error);
    return { success: false, error: error.message };
  }
};

const getDailyLogs = async (req, res, next) => {
  try {
    const { 
      pondId, page = 1, limit = 20,
      startDate, endDate
    } = req.query;
    
    const query = {};
    
    if (pondId) query.pond = pondId;
    if (startDate || endDate) {
      query.date = {};
      if (startDate) query.date.$gte = new Date(startDate);
      if (endDate) query.date.$lte = new Date(endDate);
    }
    
    const logs = await DailyLog.find(query)
      .skip((page - 1) * limit)
      .limit(Number(limit))
      .sort({ date: -1 })
      .populate('pond', 'pondNo name');
    
    const total = await DailyLog.countDocuments(query);
    
    res.json({
      success: true,
      data: logs,
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

const getDailyLogById = async (req, res, next) => {
  try {
    const log = await DailyLog.findById(req.params.id)
      .populate('pond', 'pondNo name fishSpecies');
    
    if (!log) {
      return res.status(404).json({ message: '日志不存在' });
    }
    
    res.json({
      success: true,
      data: log
    });
  } catch (error) {
    next(error);
  }
};

const createDailyLog = async (req, res, next) => {
  try {
    const { pondId, date } = req.body;
    
    const result = await generateDailyLog(pondId, date);
    
    if (result.error) {
      return res.status(400).json({ message: result.error });
    }
    
    res.status(201).json({
      success: true,
      data: result
    });
  } catch (error) {
    next(error);
  }
};

const updateDailyLog = async (req, res, next) => {
  try {
    const { notes, operations, weather } = req.body;
    
    const log = await DailyLog.findById(req.params.id);
    
    if (!log) {
      return res.status(404).json({ message: '日志不存在' });
    }
    
    if (notes !== undefined) log.notes = notes;
    if (operations !== undefined) log.operations = operations;
    if (weather !== undefined) log.weather = weather;
    log.generatedBy = 'manual';
    
    await log.save();
    
    res.json({
      success: true,
      data: log
    });
  } catch (error) {
    next(error);
  }
};

const exportDailyLogs = async (req, res, next) => {
  try {
    const { pondId, startDate, endDate, format = 'excel' } = req.query;
    
    const query = {};
    if (pondId) query.pond = pondId;
    if (startDate || endDate) {
      query.date = {};
      if (startDate) query.date.$gte = new Date(startDate);
      if (endDate) query.date.$lte = new Date(endDate);
    }
    
    const logs = await DailyLog.find(query)
      .sort({ date: 1 })
      .populate('pond', 'pondNo name');
    
    if (logs.length === 0) {
      return res.status(400).json({ message: '没有可导出的数据' });
    }
    
    if (format === 'json') {
      return res.json({
        success: true,
        data: logs
      });
    }
    
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('养殖日志');
    
    worksheet.columns = [
      { header: '日期', key: 'date', width: 15 },
      { header: '池号', key: 'pondNo', width: 10 },
      { header: '养殖池名称', key: 'pondName', width: 15 },
      { header: '平均水温(°C)', key: 'avgTemp', width: 14 },
      { header: '最高水温(°C)', key: 'maxTemp', width: 14 },
      { header: '最低水温(°C)', key: 'minTemp', width: 14 },
      { header: '平均溶氧(mg/L)', key: 'avgOxygen', width: 14 },
      { header: '最低溶氧(mg/L)', key: 'minOxygen', width: 14 },
      { header: '平均pH', key: 'avgPH', width: 10 },
      { header: '投喂总量(kg)', key: 'totalFeed', width: 14 },
      { header: '投喂次数', key: 'feedCount', width: 10 },
      { header: '增氧机运行(分钟)', key: 'oxygenRuntime', width: 16 },
      { header: '换水泵运行(分钟)', key: 'waterRuntime', width: 16 },
      { header: '总耗电量(kWh)', key: 'totalPower', width: 14 },
      { header: '告警总数', key: 'alertCount', width: 10 },
      { header: '严重告警', key: 'criticalAlerts', width: 10 },
      { header: '工单总数', key: 'orderCount', width: 10 },
      { header: '库存数量', key: 'stockCount', width: 10 },
      { header: '总生物量(kg)', key: 'biomass', width: 12 },
      { header: '备注', key: 'notes', width: 30 }
    ];
    
    logs.forEach(log => {
      worksheet.addRow({
        date: log.date ? new Date(log.date).toLocaleDateString('zh-CN') : '',
        pondNo: log.pondNo,
        pondName: log.pond?.name || '',
        avgTemp: log.waterQuality?.avgTemperature?.toFixed?.(2) || '',
        maxTemp: log.waterQuality?.maxTemperature || '',
        minTemp: log.waterQuality?.minTemperature || '',
        avgOxygen: log.waterQuality?.avgOxygen?.toFixed?.(2) || '',
        minOxygen: log.waterQuality?.minOxygen || '',
        avgPH: log.waterQuality?.avgPH?.toFixed?.(2) || '',
        totalFeed: log.feeding?.totalFeedAmount || 0,
        feedCount: log.feeding?.feedingCount || 0,
        oxygenRuntime: Math.round(log.energy?.oxygenPumpRuntime || 0),
        waterRuntime: Math.round(log.energy?.waterPumpRuntime || 0),
        totalPower: (log.energy?.totalPowerConsumption || 0).toFixed(2),
        alertCount: log.alerts?.totalCount || 0,
        criticalAlerts: log.alerts?.criticalCount || 0,
        orderCount: log.workOrders?.totalCount || 0,
        stockCount: log.growth?.stockCount || 0,
        biomass: (log.growth?.totalBiomass || 0).toFixed(2),
        notes: log.notes || ''
      });
    });
    
    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE0E0E0' }
    };
    
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=daily_logs_${Date.now()}.xlsx`);
    
    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    next(error);
  }
};

const getDailyLogSummary = async (req, res, next) => {
  try {
    const { pondId, startDate, endDate } = req.query;
    
    const query = {};
    if (pondId) query.pond = pondId;
    if (startDate || endDate) {
      query.date = {};
      if (startDate) query.date.$gte = new Date(startDate);
      if (endDate) query.date.$lte = new Date(endDate);
    }
    
    const logs = await DailyLog.find(query).sort({ date: 1 });
    
    if (logs.length === 0) {
      return res.json({
        success: true,
        data: {
          avgTemperature: 0,
          avgOxygen: 0,
          totalFeed: 0,
          totalPower: 0,
          totalAlerts: 0,
          totalOrders: 0,
          days: 0
        }
      });
    }
    
    let totalTemp = 0, tempCount = 0;
    let totalOxygen = 0, oxygenCount = 0;
    let totalFeed = 0;
    let totalPower = 0;
    let totalAlerts = 0;
    let totalOrders = 0;
    
    logs.forEach(log => {
      if (log.waterQuality?.avgTemperature !== null && log.waterQuality?.avgTemperature !== undefined) {
        totalTemp += log.waterQuality.avgTemperature;
        tempCount++;
      }
      if (log.waterQuality?.avgOxygen !== null && log.waterQuality?.avgOxygen !== undefined) {
        totalOxygen += log.waterQuality.avgOxygen;
        oxygenCount++;
      }
      totalFeed += log.feeding?.totalFeedAmount || 0;
      totalPower += log.energy?.totalPowerConsumption || 0;
      totalAlerts += log.alerts?.totalCount || 0;
      totalOrders += log.workOrders?.totalCount || 0;
    });
    
    res.json({
      success: true,
      data: {
        avgTemperature: tempCount > 0 ? Math.round(totalTemp / tempCount * 100) / 100 : 0,
        avgOxygen: oxygenCount > 0 ? Math.round(totalOxygen / oxygenCount * 100) / 100 : 0,
        totalFeed: Math.round(totalFeed * 100) / 100,
        totalPower: Math.round(totalPower * 100) / 100,
        totalAlerts,
        totalOrders,
        days: logs.length
      }
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  generateDailyLog,
  generateAllPondsDailyLog,
  getDailyLogs,
  getDailyLogById,
  createDailyLog,
  updateDailyLog,
  exportDailyLogs,
  getDailyLogSummary
};
