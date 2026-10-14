// Lỗi nghiệp vụ có mã ổn định (theo bảng mã của chat-platform) để client xử lý theo `code`.
// Response lỗi: { message, code, fields? } – giữ field `message` như API cũ.

export class AppError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

const make = (status, code, message) => (detail) =>
  new AppError(status, code, detail ? `${message}: ${detail}` : message);

export const Errors = {
  validation: (message = "Invalid data", fields) =>
    new AppError(400, "CHAT-400-000", message, fields ? { fields } : {}),
  directSelf: make(400, "CHAT-400-001", "Cannot start a direct conversation with yourself"),
  groupTooLarge: make(400, "CHAT-400-002", "Group exceeds the member limit"),
  directImmutable: make(400, "CHAT-400-003", "Members of this conversation cannot be changed"),
  messageTooLong: make(400, "CHAT-400-004", "Message is too long"),
  messageEmpty: make(400, "CHAT-400-005", "Message is empty"),
  badCursor: make(400, "CHAT-400-006", "Invalid cursor"),
  mimeNotAllowed: make(400, "CHAT-400-007", "File type is not allowed"),
  notSupport: make(400, "CHAT-400-008", "Not a support conversation"),
  badPolicy: make(400, "CHAT-400-009", "Invalid policy"),
  badVote: make(400, "CHAT-400-010", "Invalid vote"),
  badSticker: make(400, "CHAT-400-011", "Sticker not found in catalogue"),
  badTimezone: make(400, "CHAT-400-014", "Invalid timezone"),

  noCredential: make(401, "CHAT-401-000", "Unauthorized"),
  invalidToken: make(401, "CHAT-401-001", "Invalid or expired token"),
  sessionRevoked: make(401, "CHAT-401-002", "Session has been revoked"),
  invalidCredentials: make(400, "CHAT-400-015", "Invalid credentials"),
  invalidApiKey: make(401, "CHAT-401-005", "Invalid API key"),

  forbidden: make(403, "CHAT-403-000", "Forbidden"),
  widgetDisabled: make(403, "CHAT-403-001", "Support widget is disabled"),
  accountLocked: make(403, "CHAT-403-002", "Account is locked"),
  notMember: make(403, "CHAT-403-003", "Not a member of this conversation"),
  ownerAdminOnly: make(403, "CHAT-403-004", "Only the group owner/admin can do this"),
  senderOnly: make(403, "CHAT-403-005", "Only the sender can do this"),
  agentOnly: make(403, "CHAT-403-006", "Only support agents can do this"),
  apiKeyScope: make(403, "CHAT-403-007", "API key is missing the required scope"),
  blocked: make(403, "CHAT-403-008", "Interaction is blocked between these users"),
  beforeHistory: make(403, "CHAT-403-009", "Message is before your visible history"),

  notFound: make(404, "CHAT-404-000", "Not found"),
  userNotFound: make(404, "CHAT-404-001", "User not found"),
  conversationNotFound: make(404, "CHAT-404-002", "Conversation not found"),
  messageNotFound: make(404, "CHAT-404-003", "Message not found"),
  webhookNotFound: make(404, "CHAT-404-006", "Webhook not found"),
  apiKeyNotFound: make(404, "CHAT-404-007", "API key not found"),
  pollNotFound: make(404, "CHAT-404-008", "Poll not found"),
  reminderNotFound: make(404, "CHAT-404-009", "Reminder not found"),

  conflict: make(409, "CHAT-409-000", "Conflict"),
  alreadyMember: make(409, "CHAT-409-001", "Already a member"),
  lastOwner: make(409, "CHAT-409-002", "The last owner cannot leave, be removed or be demoted"),
  conversationClosed: make(409, "CHAT-409-003", "Conversation is closed"),
  messageDeleted: make(409, "CHAT-409-004", "Message has been deleted"),
  alreadyAssigned: make(409, "CHAT-409-006", "Conversation already has an agent"),
  pollClosed: make(409, "CHAT-409-007", "Poll is closed"),
  pinsFull: make(409, "CHAT-409-009", "Pinned message limit reached"),
  reactionsFull: make(409, "CHAT-409-010", "Reaction limit reached"),
  alreadyBlocked: make(409, "CHAT-409-011", "User is already blocked"),

  fileTooLarge: make(413, "CHAT-413-001", "File is too large"),
  rateLimited: make(429, "CHAT-429-000", "Too many requests"),
  storageUnavailable: make(503, "CHAT-503-001", "File storage is not configured"),
};
