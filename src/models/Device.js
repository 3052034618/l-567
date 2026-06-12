const mongoose = require('mongoose');
const config = require('../config');

const deviceSchema = new mongoose.Schema({
  deviceId: {
    type: String,
    required: [true, '设备编号不能为空'],
    unique: true,
    trim: true
  },
  
  name: {
    type: String,
    required: [true, '设备名称不能为空'],
    trim: true
  },
  
  type: {
    type: String,
    required: true,
    enum: [
      config.deviceTypes.OXYGEN_PUMP,
      config.deviceTypes.WATER_PUMP,
      config.deviceTypes.FEEDER,
      config.deviceTypes.TEMPERATURE_SENSOR,
      config.deviceTypes.OXYGEN_SENSOR,
      config.deviceTypes.PH_SENSOR,
      config.deviceTypes.ACTIVITY_SENSOR
    ]
  },
  
  pond: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Pond'
  },
  
  status: {
    type: String,
    required: true,
    enum: [
      config.deviceStatus.RUNNING,
      config.deviceStatus.STOPPED,
      config.deviceStatus.FAULT,
      config.deviceStatus.MAINTENANCE
    ],
    default: config.deviceStatus.STOPPED
  },
  
  powerRating: {
    type: Number,
    default: 0
  },
  
  lastMaintenance: Date,
  nextMaintenance: Date,
  
  installDate: Date,
  
  manufacturer: String,
  model: String,
  
  autoControl: {
    type: Boolean,
    default: true
  },
  
  currentSpeed: Number,
  runtimeToday: {
    type: Number,
    default: 0
  },
  
  faultCode: String,
  faultMessage: String,
  lastFaultTime: Date,
  
  position: {
    type: {
      type: String,
      enum: ['Point'],
      default: 'Point'
    },
    coordinates: {
      type: [Number],
      default: [0, 0]
    }
  },
  
  notes: String
}, {
  timestamps: true
});

deviceSchema.index({ pond: 1, type: 1 });
deviceSchema.index({ status: 1 });

module.exports = mongoose.model('Device', deviceSchema);
