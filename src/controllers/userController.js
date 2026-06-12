const User = require('../models/User');

const getUsers = async (req, res, next) => {
  try {
    const { role, status, page = 1, limit = 10, keyword } = req.query;
    
    const query = {};
    
    if (role) query.role = role;
    if (status) query.status = status;
    if (keyword) {
      query.$or = [
        { username: { $regex: keyword, $options: 'i' } },
        { realName: { $regex: keyword, $options: 'i' } },
        { phone: { $regex: keyword } }
      ];
    }
    
    const users = await User.find(query)
      .skip((page - 1) * limit)
      .limit(Number(limit))
      .sort({ createdAt: -1 })
      .populate('assignedPonds', 'pondNo name');
    
    const total = await User.countDocuments(query);
    
    res.json({
      success: true,
      data: users,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    next(error);
  }
};

const getUserById = async (req, res, next) => {
  try {
    const user = await User.findById(req.params.id)
      .populate('assignedPonds', 'pondNo name');
    
    if (!user) {
      return res.status(404).json({ message: '用户不存在' });
    }
    
    res.json({
      success: true,
      data: user
    });
  } catch (error) {
    next(error);
  }
};

const createUser = async (req, res, next) => {
  try {
    const { username, password, realName, phone, role, status, skillLevel, location } = req.body;
    
    const existingUser = await User.findOne({ $or: [{ username }, { phone }] });
    
    if (existingUser) {
      return res.status(400).json({ message: '用户名或手机号已存在' });
    }
    
    const user = new User({
      username,
      password,
      realName,
      phone,
      role,
      status,
      skillLevel,
      location
    });
    
    await user.save();
    
    const userData = user.toObject();
    delete userData.password;
    
    res.status(201).json({
      success: true,
      data: userData
    });
  } catch (error) {
    next(error);
  }
};

const updateUser = async (req, res, next) => {
  try {
    const { realName, phone, role, status, skillLevel, location, assignedPonds } = req.body;
    
    const user = await User.findById(req.params.id);
    
    if (!user) {
      return res.status(404).json({ message: '用户不存在' });
    }
    
    if (phone && phone !== user.phone) {
      const existing = await User.findOne({ phone, _id: { $ne: req.params.id } });
      if (existing) {
        return res.status(400).json({ message: '手机号已被使用' });
      }
    }
    
    user.realName = realName || user.realName;
    user.phone = phone || user.phone;
    user.role = role !== undefined ? role : user.role;
    user.status = status !== undefined ? status : user.status;
    user.skillLevel = skillLevel !== undefined ? skillLevel : user.skillLevel;
    user.location = location || user.location;
    user.assignedPonds = assignedPonds || user.assignedPonds;
    
    await user.save();
    
    res.json({
      success: true,
      data: user
    });
  } catch (error) {
    next(error);
  }
};

const deleteUser = async (req, res, next) => {
  try {
    const user = await User.findByIdAndDelete(req.params.id);
    
    if (!user) {
      return res.status(404).json({ message: '用户不存在' });
    }
    
    res.json({
      success: true,
      message: '用户已删除'
    });
  } catch (error) {
    next(error);
  }
};

const getTechnicians = async (req, res, next) => {
  try {
    const { status = 'active' } = req.query;
    
    const technicians = await User.find({
      role: 'technician',
      status
    }).sort({ skillLevel: -1 });
    
    res.json({
      success: true,
      data: technicians
    });
  } catch (error) {
    next(error);
  }
};

const updateLocation = async (req, res, next) => {
  try {
    const { coordinates } = req.body;
    
    const user = await User.findById(req.user.id);
    
    if (!user) {
      return res.status(404).json({ message: '用户不存在' });
    }
    
    user.location = {
      type: 'Point',
      coordinates
    };
    
    await user.save();
    
    res.json({
      success: true,
      message: '位置更新成功',
      data: user.location
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getUsers,
  getUserById,
  createUser,
  updateUser,
  deleteUser,
  getTechnicians,
  updateLocation
};
