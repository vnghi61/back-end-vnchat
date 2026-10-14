import jwt from "jsonwebtoken"
import { config, isProduction } from "../config.js";

const cookieOptions = () => ({
    httpOnly: true,
    sameSite: config.cookieSameSite,
    // SameSite=None bắt buộc Secure
    secure: isProduction() || config.cookieSameSite === "none",
});

// JWT mang userId + sid (session) – thu hồi session là token hết hiệu lực ngay.
export const generateToken = (userId, res, sessionId) => {
    const token = jwt.sign({userId: String(userId), sid: String(sessionId)}, process.env.JWT_SECRET,{
        expiresIn: `${config.sessionTtlDays}d`
    })

    if (res) {
        res.cookie("jwt", token, {
            ...cookieOptions(),
            maxAge: config.sessionTtlDays*24*60*60*1000,
        });
    }

    return token;
}

export const clearTokenCookie = (res) => {
    res.cookie("jwt", "", {...cookieOptions(), maxAge:0});
}

export const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
