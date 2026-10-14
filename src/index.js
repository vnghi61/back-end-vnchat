import "dotenv/config";
import http from "http";

import { config } from "./config.js";
import { createApp } from "./app.js";
import { connectDB } from "./lib/db.js";
import { initSocket } from "./lib/socket.js";
import { startBackgroundJobs } from "./services/jobs.service.js";
import { runMigrations } from "./services/migration.service.js";

if (!process.env.JWT_SECRET) {
  console.log("JWT_SECRET is required");
  process.exit(1);
}

const app = createApp();
const server = http.createServer(app);
initSocket(server);

const start = async () => {
  await connectDB();
  await runMigrations();
  startBackgroundJobs();
  server.listen(config.port, () => {
    console.log("server is running on PORT:" + config.port);
  });
};

start().catch((error) => {
  console.log("Failed to start server", error);
  process.exit(1);
});
