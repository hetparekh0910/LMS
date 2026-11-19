import cors from "cors";
import express from "express";
import helmet from "helmet";
import morgan from "morgan";
import rateLimit from "express-rate-limit";
import { prisma, Role } from "@lms/db";
import { config } from "./config";
import { authenticate, requireRole } from "./middleware/auth";
import { asyncHandler, errorHandler } from "./middleware/error";
import { authRouter } from "./modules/auth/auth.routes";
import { contentRouter, courseRouter } from "./modules/courses/courses.routes";
import { videoRouter } from "./modules/videos/videos.routes";
import { adminRouter } from "./modules/admin/admin.routes";

export const app = express();

app.use(helmet());
app.use(cors({ origin: config.WEB_URL, credentials: true }));
app.use(express.json({ limit: "1mb" }));
if (config.NODE_ENV !== "test") app.use(morgan("dev"));

app.get("/health", (_req, res) => res.json({ status: "ok" }));

app.use("/auth", rateLimit({ windowMs: 15 * 60 * 1000, limit: 200 }), authRouter);

app.get(
  "/admin/users",
  authenticate,
  requireRole(Role.ADMIN),
  asyncHandler(async (_req, res) => {
    const users = await prisma.user.findMany({
      select: { id: true, name: true, email: true, role: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    });
    res.json({ users });
  })
);

app.use("/courses", courseRouter);
app.use("/", contentRouter);
app.use("/videos", videoRouter);
app.use("/admin", adminRouter);

app.use(errorHandler);