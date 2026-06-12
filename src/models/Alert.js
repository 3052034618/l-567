const mongoose = require('mongoose');
const config = require('../config');

const alertSchema = new mongoose.Schema({
  alertNo: {
    type: String,
    required: true,
    unique: true
  },
  
  pond: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Pond',
    required: true
  },
  
  sensorType: {
    type: String,
    required: true
  },
  
  level: {
    type: String,
    required: true,
    enum: [
      config.alertLevels.LOW,
      config.alertLevels.MEDIUM,
      config.alertLevels.HIGH,
      config.alertLevels.CRITICAL
    ]
  },
  
  type: {
    type: String,
    required: true,
    enum: ['over_threshold', 'below_threshold', 'sensor_fault', 'equipment_fault']
  },
  
  value: {
    type: Number,
    required: true
  },
  
  threshold: {
    type: Number,
    required: true
  },
  
  unit: String,
  
  message: {
    type: String,
    required: true
  },
  
  status: {
    type: String,
    enum: ['active', 'acknowledged', 'resolved', 'closed'],
    default: 'active'
  },
  
  acknowledgedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  
  acknowledgedAt: Date,
  
  resolvedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  
  resolvedAt: Date,
  
  workOrder: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'WorkOrder'
  },
  
  duration: Number,
  
  timestamp: {
    type: Date,
    required: true,
    default: Date.now,
    index: true
  }
}, {
  timestamps: true
});

alertSchema.index({ pond: 1, timestamp: -1 });
alertSchema.index({ status: 1, level: 1 });

module.exports = mongoose.model('Alert', alertSchema);
