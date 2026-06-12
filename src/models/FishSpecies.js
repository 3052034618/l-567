const mongoose = require('mongoose');

const fishSpeciesSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, '鱼种名称不能为空'],
    unique: true,
    trim: true
  },
  scientificName: String,
  description: String,
  
  optimalTemperature: {
    min: { type: Number, required: true },
    max: { type: Number, required: true },
    optimal: { type: Number, required: true }
  },
  
  optimalOxygen: {
    min: { type: Number, required: true },
    optimal: { type: Number, required: true }
  },
  
  optimalPH: {
    min: { type: Number, required: true },
    max: { type: Number, required: true },
    optimal: { type: Number, required: true }
  },
  
  growthStages: [{
    name: { type: String, required: true },
    days: { type: Number, required: true },
    minWeight: Number,
    maxWeight: Number,
    feedRate: { type: Number, required: true },
    dailyFeedings: { type: Number, default: 3 },
    temperatureAdjustment: Number,
    oxygenAdjustment: Number
  }],
  
  feedConversionRatio: {
    type: Number,
    required: true,
    default: 1.5
  },
  
  maxStockDensity: {
    type: Number,
    required: true
  },
  
  image: String,
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('FishSpecies', fishSpeciesSchema);
