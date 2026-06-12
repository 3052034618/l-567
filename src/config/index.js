require('dotenv').config();

module.exports = {
  port: process.env.PORT || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',
  jwtSecret: process.env.JWT_SECRET || 'default_secret',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  uploadDir: process.env.UPLOAD_DIR || './uploads',
  
  alertLevels: {
    LOW: 'low',
    MEDIUM: 'medium',
    HIGH: 'high',
    CRITICAL: 'critical'
  },
  
  workOrderStatus: {
    PENDING: 'pending',
    ASSIGNED: 'assigned',
    IN_PROGRESS: 'in_progress',
    PENDING_REVIEW: 'pending_review',
    RETURNED: 'returned',
    COMPLETED: 'completed',
    CANCELLED: 'cancelled'
  },
  
  workOrderType: {
    WATER_QUALITY_ALERT: 'water_quality_alert',
    FEEDER_FAULT: 'feeder_fault',
    EQUIPMENT_MAINTENANCE: 'equipment_maintenance'
  },
  
  deviceTypes: {
    OXYGEN_PUMP: 'oxygen_pump',
    WATER_PUMP: 'water_pump',
    FEEDER: 'feeder',
    TEMPERATURE_SENSOR: 'temperature_sensor',
    OXYGEN_SENSOR: 'oxygen_sensor',
    PH_SENSOR: 'ph_sensor',
    ACTIVITY_SENSOR: 'activity_sensor'
  },
  
  deviceStatus: {
    RUNNING: 'running',
    STOPPED: 'stopped',
    FAULT: 'fault',
    MAINTENANCE: 'maintenance'
  },
  
  stubbornDefectDays: 30
};
