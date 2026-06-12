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
  },
  
  previousVersion: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'FeedingSchedule'
  },
  
  supersededAt: Date,
  
  status: {
    type: String,
    enum: ['draft', 'active', 'superseded', 'archived'],
    default: 'active'
  }
}, {
  timestamps: true
});

feedingScheduleSchema.index({ pond: 1, status: 1 });
feedingScheduleSchema.index({ effectiveFrom: 1 });
feedingScheduleSchema.index({ pond: 1, effectiveFrom: -1 });

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

feedingScheduleSchema.statics.findEffectiveForDate = async function(pondId, date) {
  const targetDate = new Date(date);
  targetDate.setHours(23, 59, 59, 999);
  
  const schedules = await this.find({
    pond: pondId,
    effectiveFrom: { $lte: targetDate },
    status: { $ne: 'archived' }
  }).sort({ effectiveFrom: -1, version: -1 });
  
  if (schedules.length === 0) return null;
  
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const targetDay = new Date(date);
  targetDay.setHours(0, 0, 0, 0);
  
  if (targetDay.getTime() === today.getTime()) {
    const activeSuperseded = schedules.find(s => s.status === 'superseded');
    const activeNow = schedules.find(s => s.status === 'active' && new Date(s.effectiveFrom).setHours(0,0,0,0) <= today.getTime());
    
    if (activeSuperseded && activeNow) {
      const nowEffective = new Date(activeNow.effectiveFrom);
      nowEffective.setHours(0, 0, 0, 0);
      if (nowEffective.getTime() > today.getTime()) {
        return activeSuperseded;
      }
    }
  }
  
  return schedules[0];
};

feedingScheduleSchema.statics.findAllVersions = async function(pondId) {
  return this.find({ pond: pondId })
    .sort({ version: 1 })
    .populate('previousVersion')
    .populate('createdBy', 'realName')
    .populate('updatedBy', 'realName')
    .populate('suspensions.createdBy', 'realName');
};

feedingScheduleSchema.methods.mergeSuspensionsFrom = function(sourceSchedule) {
  if (!sourceSchedule || !sourceSchedule.suspensions) return this;
  
  const existingDates = new Set(
    this.suspensions.map(s => {
      const d = new Date(s.date);
      d.setHours(0, 0, 0, 0);
      return d.getTime();
    })
  );
  
  sourceSchedule.suspensions.forEach(s => {
    const sd = new Date(s.date);
    sd.setHours(0, 0, 0, 0);
    if (!existingDates.has(sd.getTime())) {
      this.suspensions.push({
        date: sd,
        reason: s.reason,
        createdBy: s.createdBy,
        createdAt: s.createdAt
      });
    }
  });
  
  return this;
};

feedingScheduleSchema.methods.hasMealAt = function(timeStr) {
  return this.meals.some(m => m.time === timeStr);
};

feedingScheduleSchema.methods.getMealRatio = function(timeStr) {
  const meal = this.meals.find(m => m.time === timeStr);
  return meal ? meal.ratio : null;
};

module.exports = mongoose.model('FeedingSchedule', feedingScheduleSchema);
