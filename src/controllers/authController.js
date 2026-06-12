const jwt = require('jsonwebtoken');
const User = require('../models/User');
const config = require('../config');

const generateToken = (userId, role) => {
  return jwt.sign(
    { id: userId, role },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn }
  );
};

const login = async (req, res, next) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ message: '用户名和密码不能为空' });
    }
    
    const user = await User.findOne({ username }).select('+password');
    
    if (!user || user.status !== 'active') {
      return res.status(401).json({ message: '用户名或密码错误，或账户已禁用' });
    }
    
    const isMatch = await user.comparePassword(password);
    
    if (!isMatch) {
      return res.status(401).json({ message: '用户名或密码错误' });
    }
    
    user.lastLogin = Date.now();
    await user.save();
    
    const token = generateToken(user._id, user.role);
    
    const userData = user.toObject();
    delete userData.password;
    
    res.json({
      success: true,
      token,
      user: userData
    });
  } catch (error) {
    next(error);
  }
};

const register = async (req, res, next) => {
  try {
    const { username, password, realName, phone, role } = req.body;
    
    const existingUser = await User.findOne({ $or: [{ username }, { phone }] });
    
    if (existingUser) {
      return res.status(400).json({ message: '用户名或手机号已存在' });
    }
    
    const user = new User({
      username,
      password,
      realName,
      phone,
      role: role || 'worker'
    });
    
    await user.save();
    
    const token = generateToken(user._id, user.role);
    
    const userData = user.toObject();
    delete userData.password;
    
    res.status(201).json({
      success: true,
      token,
      user: userData
    });
  } catch (error) {
    next(error);
  }
};

const getCurrentUser = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id);
    
    if (!user) {
      return res.status(404).json({ message: '用户不存在' });
    }
    
    res.json({
      success: true,
      user
    });
  } catch (error) {
    next(error);
  }
};

const changePassword = async (req, res, next) => {
  try {
    const { oldPassword, newPassword } = req.body;
    
    const user = await User.findById(req.user.id).select('+password');
    
    if (!user) {
      return res.status(404).json({ message: '用户不存在' });
    }
    
    const isMatch = await user.comparePassword(oldPassword);
    
    if (!isMatch) {
      return res.status(400).json({ message: '原密码错误' });
    }
    
    user.password = newPassword;
    await user.save();
    
    res.json({
      success: true,
      message: '密码修改成功'
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  login,
  register,
  getCurrentUser,
  changePassword
};
