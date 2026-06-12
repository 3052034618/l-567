const mongoose = require('mongoose');

const feedingScheduleSchema = new mongoose.Schema({
  pond: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Pond',
    required: true,
    index: true
  },
  
  fishSpecies: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'FishSpecies',
    required: true
  },
  
  growthStage: {
    type: String,
    required: true
  },
  
  meals: [{
    time: {
      type: String,
      required: true,
      match: /^([01]\d|2[0-3]):([0-5]\d)$/
    },
    ratio: {
      type: Number,
      required: true,
      min: 0.01,
      max: 1
    }
  }],
  
  totalDailyRate: {
    type: Number,
    required: true,
    min: 0
  },
  
  isActive: {
    type: Boolean,
    default: true
  },
  
  effectiveFrom: {
    type: Date,
    default: Date.now
  },
  
  suspensions: [{
    date: {
      type: Date,
      required: true
    },
    reason: String,
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    createdAt: {
      type: Date,
      default: Date.now
    }
  }],
  
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  
  updatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  
  notes: String,
  
  version: {
    type: Number,
    default: 1
  }
}, {
  timestamps: true
});

feedingScheduleSchema.index({ pond: 1, isActive: 1 });
feedingScheduleSchema.index({ effectiveFrom: 1 });

feedingScheduleSchema.methods.validateMealsRatio = function() {
  const totalRatio = this.meals.reduce((sum, meal) => sum + meal.ratio, 0);
  return Math.abs(totalRatio - 1) < 0.01;
};

feedingScheduleSchema.methods.isSuspendedOn = function(date) {
  const targetDate = new Date(date);
  targetDate.setHours(0, 0, 0, 0);
  
  return this.suspensions.some(s => {
    const suspendDate = new Date(s.date);
    suspendDate.setHours(0, 0, 0, 0);
    return suspendDate.getTime() === targetDate.getTime();
  });
};

feedingScheduleSchema.methods.addSuspension = function(date, reason, userId) {
  const targetDate = new Date(date);
  targetDate.setHours(0, 0, 0, 0);
  
  const exists = this.suspensions.some(s => {
    const sd = new Date(s.date);
    sd.setHours(0, 0, 0, 0);
    return sd.getTime() === targetDate.getTime();
  });
  
  if (!exists) {
    this.suspensions.push({
      date: targetDate,
      reason: reason || '临时停喂',
      createdBy: userId
    });
  }
  
  return this;
};

feedingScheduleSchema.methods.removeSuspension = function(date) {
  const targetDate = new Date(date);
  targetDate.setHours(0, 0, 0, 0);
  
  this.suspensions = this.suspensions.filter(s => {
    const sd = new Date(s.date);
    sd.setHours(0, 0, 0, 0);
    return sd.getTime() !== targetDate.getTime();
  });
  
  return this;
};

feedingScheduleSchema.pre('save', function(next) {
  if (this.isModified('meals') && !this.validateMealsRatio()) {
    const total = this.meals.reduce((sum, m) => sum + m.ratio, 0);
    console.warn(`[投喂计划] 池${this.pond}的餐次占比总和为${total.toFixed(2)}，不等于1.0`);
  }
  next();
});

module.exports = mongoose.model('FeedingSchedule', feedingScheduleSchema);
