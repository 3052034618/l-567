const mongoose = require('mongoose');

const feedingRecordSchema = new mongoose.Schema({
  pond: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Pond',
    required: true,
    index: true
  },
  
  feeder: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Device'
  },
  
  scheduledTime: {
    type: Date,
    required: true
  },
  
  actualTime: Date,
  
  plannedAmount: {
    type: Number,
    required: true
  },
  
  actualAmount: Number,
  
  feedingType: {
    type: String,
    enum: ['automatic', 'manual', 'scheduled'],
    default: 'automatic'
  },
  
  status: {
    type: String,
    enum: ['scheduled', 'in_progress', 'completed', 'failed', 'cancelled'],
    default: 'scheduled'
  },
  
  calculationFactors: {
    temperature: Number,
    activity: Number,
    historicalRate: Number,
    biomass: Number,
    feedRate: Number,
    growthStage: String
  },
  
  triggeredBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  
  failureReason: String,
  
  consumedRatio: Number,
  
  notes: String,
  
  date: {
    type: Date,
    required: true,
    index: true
  }
}, {
  timestamps: true
});

feedingRecordSchema.index({ pond: 1, date: -1 });
feedingRecordSchema.index({ status: 1, scheduledTime: 1 });

module.exports = mongoose.model('FeedingRecord', feedingRecordSchema);
