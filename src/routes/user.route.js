import express from "express";
import { bootstrap, getMe, getUser, searchUsers, sync, updateMe } from "../controller/user.controller.js";
import {
  blockUser,
  deleteNickname,
  getPresence,
  listBlocks,
  listNicknames,
  presenceHeartbeat,
  presenceOffline,
  setNickname,
  unblockUser,
} from "../controller/social.controller.js";
import { listStickers } from "../controller/message.controller.js";
import { createUploadSignature } from "../controller/file.controller.js";
import { authorize, protectRoute, requireUser } from "../middleware/auth.middleware.js";

// Mount tại /api – middleware gắn theo từng route để không chặn router khác.
const router = express.Router();
const user = [protectRoute, requireUser];

router.get("/me", protectRoute, getMe);
router.patch("/me", protectRoute, updateMe);
router.get("/me/bootstrap", protectRoute, bootstrap);
router.get("/sync", protectRoute, sync);

router.get("/users", ...user, authorize("chat", "read"), searchUsers);
router.get("/users/:id", ...user, getUser);
router.put("/users/:id/nickname", ...user, setNickname);
router.delete("/users/:id/nickname", ...user, deleteNickname);
router.get("/nicknames", ...user, listNicknames);

router.post("/blocks/:userId", ...user, blockUser);
router.delete("/blocks/:userId", ...user, unblockUser);
router.get("/blocks", ...user, listBlocks);

router.post("/presence/heartbeat", protectRoute, presenceHeartbeat);
router.delete("/presence", protectRoute, presenceOffline);
router.get("/presence", protectRoute, getPresence);

router.get("/stickers", protectRoute, listStickers);
router.post("/files/signature", protectRoute, createUploadSignature);

export default router;
