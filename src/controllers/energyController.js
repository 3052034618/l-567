const EnergyRecord = require('../models/EnergyRecord');
const Device = require('../models/Device');
const mongoose = require('mongoose');

const getEnergyRecords = async (req, res, next) => {
  try {
    const { 
      pondId, deviceId, deviceType, 
      page = 1, limit = 20,
      startTime, endTime
    } = req.query;
    
    const query = {};
    
    if (pondId) query.pond = pondId;
    if (deviceId) query.device = deviceId;
    if (deviceType) query.deviceType = deviceType;
    
    if (startTime || endTime) {
      query.date = {};
      if (startTime) query.date.$gte = new Date(startTime);
      if (endTime) query.date.$lte = new Date(endTime);
    }
    
    const records = await EnergyRecord.find(query)
      .skip((page - 1) * limit)
      .limit(Number(limit))
      .sort({ startTime: -1 })
      .populate('pond', 'pondNo name')
      .populate('device', 'name type');
    
    const total = await EnergyRecord.countDocuments(query);
    
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

const getEnergyStatistics = async (req, res, next) => {
  try {
    const { pondId, startTime, endTime, groupBy = 'day' } = req.query;
    
    const match = {};
    if (pondId) match.pond = mongoose.Types.ObjectId(pondId);
    if (startTime || endTime) {
      match.date = {};
      if (startTime) match.date.$gte = new Date(startTime);
      if (endTime) match.date.$lte = new Date(endTime);
    }
    
    const summary = await EnergyRecord.aggregate([
      { $match: match },
      {
        $group: {
          _id: null,
          totalPower: { $sum: '$powerConsumption' },
          totalDuration: { $sum: '$duration' },
          count: { $sum: 1 }
        }
      }
    ]);
    
    const byDeviceType = await EnergyRecord.aggregate([
      { $match: match },
      {
        $group: {
          _id: '$deviceType',
          totalPower: { $sum: '$powerConsumption' },
          totalDuration: { $sum: '$duration' }
        }
      }
    ]);
    
    let dailyStats = [];
    if (groupBy === 'day') {
      dailyStats = await EnergyRecord.aggregate([
        { $match: match },
        {
          $group: {
            _id: '$date',
            totalPower: { $sum: '$powerConsumption' },
            oxygenPumpPower: {
              $sum: {
                $cond: [{ $eq: ['$deviceType', 'oxygen_pump'] }, '$powerConsumption', 0]
              }
            },
            waterPumpPower: {
              $sum: {
                $cond: [{ $eq: ['$deviceType', 'water_pump'] }, '$powerConsumption', 0]
              }
            }
          }
        },
        { $sort: { _id: 1 } }
      ]);
    }
    
    const byPond = await EnergyRecord.aggregate([
      { $match: match },
      {
        $group: {
          _id: '$pond',
          totalPower: { $sum: '$powerConsumption' },
          totalDuration: { $sum: '$duration' }
        }
      }
    ]).lookup({
      from: 'ponds',
      localField: '_id',
      foreignField: '_id',
      as: 'pond'
    });
    
    res.json({
      success: true,
      data: {
        summary: summary[0] || { totalPower: 0, totalDuration: 0, count: 0 },
        byDeviceType,
        daily: dailyStats,
        byPond
      }
    });
  } catch (error) {
    next(error);
  }
};

const getPondEnergyStats = async (req, res, next) => {
  try {
    const { pondId } = req.params;
    const { startTime, endTime } = req.query;
    
    const match = { pond: mongoose.Types.ObjectId(pondId) };
    if (startTime || endTime) {
      match.date = {};
      if (startTime) match.date.$gte = new Date(startTime);
      if (endTime) match.date.$lte = new Date(endTime);
    }
    
    const stats = await EnergyRecord.aggregate([
      { $match: match },
      {
        $group: {
          _id: '$deviceType',
          totalPower: { $sum: '$powerConsumption' },
          totalDuration: { $sum: '$duration' },
          count: { $sum: 1 }
        }
      }
    ]);
    
    const dailyStats = await EnergyRecord.aggregate([
      { $match: match },
      {
        $group: {
          _id: { date: '$date', type: '$deviceType' },
          power: { $sum: '$powerConsumption' }
        }
      },
      {
        $group: {
          _id: '$_id.date',
          types: {
            $push: {
              type: '$_id.type',
              power: '$power'
            }
          },
          totalPower: { $sum: '$power' }
        }
      },
      { $sort: { _id: 1 } }
    ]);
    
    res.json({
      success: true,
      data: {
        byType: stats,
        daily: dailyStats
      }
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getEnergyRecords,
  getEnergyStatistics,
  getPondEnergyStats
};
