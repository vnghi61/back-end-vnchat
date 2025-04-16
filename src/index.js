import express from "express"
import dotenv from "dotenv";

import { connectDB } from "./lib/db.js";
import authRoute from "./routes/auth.route.js";
import messageRoute from "./routes/auth.route.js";
import cookieParser from "cookie-parser";


dotenv.config();
const app = express();

const PORT = process.env.PORT

app.use(express.json());
app.use(cookieParser());
app.use("/api/auth", authRoute);
app.use("/api/message", messageRoute);


app.listen(PORT, () => {
    console.log("hehe 50000");
    connectDB();
})