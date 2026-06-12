const mongoose = require('mongoose');

const pondSchema = new mongoose.Schema({
  pondNo: {
    type: String,
    required: [true, '池号不能为空'],
    unique: true,
    trim: true
  },
  name: {
    type: String,
    required: [true, '养殖池名称不能为空'],
    trim: true
  },
  area: {
    type: Number,
    required: [true, '养殖面积不能为空']
  },
  depth: {
    type: Number,
    required: [true, '水深不能为空']
  },
  volume: {
    type: Number,
    required: true
  },
  
  fishSpecies: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'FishSpecies',
    required: true
  },
  
  stockDate: {
    type: Date,
    required: true
  },
  
  initialStockCount: {
    type: Number,
    required: true
  },
  
  currentStockCount: {
    type: Number,
    required: true
  },
  
  averageWeight: {
    type: Number,
    default: 0
  },
  
  totalBiomass: {
    type: Number,
    default: 0
  },
  
  location: {
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
  
  currentWaterQuality: {
    temperature: Number,
    oxygen: Number,
    ph: Number,
    activity: Number,
    lastUpdate: Date
  },
  
  thresholds: {
    temperatureMin: Number,
    temperatureMax: Number,
    oxygenMin: Number,
    phMin: Number,
    phMax: Number
  },
  
  status: {
    type: String,
    enum: ['normal', 'warning', 'critical', 'maintenance'],
    default: 'normal'
  },
  
  assignedWorker: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  
  devices: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Device'
  }],
  
  notes: String,
  
  growthStage: String
}, {
  timestamps: true
});

pondSchema.index({ location: '2dsphere' });

pondSchema.pre('save', function(next) {
  this.totalBiomass = this.currentStockCount * this.averageWeight;
  next();
});

module.exports = mongoose.model('Pond', pondSchema);
