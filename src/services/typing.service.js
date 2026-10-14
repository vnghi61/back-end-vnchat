import { config } from "../config.js";
import { Errors } from "../lib/errors.js";
import { userBrief } from "../lib/serializers.js";
import { directPeerId, isBlockedEither, loadForRead } from "./conversation.service.js";
import { realtime } from "./realtime.service.js";

const lastTyping = new Map(); // "<conversationId>:<userId>" -> ms

// typing:true lặp lại trong TYPING_THROTTLE bị bỏ qua (không phát); typing:false luôn phát.
export async function setTyping(user, conversationId, typing) {
  const { conv } = await loadForRead(conversationId, user);
  if (conv.kind === "support" && conv.support?.status === "closed") throw Errors.conversationClosed();
  if (conv.kind === "direct") {
    const peer = directPeerId(conv, user._id);
    if (peer && (await isBlockedEither(user._id, peer))) throw Errors.blocked();
  }

  const key = `${conv._id}:${user._id}`;
  const now = Date.now();
  if (typing) {
    if (now - (lastTyping.get(key) ?? 0) < config.typingThrottleMs) return false;
    lastTyping.set(key, now);
  } else {
    lastTyping.delete(key);
  }
  realtime.toConversation(conv._id, "typing", {
    conversationId: conv._id,
    user: userBrief(user),
    typing,
    expiresAt: new Date(now + 2 * config.typingThrottleMs),
  });
  return true;
}

export function sweepTyping() {
  const cutoff = Date.now() - config.typingThrottleMs;
  for (const [key, at] of lastTyping) if (at < cutoff) lastTyping.delete(key);
}
