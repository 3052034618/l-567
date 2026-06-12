const mongoose = require('mongoose');

const sensorDataSchema = new mongoose.Schema({
  pond: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Pond',
    required: true,
    index: true
  },
  
  sensorId: {
    type: String,
    required: true
  },
  
  sensorType: {
    type: String,
    required: true,
    enum: ['temperature', 'oxygen', 'ph', 'activity', 'water_level', 'turbidity']
  },
  
  value: {
    type: Number,
    required: true
  },
  
  unit: {
    type: String,
    required: true
  },
  
  status: {
    type: String,
    enum: ['normal', 'warning', 'critical', 'fault'],
    default: 'normal'
  },
  
  timestamp: {
    type: Date,
    required: true,
    default: Date.now,
    index: true
  },
  
  isProcessed: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true
});

sensorDataSchema.index({ pond: 1, timestamp: -1 });
sensorDataSchema.index({ sensorType: 1, timestamp: -1 });

module.exports = mongoose.model('SensorData', sensorDataSchema);
