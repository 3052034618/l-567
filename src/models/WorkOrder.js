const mongoose = require('mongoose');
const config = require('../config');

const workOrderSchema = new mongoose.Schema({
  orderNo: {
    type: String,
    required: true,
    unique: true
  },
  
  type: {
    type: String,
    required: true,
    enum: [
      config.workOrderType.WATER_QUALITY_ALERT,
      config.workOrderType.FEEDER_FAULT,
      config.workOrderType.EQUIPMENT_MAINTENANCE
    ]
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
  
  pond: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Pond',
    required: true
  },
  
  device: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Device'
  },
  
  alertType: String,
  
  description: {
    type: String,
    required: true
  },
  
  sensorData: [{
    sensorType: String,
    value: Number,
    threshold: Number,
    unit: String
  }],
  
  status: {
    type: String,
    required: true,
    enum: [
      config.workOrderStatus.PENDING,
      config.workOrderStatus.ASSIGNED,
      config.workOrderStatus.IN_PROGRESS,
      config.workOrderStatus.COMPLETED,
      config.workOrderStatus.CANCELLED
    ],
    default: config.workOrderStatus.PENDING
  },
  
  assignedTo: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  
  assignedAt: Date,
  
  startedAt: Date,
  
  completedAt: Date,
  
  handledBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  
  handlingNotes: String,
  
  photos: [{
    url: String,
    uploadedAt: Date,
    uploadedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }
  }],
  
  isStubbornDefect: {
    type: Boolean,
    default: false
  },
  
  relatedOrders: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'WorkOrder'
  }],
  
  notifiedSupervisor: {
    type: Boolean,
    default: false
  },
  
  priority: {
    type: Number,
    default: 0
  },
  
  closedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, {
  timestamps: true
});

workOrderSchema.index({ pond: 1, status: 1 });
workOrderSchema.index({ status: 1, level: 1 });
workOrderSchema.index({ assignedTo: 1, status: 1 });
workOrderSchema.index({ isStubbornDefect: 1 });

module.exports = mongoose.model('WorkOrder', workOrderSchema);
