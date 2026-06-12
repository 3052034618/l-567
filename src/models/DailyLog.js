const mongoose = require('mongoose');

const dailyLogSchema = new mongoose.Schema({
  date: {
    type: Date,
    required: true,
    index: true
  },
  
  pond: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Pond',
    required: true
  },
  
  pondNo: String,
  
  waterQuality: {
    avgTemperature: Number,
    minTemperature: Number,
    maxTemperature: Number,
    avgOxygen: Number,
    minOxygen: Number,
    maxOxygen: Number,
    avgPH: Number,
    minPH: Number,
    maxPH: Number,
    avgActivity: Number
  },
  
  feeding: {
    totalFeedAmount: Number,
    feedingCount: Number,
    avgFeedAmount: Number,
    feedEfficiency: Number
  },
  
  energy: {
    oxygenPumpRuntime: Number,
    waterPumpRuntime: Number,
    totalPowerConsumption: Number,
    oxygenPumpPower: Number,
    waterPumpPower: Number
  },
  
  growth: {
    avgWeight: Number,
    totalBiomass: Number,
    stockCount: Number,
    weightGain: Number,
    survivalRate: Number
  },
  
  alerts: {
    totalCount: Number,
    lowCount: Number,
    mediumCount: Number,
    highCount: Number,
    criticalCount: Number
  },
  
  workOrders: {
    totalCount: Number,
    completedCount: Number,
    pendingCount: Number
  },
  
  weather: {
    temperature: Number,
    humidity: Number,
    weather: String
  },
  
  operations: [{
    time: Date,
    type: String,
    description: String,
    operator: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }
  }],
  
  notes: String,
  
  generatedBy: {
    type: String,
    enum: ['auto', 'manual'],
    default: 'auto'
  }
}, {
  timestamps: true
});

dailyLogSchema.index({ pond: 1, date: -1 }, { unique: true });

module.exports = mongoose.model('DailyLog', dailyLogSchema);
