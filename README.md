# 智慧水产养殖环境监测与自动投喂调度系统 - 后端API

## 项目概述

本系统是智慧水产养殖环境监测与自动投喂调度系统的后端服务，提供养殖环境监测、预警工单、自动投喂、设备控制、能耗管理等核心功能。

## 技术栈

- **运行环境**: Node.js
- **Web框架**: Express.js
- **数据库**: MongoDB
- **ODM**: Mongoose
- **认证**: JWT (JSON Web Token)
- **实时通信**: Socket.IO
- **定时任务**: node-cron
- **文件上传**: Multer
- **Excel导出**: ExcelJS
- **参数校验**: Joi

## 功能模块

### 1. 用户管理
- 用户登录/注册
- 用户CRUD管理
- 角色权限（管理员、主管、技术员、养殖员）
- 技术员位置更新

### 2. 养殖池管理
- 养殖池CRUD
- 养殖池状态监控
- 养殖池汇总统计

### 3. 鱼种管理
- 鱼种CRUD
- 生长阶段配置
- 水质阈值配置

### 4. 传感器数据采集
- 传感器数据上传
- 批量数据上传
- 历史数据查询
- 数据统计分析

### 5. 预警系统
- 水质超标自动预警
- 四级预警等级（低、中、高、严重）
- 预警确认与解决
- 预警统计

### 6. 工单系统
- 自动生成预警工单
- 工单智能分配（基于位置和工作量）
- 工单处理流程
- 照片上传
- 顽固缺陷检测（30天内重复出现）

### 7. 自动投喂系统
- 投喂量智能计算（基于鱼群活动量、水温、历史摄食率）
- 定时自动投喂
- 手动投喂触发
- 投喂记录查询
- 投喂设备故障工单

### 8. 设备管理
- 设备CRUD
- 设备远程控制
- 设备故障上报
- 自动控制（增氧机、换水泵）

### 9. 能耗管理
- 能耗记录
- 能耗统计分析
- 按设备类型统计

### 10. 每日养殖日志
- 自动生成每日日志
- 日志查询
- 日志导出（Excel）
- 日志汇总统计

### 11. 实时推送
- WebSocket实时通知
- 告警推送
- 工单推送
- 设备状态推送

## 快速开始

### 环境要求

- Node.js >= 16.0.0
- MongoDB >= 4.4
- npm 或 yarn

### 安装依赖

```bash
npm install
```

### 配置环境变量

复制 `.env` 文件并根据需要修改配置：

```env
PORT=3000
NODE_ENV=development
MONGODB_URI=mongodb://localhost:27017/smart_aquaculture
JWT_SECRET=your_jwt_secret_key_here_change_in_production
JWT_EXPIRES_IN=7d
UPLOAD_DIR=./uploads
```

### 初始化数据库（种子数据）

```bash
npm run seed
```

初始化后将创建以下测试账号：
- 管理员: `admin` / `admin123`
- 主管: `supervisor` / `123456`
- 养殖员: `worker1` / `123456`
- 技术员: `tech1` / `123456`, `tech2` / `123456`

### 启动服务

```bash
# 开发模式
npm run dev

# 生产模式
npm start
```

服务将在 `http://localhost:3000` 启动。

## API 接口文档

### 认证相关

#### 登录
- **POST** `/api/auth/login`
- 无需认证
- 请求体: `{ username, password }`

#### 注册
- **POST** `/api/auth/register`
- 无需认证
- 请求体: `{ username, password, realName, phone, role? }`

#### 获取当前用户信息
- **GET** `/api/auth/me`
- 需要认证

#### 修改密码
- **POST** `/api/auth/change-password`
- 需要认证
- 请求体: `{ oldPassword, newPassword }`

### 用户管理

#### 获取用户列表
- **GET** `/api/users`
- 需要认证 + 管理员/主管权限
- 查询参数: `role, status, page, limit, keyword`

#### 获取用户详情
- **GET** `/api/users/:id`
- 需要认证 + 管理员/主管权限

#### 创建用户
- **POST** `/api/users`
- 需要认证 + 管理员/主管权限

#### 更新用户
- **PUT** `/api/users/:id`
- 需要认证 + 管理员/主管权限

#### 删除用户
- **DELETE** `/api/users/:id`
- 需要认证 + 管理员权限

#### 获取技术员列表
- **GET** `/api/users/technicians`
- 需要认证

#### 更新当前用户位置
- **POST** `/api/users/update-location`
- 需要认证
- 请求体: `{ coordinates: [lng, lat] }`

### 养殖池管理

#### 获取养殖池列表
- **GET** `/api/ponds`
- 需要认证
- 查询参数: `status, fishSpecies, page, limit, keyword`

#### 获取养殖池汇总
- **GET** `/api/ponds/summary`
- 需要认证

#### 获取养殖池详情
- **GET** `/api/ponds/:id`
- 需要认证

#### 创建养殖池
- **POST** `/api/ponds`
- 需要认证 + 管理员/主管权限

#### 更新养殖池
- **PUT** `/api/ponds/:id`
- 需要认证 + 管理员/主管权限

#### 删除养殖池
- **DELETE** `/api/ponds/:id`
- 需要认证 + 管理员权限

### 传感器数据

#### 上传传感器数据
- **POST** `/api/sensor-data/upload`
- 无需认证（设备接口）
- 请求体: `{ pondId, sensorId, sensorType, value, unit?, timestamp? }`

#### 批量上传传感器数据
- **POST** `/api/sensor-data/batch-upload`
- 无需认证（设备接口）
- 请求体: `{ pondId, data: [{ sensorId, sensorType, value, unit }], timestamp? }`

#### 获取传感器数据
- **GET** `/api/sensor-data`
- 需要认证
- 查询参数: `pondId, sensorType, startTime, endTime, page, limit`

#### 获取最新传感器数据
- **GET** `/api/sensor-data/latest/:pondId`
- 需要认证

#### 获取传感器统计数据
- **GET** `/api/sensor-data/statistics`
- 需要认证
- 查询参数: `pondId, sensorType, startTime, endTime`

### 预警管理

#### 获取预警列表
- **GET** `/api/alerts`
- 需要认证
- 查询参数: `pondId, level, status, type, page, limit, startTime, endTime`

#### 获取预警统计
- **GET** `/api/alerts/statistics`
- 需要认证
- 查询参数: `startTime, endTime, pondId`

#### 获取预警详情
- **GET** `/api/alerts/:id`
- 需要认证

#### 确认预警
- **PUT** `/api/alerts/:id/acknowledge`
- 需要认证

#### 解决预警
- **PUT** `/api/alerts/:id/resolve`
- 需要认证

### 工单管理

#### 获取工单列表
- **GET** `/api/work-orders`
- 需要认证
- 查询参数: `pondId, status, level, type, assignedTo, isStubbornDefect, page, limit, startTime, endTime`

#### 获取我的工单
- **GET** `/api/work-orders/my`
- 需要认证

#### 获取工单统计
- **GET** `/api/work-orders/statistics`
- 需要认证
- 查询参数: `startTime, endTime, pondId`

#### 获取工单详情
- **GET** `/api/work-orders/:id`
- 需要认证

#### 创建工单
- **POST** `/api/work-orders`
- 需要认证 + 管理员/主管权限

#### 分配工单
- **PUT** `/api/work-orders/:id/assign`
- 需要认证 + 管理员/主管权限
- 请求体: `{ technicianId }`

#### 开始处理工单
- **POST** `/api/work-orders/:id/start`
- 需要认证

#### 完成工单
- **POST** `/api/work-orders/:id/complete`
- 需要认证
- 请求体: `{ handlingNotes? }`

#### 上传工单照片
- **POST** `/api/work-orders/:id/photos`
- 需要认证
- Content-Type: `multipart/form-data`
- 字段名: `photo`

### 投喂管理

#### 获取投喂记录
- **GET** `/api/feeding`
- 需要认证
- 查询参数: `pondId, status, feedingType, page, limit, startTime, endTime`

#### 获取投喂统计
- **GET** `/api/feeding/statistics`
- 需要认证
- 查询参数: `pondId, startTime, endTime`

#### 获取投喂记录详情
- **GET** `/api/feeding/:id`
- 需要认证

#### 计算推荐投喂量
- **GET** `/api/feeding/calculate/:pondId`
- 需要认证

#### 触发投喂
- **POST** `/api/feeding/trigger`
- 需要认证 + 管理员/主管/养殖员权限
- 请求体: `{ pondId, amount?, feedingType? }`

### 设备管理

#### 获取设备列表
- **GET** `/api/devices`
- 需要认证
- 查询参数: `type, status, pondId, page, limit, keyword`

#### 获取设备状态概览
- **GET** `/api/devices/status`
- 需要认证

#### 获取设备详情
- **GET** `/api/devices/:id`
- 需要认证

#### 创建设备
- **POST** `/api/devices`
- 需要认证 + 管理员/主管权限

#### 更新设备
- **PUT** `/api/devices/:id`
- 需要认证 + 管理员/主管权限

#### 删除设备
- **DELETE** `/api/devices/:id`
- 需要认证 + 管理员权限

#### 控制设备
- **POST** `/api/devices/:id/control`
- 需要认证 + 管理员/主管/养殖员权限
- 请求体: `{ action: 'start'|'stop'|'adjust', speed? }`

#### 上报设备故障
- **POST** `/api/devices/:id/fault`
- 需要认证
- 请求体: `{ faultCode?, faultMessage? }`

### 能耗管理

#### 获取能耗记录
- **GET** `/api/energy`
- 需要认证
- 查询参数: `pondId, deviceId, deviceType, page, limit, startTime, endTime`

#### 获取能耗统计
- **GET** `/api/energy/statistics`
- 需要认证
- 查询参数: `pondId, startTime, endTime, groupBy`

#### 获取单池能耗统计
- **GET** `/api/energy/pond/:pondId`
- 需要认证

### 每日日志

#### 获取日志列表
- **GET** `/api/daily-logs`
- 需要认证
- 查询参数: `pondId, page, limit, startDate, endDate`

#### 获取日志汇总
- **GET** `/api/daily-logs/summary`
- 需要认证
- 查询参数: `pondId, startDate, endDate`

#### 导出日志
- **GET** `/api/daily-logs/export`
- 需要认证
- 查询参数: `pondId, startDate, endDate, format: 'excel'|'json'`

#### 获取日志详情
- **GET** `/api/daily-logs/:id`
- 需要认证

#### 生成日志
- **POST** `/api/daily-logs`
- 需要认证 + 管理员/主管权限
- 请求体: `{ pondId, date? }`

#### 更新日志
- **PUT** `/api/daily-logs/:id`
- 需要认证 + 管理员/主管权限

### 健康检查

- **GET** `/api/health`
- 无需认证

## WebSocket 事件

### 连接

使用 Socket.IO 客户端连接:

```javascript
const socket = io('http://localhost:3000');

// 注册用户
socket.emit('register', userId);
```

### 事件列表

| 事件名 | 说明 | 数据 |
|--------|------|------|
| `alert:new` | 新告警 | Alert对象 |
| `alert:update` | 告警更新 | Alert对象 |
| `workOrder:new` | 新工单 | WorkOrder对象 |
| `workOrder:update` | 工单更新 | WorkOrder对象 |
| `workOrder:assigned` | 工单分配给当前用户 | WorkOrder对象 |
| `workOrder:photo` | 工单新增照片 | { orderId, photo } |
| `device:update` | 设备状态更新 | Device对象 |
| `device:fault` | 设备故障 | Device对象 |
| `pond:update` | 养殖池状态更新 | Pond对象 |
| `feeding:new` | 新投喂记录 | FeedingRecord对象 |
| `feeding:complete` | 投喂完成 | FeedingRecord对象 |
| `stubbornDefect:new` | 新顽固缺陷 | WorkOrder对象 |

## 角色权限说明

| 功能 | 管理员 | 主管 | 技术员 | 养殖员 |
|------|--------|------|--------|--------|
| 用户管理 | ✅ | ✅ | ❌ | ❌ |
| 鱼种管理 | ✅ | ✅ | ❌ | ❌ |
| 养殖池管理 | ✅ | ✅ | ❌ | ❌ |
| 设备管理 | ✅ | ✅ | ❌ | ❌ |
| 设备控制 | ✅ | ✅ | ❌ | ✅ |
| 工单分配 | ✅ | ✅ | ❌ | ❌ |
| 工单处理 | ✅ | ✅ | ✅ | ❌ |
| 手动投喂 | ✅ | ✅ | ❌ | ✅ |
| 日志生成 | ✅ | ✅ | ❌ | ❌ |
| 数据查看 | ✅ | ✅ | ✅ | ✅ |

## 项目结构

```
src/
├── app.js                 # 主应用入口
├── config/                # 配置文件
│   ├── index.js           # 配置常量
│   └── database.js        # 数据库连接
├── controllers/           # 控制器
│   ├── authController.js
│   ├── userController.js
│   ├── fishSpeciesController.js
│   ├── pondController.js
│   ├── sensorDataController.js
│   ├── alertController.js
│   ├── workOrderController.js
│   ├── feedingController.js
│   ├── deviceController.js
│   ├── energyController.js
│   └── dailyLogController.js
├── middleware/            # 中间件
│   ├── auth.js           # 认证中间件
│   ├── errorHandler.js   # 错误处理
│   └── upload.js         # 文件上传
├── models/                # 数据模型
│   ├── User.js
│   ├── FishSpecies.js
│   ├── Pond.js
│   ├── SensorData.js
│   ├── Device.js
│   ├── EnergyRecord.js
│   ├── WorkOrder.js
│   ├── FeedingRecord.js
│   ├── Alert.js
│   └── DailyLog.js
├── routes/                # 路由
│   ├── authRoutes.js
│   ├── userRoutes.js
│   ├── fishSpeciesRoutes.js
│   ├── pondRoutes.js
│   ├── sensorDataRoutes.js
│   ├── alertRoutes.js
│   ├── workOrderRoutes.js
│   ├── feedingRoutes.js
│   ├── deviceRoutes.js
│   ├── energyRoutes.js
│   └── dailyLogRoutes.js
└── utils/                 # 工具函数
    ├── websocket.js       # WebSocket管理
    ├── cronJobs.js        # 定时任务
    └── seed.js            # 种子数据
```

## 定时任务

系统内置以下定时任务（自动启动）：

1. **每日 02:00** - 生成前一日所有养殖池的养殖日志
2. **每日 08:00、12:00、18:00** - 自动执行投喂任务
3. **每日 00:00** - 更新所有养殖池的水质阈值（根据生长阶段）

## 核心业务逻辑

### 投喂量计算

投喂量计算公式：

```
基础投喂量 = 生物量 × 投饵率
最终投喂量 = 基础投喂量 × 水温系数 × 活动量系数 × 历史摄食率系数
```

- **水温系数**: 根据当前水温与最适温度的差异调整（1.0 ~ 0.5）
- **活动量系数**: 根据鱼群活动量调整（1.1 ~ 0.5）
- **历史摄食率系数**: 根据近7天平均摄食率调整（1.05 ~ 0.7）

### 工单智能分配

综合考虑以下因素自动分配工单：

1. **距离权重 (40%)**: 技术员与养殖池的地理距离
2. **工作量权重 (30%)**: 当前待处理工单数量
3. **技能等级权重 (30%)**: 技术员技能等级

### 顽固缺陷检测

同一养殖池、同一类型的问题，30天内出现3次及以上，自动标记为顽固缺陷并通知所有主管。

### 设备自动控制

- **增氧机**: 溶氧低于阈值的80%时自动启动，高于阈值的150%时自动停止
- **换水泵**: 水温超过最高阈值时自动启动，低于最高阈值3°C时自动停止

## License

ISC
