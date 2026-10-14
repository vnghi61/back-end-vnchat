import jwt from "jsonwebtoken"
import { config, isProduction } from "../config.js";

// JWT mang userId + sid (session) – thu hồi session là token hết hiệu lực ngay.
export const generateToken = (userId, res, sessionId) => {
    const token = jwt.sign({userId: String(userId), sid: String(sessionId)}, process.env.JWT_SECRET,{
        expiresIn: `${config.sessionTtlDays}d`
    })

    if (res) {
        res.cookie("jwt", token, {
            maxAge: config.sessionTtlDays*24*60*60*1000,
            httpOnly: true,
            sameSite: "strict",
            secure: isProduction()
        });
    }

    return token;
}

export const clearTokenCookie = (res) => {
    res.cookie("jwt", "", {maxAge:0, httpOnly: true, sameSite: "strict", secure: isProduction()});
}

export const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
