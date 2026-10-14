import { Errors } from "../lib/errors.js";
import { can } from "../lib/permissions.js";
import { authenticateToken, extractToken } from "../services/session.service.js";

// Cookie `jwt` (web) hoặc `Authorization: Bearer <jwt>` (mobile). Session phải còn hiệu lực
// và tài khoản active.
export const protectRoute = async (req, res, next) => {
    const { user, session } = await authenticateToken(extractToken(req));
    req.user = user;
    req.session = session;
    next();
}

// Chỉ tài khoản đăng ký (không phải khách widget / bot).
export const requireUser = (req, res, next) => {
    if (req.user?.kind !== "user") throw Errors.forbidden("registered users only");
    next();
}

// Quyền hệ thống theo policy (vd. authorize("admin:webhooks", "write")).
export const authorize = (obj, act) => async (req, res, next) => {
    if (!(await can(req.user, obj, act))) {
        if (obj === "support") throw Errors.agentOnly();
        throw Errors.forbidden(`${obj}:${act}`);
    }
    next();
}
