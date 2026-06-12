const mongoose = require('mongoose');
const SensorData = require('../models/SensorData');
const Pond = require('../models/Pond');
const { checkAndGenerateAlert } = require('./alertController');
const { autoControlDevices } = require('./deviceController');

const uploadSensorData = async (req, res, next) => {
  try {
    const { pondId, sensorId, sensorType, value, unit, timestamp } = req.body;
    
    if (!pondId || !sensorId || !sensorType || value === undefined) {
      return res.status(400).json({ message: '缺少必要参数' });
    }
    
    const pond = await Pond.findById(pondId);
    if (!pond) {
      return res.status(404).json({ message: '养殖池不存在' });
    }
    
    const statusResult = evaluateSensorStatus(sensorType, value, pond.thresholds);
    
    const sensorData = new SensorData({
      pond: pondId,
      sensorId,
      sensorType,
      value,
      unit: unit || getDefaultUnit(sensorType),
      status: statusResult.status,
      timestamp: timestamp || Date.now()
    });
    
    await sensorData.save();
    
    await updatePondCurrentWaterQuality(pondId, sensorType, value);
    
    if (statusResult.status === 'warning' || statusResult.status === 'critical') {
      await checkAndGenerateAlert(
        pondId, 
        sensorType, 
        value, 
        statusResult.status,
        statusResult.level,
        statusResult.direction,
        statusResult.threshold,
        statusResult.deviation
      );
    }
    
    autoControlDevices(pondId, { [sensorType]: value });
    
    const statusTextMap = {
      'normal': '',
      'warning': `${statusResult.level === 'low' ? '低' : '中'}级警告`,
      'critical': `${statusResult.level === 'high' ? '高' : '严重'}级预警`
    };
    
    res.status(201).json({
      success: true,
      data: sensorData,
      message: statusResult.status !== 'normal' 
        ? `水质异常：${statusTextMap[statusResult.status]}，${statusResult.direction === 'below_threshold' ? '低于' : '超过'}阈值${statusResult.threshold}，偏离${statusResult.deviation}%` 
        : '数据上传成功'
    });
  } catch (error) {
    next(error);
  }
};

const batchUploadSensorData = async (req, res, next) => {
  try {
    const { pondId, data, timestamp } = req.body;
    
    if (!pondId || !Array.isArray(data) || data.length === 0) {
      return res.status(400).json({ message: '缺少必要参数' });
    }
    
    const pond = await Pond.findById(pondId);
    if (!pond) {
      return res.status(404).json({ message: '养殖池不存在' });
    }
    
    const sensorDataList = [];
    const alerts = [];
    
    for (const item of data) {
      const { sensorId, sensorType, value, unit } = item;
      
      if (!sensorId || !sensorType || value === undefined) continue;
      
      const statusResult = evaluateSensorStatus(sensorType, value, pond.thresholds);
      
      const sensorData = new SensorData({
        pond: pondId,
        sensorId,
        sensorType,
        value,
        unit: unit || getDefaultUnit(sensorType),
        status: statusResult.status,
        timestamp: timestamp || Date.now()
      });
      
      sensorDataList.push(sensorData);
      
      if (statusResult.status === 'warning' || statusResult.status === 'critical') {
        alerts.push({ 
          sensorType, 
          value, 
          status: statusResult.status,
          level: statusResult.level,
          direction: statusResult.direction,
          threshold: statusResult.threshold,
          deviation: statusResult.deviation
        });
      }
    }
    
    await SensorData.insertMany(sensorDataList);
    
    const latestData = {};
    for (const item of data) {
      latestData[item.sensorType] = item.value;
    }
    await updatePondCurrentWaterQualityBatch(pondId, latestData);
    
    for (const alert of alerts) {
      await checkAndGenerateAlert(
        pondId, 
        alert.sensorType, 
        alert.value, 
        alert.status,
        alert.level,
        alert.direction,
        alert.threshold,
        alert.deviation
      );
    }
    
    autoControlDevices(pondId, latestData);
    
    res.status(201).json({
      success: true,
      data: {
        count: sensorDataList.length,
        alertCount: alerts.length
      }
    });
  } catch (error) {
    next(error);
  }
};

const getSensorData = async (req, res, next) => {
  try {
    const { pondId, sensorType, startTime, endTime, page = 1, limit = 50 } = req.query;
    
    const query = {};
    
    if (pondId) query.pond = pondId;
    if (sensorType) query.sensorType = sensorType;
    if (startTime || endTime) {
      query.timestamp = {};
      if (startTime) query.timestamp.$gte = new Date(startTime);
      if (endTime) query.timestamp.$lte = new Date(endTime);
    }
    
    const data = await SensorData.find(query)
      .skip((page - 1) * limit)
      .limit(Number(limit))
      .sort({ timestamp: -1 });
    
    const total = await SensorData.countDocuments(query);
    
    res.json({
      success: true,
      data,
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

const getLatestSensorData = async (req, res, next) => {
  try {
    const { pondId } = req.params;
    
    const sensorTypes = ['temperature', 'oxygen', 'ph', 'activity'];
    const latestData = {};
    
    for (const type of sensorTypes) {
      const data = await SensorData.findOne({
        pond: pondId,
        sensorType: type
      }).sort({ timestamp: -1 });
      
      if (data) {
        latestData[type] = data;
      }
    }
    
    res.json({
      success: true,
      data: latestData
    });
  } catch (error) {
    next(error);
  }
};

const getSensorStatistics = async (req, res, next) => {
  try {
    const { pondId, sensorType, startTime, endTime } = req.query;
    
    if (!pondId || !sensorType) {
      return res.status(400).json({ message: '缺少必要参数' });
    }
    
    const match = {
      pond: mongoose.Types.ObjectId(pondId),
      sensorType
    };
    
    if (startTime || endTime) {
      match.timestamp = {};
      if (startTime) match.timestamp.$gte = new Date(startTime);
      if (endTime) match.timestamp.$lte = new Date(endTime);
    }
    
    const stats = await SensorData.aggregate([
      { $match: match },
      {
        $group: {
          _id: null,
          avg: { $avg: '$value' },
          min: { $min: '$value' },
          max: { $max: '$value' },
          count: { $sum: 1 }
        }
      }
    ]);
    
    res.json({
      success: true,
      data: stats[0] || { avg: 0, min: 0, max: 0, count: 0 }
    });
  } catch (error) {
    next(error);
  }
};

const evaluateSensorStatus = (sensorType, value, thresholds) => {
  if (!thresholds) {
    return {
      status: 'normal',
      level: 'low',
      direction: null,
      threshold: null,
      deviation: 0
    };
  }
  
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
      return {
        status: 'normal',
        level: 'low',
        direction: null,
        threshold: null,
        deviation: 0
      };
  }
  
  let level = null;
  let direction = null;
  let threshold = null;
  let deviation = 0;
  
  if (min !== null && value < min) {
    direction = 'below_threshold';
    threshold = min;
    deviation = ((min - value) / min) * 100;
    
    if (sensorType === 'oxygen') {
      if (deviation < 10) level = 'medium';
      else if (deviation < 30) level = 'high';
      else level = 'critical';
    } else if (sensorType === 'temperature') {
      if (deviation < 5) level = 'low';
      else if (deviation < 10) level = 'medium';
      else if (deviation < 20) level = 'high';
      else level = 'critical';
    } else {
      if (deviation < 2) level = 'low';
      else if (deviation < 5) level = 'medium';
      else if (deviation < 10) level = 'high';
      else level = 'critical';
    }
  }
  else if (max !== null && value > max) {
    direction = 'over_threshold';
    threshold = max;
    deviation = ((value - max) / max) * 100;
    
    if (sensorType === 'temperature') {
      if (deviation < 5) level = 'low';
      else if (deviation < 10) level = 'medium';
      else if (deviation < 20) level = 'high';
      else level = 'critical';
    } else {
      if (deviation < 2) level = 'low';
      else if (deviation < 5) level = 'medium';
      else if (deviation < 10) level = 'high';
      else level = 'critical';
    }
  }
  
  if (!level) {
    return {
      status: 'normal',
      level: 'low',
      direction: null,
      threshold: null,
      deviation: 0
    };
  }
  
  const status = (level === 'high' || level === 'critical') ? 'critical' : 'warning';
  
  return { status, level, direction, threshold, deviation: Math.round(deviation * 100) / 100 };
};

const getDefaultUnit = (sensorType) => {
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

const updatePondCurrentWaterQuality = async (pondId, sensorType, value) => {
  const update = {
    'currentWaterQuality.lastUpdate': Date.now()
  };
  
  switch (sensorType) {
    case 'temperature':
      update['currentWaterQuality.temperature'] = value;
      break;
    case 'oxygen':
      update['currentWaterQuality.oxygen'] = value;
      break;
    case 'ph':
      update['currentWaterQuality.ph'] = value;
      break;
    case 'activity':
      update['currentWaterQuality.activity'] = value;
      break;
  }
  
  await Pond.findByIdAndUpdate(pondId, update);
};

const updatePondCurrentWaterQualityBatch = async (pondId, data) => {
  const update = {
    'currentWaterQuality.lastUpdate': Date.now()
  };
  
  if (data.temperature !== undefined) {
    update['currentWaterQuality.temperature'] = data.temperature;
  }
  if (data.oxygen !== undefined) {
    update['currentWaterQuality.oxygen'] = data.oxygen;
  }
  if (data.ph !== undefined) {
    update['currentWaterQuality.ph'] = data.ph;
  }
  if (data.activity !== undefined) {
    update['currentWaterQuality.activity'] = data.activity;
  }
  
  await Pond.findByIdAndUpdate(pondId, update);
};

module.exports = {
  uploadSensorData,
  batchUploadSensorData,
  getSensorData,
  getLatestSensorData,
  getSensorStatistics,
  evaluateSensorStatus,
  getDefaultUnit
};
