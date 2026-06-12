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
    
    const status = evaluateSensorStatus(sensorType, value, pond.thresholds);
    
    const sensorData = new SensorData({
      pond: pondId,
      sensorId,
      sensorType,
      value,
      unit: unit || getDefaultUnit(sensorType),
      status,
      timestamp: timestamp || Date.now()
    });
    
    await sensorData.save();
    
    await updatePondCurrentWaterQuality(pondId, sensorType, value);
    
    if (status === 'warning' || status === 'critical') {
      await checkAndGenerateAlert(pondId, sensorType, value, status);
    }
    
    autoControlDevices(pondId, { [sensorType]: value });
    
    res.status(201).json({
      success: true,
      data: sensorData,
      message: status !== 'normal' ? `水质${status === 'warning' ? '警告' : '严重'}，已生成预警` : '数据上传成功'
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
      
      const status = evaluateSensorStatus(sensorType, value, pond.thresholds);
      
      const sensorData = new SensorData({
        pond: pondId,
        sensorId,
        sensorType,
        value,
        unit: unit || getDefaultUnit(sensorType),
        status,
        timestamp: timestamp || Date.now()
      });
      
      sensorDataList.push(sensorData);
      
      if (status === 'warning' || status === 'critical') {
        alerts.push({ sensorType, value, status });
      }
    }
    
    await SensorData.insertMany(sensorDataList);
    
    const latestData = {};
    for (const item of data) {
      latestData[item.sensorType] = item.value;
    }
    await updatePondCurrentWaterQualityBatch(pondId, latestData);
    
    for (const alert of alerts) {
      await checkAndGenerateAlert(pondId, alert.sensorType, alert.value, alert.status);
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
  if (!thresholds) return 'normal';
  
  switch (sensorType) {
    case 'temperature':
      if (value < thresholds.temperatureMin * 0.9 || value > thresholds.temperatureMax * 1.1) {
        return 'critical';
      }
      if (value < thresholds.temperatureMin || value > thresholds.temperatureMax) {
        return 'warning';
      }
      break;
      
    case 'oxygen':
      if (value < thresholds.oxygenMin * 0.7) {
        return 'critical';
      }
      if (value < thresholds.oxygenMin) {
        return 'warning';
      }
      break;
      
    case 'ph':
      if (value < thresholds.phMin * 0.95 || value > thresholds.phMax * 1.05) {
        return 'critical';
      }
      if (value < thresholds.phMin || value > thresholds.phMax) {
        return 'warning';
      }
      break;
      
    default:
      return 'normal';
  }
  
  return 'normal';
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
