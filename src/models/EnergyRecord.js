const mongoose = require('mongoose');

const energyRecordSchema = new mongoose.Schema({
  device: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Device',
    required: true
  },
  
  pond: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Pond',
    required: true,
    index: true
  },
  
  deviceType: {
    type: String,
    required: true
  },
  
  startTime: {
    type: Date,
    required: true
  },
  
  endTime: {
    type: Date
  },
  
  duration: {
    type: Number,
    default: 0
  },
  
  powerConsumption: {
    type: Number,
    default: 0
  },
  
  startTimeStatus: String,
  endTimeStatus: String,
  
  date: {
    type: Date,
    required: true,
    index: true
  }
}, {
  timestamps: true
});

energyRecordSchema.index({ pond: 1, date: -1 });
energyRecordSchema.index({ device: 1, date: -1 });

module.exports = mongoose.model('EnergyRecord', energyRecordSchema);
