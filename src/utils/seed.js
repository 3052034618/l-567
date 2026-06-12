require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const User = require('../models/User');
const FishSpecies = require('../models/FishSpecies');
const Pond = require('../models/Pond');
const Device = require('../models/Device');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/smart_aquaculture';

const seedData = async () => {
  try {
    await mongoose.connect(MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
    
    console.log('数据库连接成功');
    
    console.log('正在清空现有数据...');
    await User.deleteMany({});
    await FishSpecies.deleteMany({});
    await Pond.deleteMany({});
    await Device.deleteMany({});
    
    console.log('正在创建管理员用户...');
    const adminPassword = await bcrypt.hash('admin123', 10);
    const admin = await User.create({
      username: 'admin',
      password: adminPassword,
      realName: '系统管理员',
      phone: '13800000001',
      role: 'admin',
      status: 'active'
    });
    
    const supervisorPassword = await bcrypt.hash('123456', 10);
    const supervisor = await User.create({
      username: 'supervisor',
      password: supervisorPassword,
      realName: '张主管',
      phone: '13800000002',
      role: 'supervisor',
      status: 'active'
    });
    
    const workerPassword = await bcrypt.hash('123456', 10);
    const worker1 = await User.create({
      username: 'worker1',
      password: workerPassword,
      realName: '李养殖员',
      phone: '13800000003',
      role: 'worker',
      status: 'active'
    });
    
    const techPassword = await bcrypt.hash('123456', 10);
    const tech1 = await User.create({
      username: 'tech1',
      password: techPassword,
      realName: '王技术员',
      phone: '13800000004',
      role: 'technician',
      status: 'active',
      skillLevel: 4,
      location: {
        type: 'Point',
        coordinates: [116.4074, 39.9042]
      }
    });
    
    const tech2 = await User.create({
      username: 'tech2',
      password: techPassword,
      realName: '赵技术员',
      phone: '13800000005',
      role: 'technician',
      status: 'active',
      skillLevel: 3,
      location: {
        type: 'Point',
        coordinates: [116.4174, 39.9142]
      }
    });
    
    console.log('用户创建完成');
    
    console.log('正在创建鱼种...');
    const grassCarp = await FishSpecies.create({
      name: '草鱼',
      scientificName: 'Ctenopharyngodon idellus',
      description: '草鱼是典型的草食性鱼类，生长迅速，是中国主要的淡水养殖鱼类之一。',
      optimalTemperature: {
        min: 20,
        max: 30,
        optimal: 25
      },
      optimalOxygen: {
        min: 5,
        optimal: 7
      },
      optimalPH: {
        min: 6.5,
        max: 8.5,
        optimal: 7.5
      },
      growthStages: [
        { name: '鱼苗期', days: 30, minWeight: 0, maxWeight: 0.05, feedRate: 8, dailyFeedings: 4, temperatureAdjustment: 0, oxygenAdjustment: 0.5 },
        { name: '鱼种期', days: 60, minWeight: 0.05, maxWeight: 0.5, feedRate: 6, dailyFeedings: 3, temperatureAdjustment: 0, oxygenAdjustment: 0.3 },
        { name: '成鱼前期', days: 90, minWeight: 0.5, maxWeight: 2, feedRate: 4, dailyFeedings: 3, temperatureAdjustment: 0, oxygenAdjustment: 0 },
        { name: '成鱼期', days: 120, minWeight: 2, maxWeight: 5, feedRate: 3, dailyFeedings: 2, temperatureAdjustment: -1, oxygenAdjustment: -0.5 },
        { name: '育肥期', days: 60, minWeight: 5, maxWeight: 10, feedRate: 2.5, dailyFeedings: 2, temperatureAdjustment: -2, oxygenAdjustment: -1 }
      ],
      feedConversionRatio: 1.8,
      maxStockDensity: 1500,
      isActive: true
    });
    
    const tilapia = await FishSpecies.create({
      name: '罗非鱼',
      scientificName: 'Oreochromis niloticus',
      description: '罗非鱼是热带鱼类，生长快，繁殖力强，适合温水养殖。',
      optimalTemperature: {
        min: 24,
        max: 32,
        optimal: 28
      },
      optimalOxygen: {
        min: 4,
        optimal: 6
      },
      optimalPH: {
        min: 6.0,
        max: 9.0,
        optimal: 7.5
      },
      growthStages: [
        { name: '鱼苗期', days: 25, minWeight: 0, maxWeight: 0.03, feedRate: 10, dailyFeedings: 5, temperatureAdjustment: 1, oxygenAdjustment: 0.5 },
        { name: '鱼种期', days: 50, minWeight: 0.03, maxWeight: 0.3, feedRate: 7, dailyFeedings: 3, temperatureAdjustment: 0.5, oxygenAdjustment: 0.3 },
        { name: '成鱼期', days: 100, minWeight: 0.3, maxWeight: 1.5, feedRate: 4.5, dailyFeedings: 3, temperatureAdjustment: 0, oxygenAdjustment: 0 },
        { name: '育肥期', days: 45, minWeight: 1.5, maxWeight: 2.5, feedRate: 3, dailyFeedings: 2, temperatureAdjustment: -0.5, oxygenAdjustment: -0.3 }
      ],
      feedConversionRatio: 1.6,
      maxStockDensity: 2000,
      isActive: true
    });
    
    console.log('鱼种创建完成');
    
    console.log('正在创建养殖池...');
    const pond1 = await Pond.create({
      pondNo: 'P001',
      name: '1号养殖池',
      area: 1000,
      depth: 2,
      volume: 2000,
      fishSpecies: grassCarp._id,
      stockDate: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000),
      initialStockCount: 2000,
      currentStockCount: 1950,
      averageWeight: 0.3,
      totalBiomass: 585,
      location: {
        type: 'Point',
        coordinates: [116.4074, 39.9042]
      },
      assignedWorker: worker1._id,
      status: 'normal',
      thresholds: {
        temperatureMin: 20,
        temperatureMax: 30,
        oxygenMin: 5,
        phMin: 6.5,
        phMax: 8.5
      },
      currentWaterQuality: {
        temperature: 25,
        oxygen: 7,
        ph: 7.5,
        activity: 75,
        lastUpdate: new Date()
      },
      growthStage: '鱼种期'
    });
    
    const pond2 = await Pond.create({
      pondNo: 'P002',
      name: '2号养殖池',
      area: 800,
      depth: 1.8,
      volume: 1440,
      fishSpecies: tilapia._id,
      stockDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      initialStockCount: 3000,
      currentStockCount: 2900,
      averageWeight: 0.05,
      totalBiomass: 145,
      location: {
        type: 'Point',
        coordinates: [116.4100, 39.9060]
      },
      assignedWorker: worker1._id,
      status: 'normal',
      thresholds: {
        temperatureMin: 24,
        temperatureMax: 32,
        oxygenMin: 4,
        phMin: 6.0,
        phMax: 9.0
      },
      currentWaterQuality: {
        temperature: 28,
        oxygen: 6,
        ph: 7.2,
        activity: 85,
        lastUpdate: new Date()
      },
      growthStage: '鱼苗期'
    });
    
    const pond3 = await Pond.create({
      pondNo: 'P003',
      name: '3号养殖池',
      area: 1200,
      depth: 2.2,
      volume: 2640,
      fishSpecies: grassCarp._id,
      stockDate: new Date(Date.now() - 120 * 24 * 60 * 60 * 1000),
      initialStockCount: 2500,
      currentStockCount: 2400,
      averageWeight: 1.5,
      totalBiomass: 3600,
      location: {
        type: 'Point',
        coordinates: [116.4050, 39.9080]
      },
      assignedWorker: worker1._id,
      status: 'normal',
      thresholds: {
        temperatureMin: 20,
        temperatureMax: 30,
        oxygenMin: 5,
        phMin: 6.5,
        phMax: 8.5
      },
      currentWaterQuality: {
        temperature: 24,
        oxygen: 6.5,
        ph: 7.8,
        activity: 70,
        lastUpdate: new Date()
      },
      growthStage: '成鱼前期'
    });
    
    console.log('养殖池创建完成');
    
    console.log('正在创建设备...');
    const deviceTypes = [
      { type: 'temperature_sensor', name: '水温传感器', prefix: 'TS' },
      { type: 'oxygen_sensor', name: '溶氧传感器', prefix: 'OS' },
      { type: 'ph_sensor', name: 'pH传感器', prefix: 'PS' },
      { type: 'activity_sensor', name: '活动量传感器', prefix: 'AS' },
      { type: 'oxygen_pump', name: '增氧机', prefix: 'OP', power: 3 },
      { type: 'water_pump', name: '换水泵', prefix: 'WP', power: 5 },
      { type: 'feeder', name: '自动投喂机', prefix: 'FD', power: 0.5 }
    ];
    
    const ponds = [pond1, pond2, pond3];
    
    for (let i = 0; i < ponds.length; i++) {
      const pond = ponds[i];
      
      for (const dt of deviceTypes) {
        await Device.create({
          deviceId: `${dt.prefix}-${pond.pondNo}-01`,
          name: `${pond.name}${dt.name}`,
          type: dt.type,
          pond: pond._id,
          status: dt.prefix === 'FD' || dt.prefix === 'OP' ? 'stopped' : 'running',
          powerRating: dt.power || 0.1,
          manufacturer: '智能水产科技',
          model: `${dt.type}-pro-2024`,
          autoControl: true,
          installDate: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000),
          position: {
            type: 'Point',
            coordinates: [pond.location.coordinates[0] + (Math.random() - 0.5) * 0.002, 
                          pond.location.coordinates[1] + (Math.random() - 0.5) * 0.002]
          }
        });
      }
    }
    
    console.log('设备创建完成');
    
    console.log('\n========== 初始化完成 ==========');
    console.log('管理员账号: admin / admin123');
    console.log('主管账号: supervisor / 123456');
    console.log('养殖员账号: worker1 / 123456');
    console.log('技术员账号: tech1 / 123456, tech2 / 123456');
    console.log('养殖池数量: 3个');
    console.log('鱼种数量: 2种');
    console.log('设备数量: 21个');
    console.log('================================\n');
    
    process.exit(0);
    
  } catch (error) {
    console.error('初始化数据失败:', error);
    process.exit(1);
  }
};

seedData();
