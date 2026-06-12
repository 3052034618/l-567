const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  username: {
    type: String,
    required: [true, '用户名不能为空'],
    unique: true,
    trim: true,
    maxlength: [50, '用户名不能超过50个字符']
  },
  password: {
    type: String,
    required: [true, '密码不能为空'],
    minlength: [6, '密码至少6个字符'],
    select: false
  },
  realName: {
    type: String,
    required: [true, '真实姓名不能为空'],
    trim: true
  },
  phone: {
    type: String,
    required: [true, '手机号不能为空'],
    unique: true
  },
  role: {
    type: String,
    required: true,
    enum: ['admin', 'supervisor', 'technician', 'worker'],
    default: 'worker'
  },
  avatar: String,
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
  status: {
    type: String,
    enum: ['active', 'inactive', 'on_leave'],
    default: 'active'
  },
  skillLevel: {
    type: Number,
    min: 1,
    max: 5,
    default: 3
  },
  lastLogin: Date,
  assignedPonds: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Pond'
  }]
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

userSchema.index({ location: '2dsphere' });

userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) {
    return next();
  }
  
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

userSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

module.exports = mongoose.model('User', userSchema);
