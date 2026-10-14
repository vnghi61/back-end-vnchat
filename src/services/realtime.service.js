// Phát sự kiện realtime qua Socket.IO. Room:
//   user:<id>     mọi socket của một người (mọi thiết bị)
//   conv:<id>     mọi thành viên đang online của hội thoại (+ agent đang xem ticket support)
//   session:<id>  socket của một session (để ngắt khi thu hồi)
//   agents        console của nhân viên hỗ trợ (role agent/admin)
//   members       mọi tài khoản đăng ký (sự kiện cũ getOnlineUsers)
// Chưa init io (test HTTP thuần, script) → mọi lời gọi là no-op.

let io = null;

export const setIo = (server) => {
  io = server;
};

export const getIo = () => io;

const ids = (list) => [...new Set(list.filter(Boolean).map(String))];

export const realtime = {
  toConversation(conversationId, type, data) {
    io?.to(`conv:${conversationId}`).emit(type, data);
  },
  toUser(userId, type, data) {
    io?.to(`user:${userId}`).emit(type, data);
  },
  toUsers(userIds, type, data) {
    const rooms = ids(userIds).map((id) => `user:${id}`);
    if (io && rooms.length) io.to(rooms).emit(type, data);
  },
  // gửi một lần tới hợp của room hội thoại và các user (socket trùng chỉ nhận một lần)
  toConversationAndUsers(conversationId, userIds, type, data) {
    if (!io) return;
    io.to([`conv:${conversationId}`, ...ids(userIds).map((id) => `user:${id}`)]).emit(type, data);
  },
  toAgents(type, data) {
    io?.to("agents").emit(type, data);
  },
  // mọi tài khoản đăng ký đang online (không gồm khách widget)
  toMembers(type, data) {
    io?.to("members").emit(type, data);
  },
  joinConversation(userIds, conversationId) {
    const rooms = ids(userIds).map((id) => `user:${id}`);
    if (io && rooms.length) io.in(rooms).socketsJoin(`conv:${conversationId}`);
  },
  leaveConversation(userIds, conversationId) {
    const rooms = ids(userIds).map((id) => `user:${id}`);
    if (io && rooms.length) io.in(rooms).socketsLeave(`conv:${conversationId}`);
  },
  setAgent(userId, isAgent) {
    if (!io) return;
    if (isAgent) io.in(`user:${userId}`).socketsJoin("agents");
    else io.in(`user:${userId}`).socketsLeave("agents");
  },
  disconnectUser(userId) {
    io?.in(`user:${userId}`).disconnectSockets(true);
  },
  disconnectSession(sessionId) {
    io?.in(`session:${sessionId}`).disconnectSockets(true);
  },
};
