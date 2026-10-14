import { config } from "../config.js";
import cloudinary from "../lib/cloudinar.js";
import { Errors } from "../lib/errors.js";
import { objectId, parse, z } from "../lib/validate.js";
import { loadForMember } from "../services/conversation.service.js";
import { cloudinaryConfigured, userFolder } from "../services/message.service.js";

// Chữ ký để client upload thẳng lên Cloudinary (API không chuyển byte file). File chỉ nằm được
// trong thư mục riêng của người dùng; gửi kèm tin bằng attachments[{url, publicId, name, size, mime}].
export const createUploadSignature = async (req, res) => {
  if (!cloudinaryConfigured()) throw Errors.storageUnavailable();
  const body = parse(z.object({ conversationId: objectId.optional() }), req.body);
  if (body.conversationId) await loadForMember(body.conversationId, req.user);

  const cloudName = process.env.CLOUDINAR_CLOUD_NAME;
  const timestamp = Math.floor(Date.now() / 1000);
  const folder = userFolder(req.user._id);
  const signature = cloudinary.utils.api_sign_request({ timestamp, folder }, process.env.CLOUDINAR_SECRECT_KEY);
  res.status(200).json({
    cloudName,
    apiKey: process.env.CLOUDINAR_API_KEY,
    timestamp,
    folder,
    signature,
    uploadUrl: `https://api.cloudinary.com/v1_1/${cloudName}/auto/upload`,
    maxFileBytes: config.limits.maxFileBytes,
    allowedMime: config.limits.allowedMime,
  });
};
