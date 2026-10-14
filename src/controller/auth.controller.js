import crypto from "node:crypto";
import User from "../models/user.model.js";
import Session from "../models/session.model.js";
import bcrypt from "bcryptjs"
import { config } from "../config.js";
import { Errors } from "../lib/errors.js";
import { normalizeName } from "../lib/names.js";
import { clearTokenCookie } from "../lib/utlist.js";
import { parse, toObjectId, z } from "../lib/validate.js";
import { audit } from "../services/audit.service.js";
import { uploadDataUri } from "../services/message.service.js";
import { createSession, extractToken, revokeAllSessions, revokeSession } from "../services/session.service.js";
import { getSettings } from "../services/settings.service.js";
import { dispatch } from "../services/webhook.service.js";
import cloudinary from "../lib/cloudinar.js";
import jwt from "jsonwebtoken";

const authResponse = (user, token) => ({
    _id: user._id,
    name: user.name,
    email: user.email,
    kind: user.kind,
    roles: user.roles?.length ? user.roles : ["member"],
    profileImg: user.profileImage,
    profileImage: user.profileImage,
    token,
});

export const signup = async (req, res) => {
    const { name, email, password} = req.body ?? {}
    if(!name){
        return res.status(400).json({message: "Name is required", code: "CHAT-400-000"});
    }
    else if(!email){
        return res.status(400).json({message: "Email is required", code: "CHAT-400-000"});
    }
    else if(!password){
        return res.status(400).json({message: "Password is required", code: "CHAT-400-000"});
    }
    if(String(password).length < 6){
        return res.status(400).json({message: "Password must be least 6 characters", code: "CHAT-400-000"});
    }
    const normalizedEmail = String(email).trim().toLowerCase();
    if (!z.string().email().safeParse(normalizedEmail).success) {
        return res.status(400).json({message: "Email is invalid", code: "CHAT-400-000"});
    }

    const user = await User.findOne({email: normalizedEmail});

    if(user) return res.status(400).json({message: "Email already exits", code: "CHAT-409-000"}) ;

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(String(password), salt);

    const newUser = await User.create({
        kind: "user",
        name: String(name).trim().slice(0, 100),
        email: normalizedEmail,
        password:hashedPassword,
    });

    const { token } = await createSession(newUser, req, res);
    dispatch("user.registered", { user: { _id: newUser._id, name: newUser.name, email: newUser.email } });
    res.status(201).json(authResponse(newUser, token));
};

export const login = async (req, res) => {
    const {email, password} = req.body ?? {};
    if (!email || !password) throw Errors.invalidCredentials();

    const user = await User.findOne({email: String(email).trim().toLowerCase(), kind: "user"});

    // cùng một thông báo cho sai email và sai mật khẩu – không lộ email nào đã đăng ký
    if(!user || !(await bcrypt.compare(String(password), user.password))){
        throw Errors.invalidCredentials();
    }
    if (user.status === "inactive") throw Errors.accountLocked();

    const { token } = await createSession(user, req, res, req.body?.device);
    res.status(200).json(authResponse(user, token));
};

export const logout = async (req, res) => {
    const token = extractToken(req);
    if (token) {
        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            if (decoded?.sid) await revokeSession(decoded.sid, decoded.userId);
        } catch {
            // token hỏng/hết hạn: chỉ cần xoá cookie
        }
    }
    clearTokenCookie(res);
    return res.status(200).json({message: "Logout success"});
};

export const logoutAll = async (req, res) => {
    await revokeAllSessions(req.user._id, "logout_all");
    await audit(req, "session.logout_all", { targetType: "user", targetId: req.user._id });
    clearTokenCookie(res);
    res.status(200).json({ message: "All sessions revoked" });
};

export const listSessions = async (req, res) => {
    const sessions = await Session.find({
        userId: req.user._id,
        revokedAt: null,
        expiresAt: { $gt: new Date() },
    }).sort({ lastUsedAt: -1 }).lean();
    res.status(200).json(sessions.map((s) => ({
        _id: s._id,
        userAgent: s.userAgent,
        ip: s.ip,
        device: s.device,
        createdAt: s.createdAt,
        lastUsedAt: s.lastUsedAt,
        expiresAt: s.expiresAt,
        current: String(s._id) === String(req.session._id),
    })));
};

export const deleteSession = async (req, res) => {
    const id = toObjectId(req.params.id);
    const revoked = await revokeSession(id, req.user._id);
    if (!revoked) throw Errors.notFound("session");
    if (String(id) === String(req.session._id)) clearTokenCookie(res);
    res.status(204).end();
};

export const updateProfile = async (req, res) => {
    const {profileImage} = req.body ?? {};
    const userId = req.user._id;
    if(!profileImage || typeof profileImage !== "string"){
        return res.status(400).json({message: "Profile Image is required", code: "CHAT-400-000"});
    }

    const url = String(profileImage).startsWith("data:")
        ? (await uploadDataUri(profileImage, userId)).url
        : (await cloudinary.uploader.upload(profileImage)).secure_url;

    const userUpdate = await User.findByIdAndUpdate(userId, {profileImage: url}, {new:true}).select("-password");

    res.status(200).json(userUpdate);
};

export const checkAuth = (req, res) => {
    res.status(200).json(req.user);
};

// ---------- khách widget (chat hỗ trợ không cần tài khoản) ----------

const signVisitor = (id) =>
    crypto.createHmac("sha256", config.visitorSecret).update(`visitor:${id}`).digest("hex").slice(0, 32);

export const visitorTokenFor = (id) => `v1.${id}.${signVisitor(id)}`;

const visitorIdFrom = (token) => {
    const m = /^v1\.([a-f0-9]{24})\.([a-f0-9]{32})$/.exec(String(token ?? ""));
    if (!m) return null;
    const expected = signVisitor(m[1]);
    return crypto.timingSafeEqual(Buffer.from(m[2]), Buffer.from(expected)) ? m[1] : null;
};

const widgetSessionSchema = z.object({
    name: z.string().trim().min(1).max(100).optional(),
    email: z.string().trim().email().max(200).optional(),
    visitorToken: z.string().max(200).optional(),
});

// Tạo (hoặc nối lại bằng visitorToken) danh tính khách + session. Khách chỉ dùng được chat hỗ trợ.
export const widgetSession = async (req, res) => {
    const { widget } = await getSettings();
    if (!widget.enabled) throw Errors.widgetDisabled();
    const body = parse(widgetSessionSchema, req.body);

    let visitor = null;
    const existingId = visitorIdFrom(body.visitorToken);
    if (existingId) {
        visitor = await User.findOne({ _id: existingId, kind: "visitor" });
        if (visitor?.status === "inactive") throw Errors.accountLocked();
    }
    if (visitor) {
        const $set = {};
        if (body.name) Object.assign($set, { name: body.name, nameSearch: normalizeName(body.name) });
        if (body.email) $set.contactEmail = body.email.toLowerCase();
        if (Object.keys($set).length) visitor = await User.findByIdAndUpdate(visitor._id, { $set }, { new: true });
    } else {
        const suffix = crypto.randomBytes(2).toString("hex").toUpperCase();
        visitor = await User.create({
            kind: "visitor",
            name: body.name ?? `Khách #${suffix}`,
            contactEmail: body.email?.toLowerCase(),
            roles: [],
        });
    }

    const { token } = await createSession(visitor, req, res, "widget");
    res.status(201).json({
        user: { _id: visitor._id, name: visitor.name, kind: visitor.kind, contactEmail: visitor.contactEmail ?? null },
        token,
        visitorToken: visitorTokenFor(visitor._id),
        welcomeMessage: widget.welcomeMessage,
    });
};
