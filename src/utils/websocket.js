class WebSocketManager {
  constructor() {
    this.io = null;
    this.connectedUsers = new Map();
  }

  init(io) {
    this.io = io;
    
    io.on('connection', (socket) => {
      console.log('新的WebSocket连接:', socket.id);
      
      socket.on('register', (userId) => {
        this.connectedUsers.set(userId, socket.id);
        socket.userId = userId;
        console.log(`用户 ${userId} 已注册`);
      });
      
      socket.on('disconnect', () => {
        if (socket.userId) {
          this.connectedUsers.delete(socket.userId);
          console.log(`用户 ${socket.userId} 已断开连接`);
        }
      });
    });
  }

  emitToUser(userId, event, data) {
    const socketId = this.connectedUsers.get(userId);
    if (socketId && this.io) {
      this.io.to(socketId).emit(event, data);
      return true;
    }
    return false;
  }

  emitToAll(event, data) {
    if (this.io) {
      this.io.emit(event, data);
      return true;
    }
    return false;
  }

  emitToRole(role, event, data, users) {
    if (!this.io) return false;
    const roleUsers = users.filter(u => u.role === role);
    roleUsers.forEach(user => {
      const socketId = this.connectedUsers.get(user._id.toString());
      if (socketId) {
        this.io.to(socketId).emit(event, data);
      }
    });
    return true;
  }
}

module.exports = new WebSocketManager();
