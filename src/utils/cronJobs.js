const cron = require('node-cron');
const { generateAllPondsDailyLog } = require('../controllers/dailyLogController');
const { scheduleFeeding, calculateFeedAmount } = require('../controllers/feedingController');
const Pond = require('../models/Pond');
const { updatePondThresholds } = require('../controllers/pondController');

const initCronJobs = () => {
  console.log('定时任务已初始化');
  
  cron.schedule('0 2 * * *', async () => {
    console.log('开始生成每日养殖日志...');
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const result = await generateAllPondsDailyLog(yesterday);
    console.log(`每日日志生成完成: ${result.count}/${result.totalPonds}个养殖池`);
  }, {
    scheduled: true,
    timezone: 'Asia/Shanghai'
  });
  
  const feedingTimes = ['0 8 * * *', '0 12 * * *', '0 18 * * *'];
  feedingTimes.forEach((schedule, index) => {
    cron.schedule(schedule, async () => {
      console.log(`开始执行第${index + 1}次定时投喂...`);
      try {
        const ponds = await Pond.find({ status: { $ne: 'maintenance' } });
        for (const pond of ponds) {
          await scheduleFeeding(pond._id, Date.now());
        }
        console.log(`定时投喂完成，共${ponds.length}个养殖池`);
      } catch (error) {
        console.error('定时投喂失败:', error);
      }
    }, {
      scheduled: true,
      timezone: 'Asia/Shanghai'
    });
  });
  
  cron.schedule('0 0 * * *', async () => {
    console.log('开始更新养殖池阈值...');
    try {
      const ponds = await Pond.find({ status: { $ne: 'maintenance' } });
      for (const pond of ponds) {
        await updatePondThresholds(pond._id);
      }
      console.log(`阈值更新完成，共${ponds.length}个养殖池`);
    } catch (error) {
      console.error('阈值更新失败:', error);
    }
  }, {
    scheduled: true,
    timezone: 'Asia/Shanghai'
  });
  
  console.log('已配置以下定时任务:');
  console.log('- 每日 02:00 生成昨日养殖日志');
  console.log('- 每日 08:00、12:00、18:00 自动投喂');
  console.log('- 每日 00:00 更新养殖池阈值');
};

module.exports = { initCronJobs };
