import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { prisma, Role } from "@lms/db";
import { config } from "../../config";
import { authenticate } from "../../middleware/auth";
import { asyncHandler, HttpError, validate } from "../../middleware/error";

export const authRouter = Router();

const registerSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(8),
  // Admins can never self-register
  role: z.enum(["STUDENT", "INSTRUCTOR"]).default("STUDENT"),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

function issueTokens(user: { id: string; role: Role }) {
  const accessToken = jwt.sign({ role: user.role }, config.JWT_ACCESS_SECRET, {
    subject: user.id,
    expiresIn: config.ACCESS_TTL as jwt.SignOptions["expiresIn"],
  });
  const refreshToken = jwt.sign({ role: user.role }, config.JWT_REFRESH_SECRET, {
    subject: user.id,
    expiresIn: config.REFRESH_TTL as jwt.SignOptions["expiresIn"],
  });
  return { accessToken, refreshToken };
}

const publicUser = (u: { id: string; name: string; email: string; role: Role }) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  role: u.role,
});

authRouter.post(
  "/register",
  validate(registerSchema),
  asyncHandler(async (req, res) => {
    const { name, email, password, role } = req.body;
    const exists = await prisma.user.findUnique({ where: { email } });
    if (exists) throw new HttpError(409, "Email already registered");

    const user = await prisma.user.create({
      data: { name, email, role, passwordHash: await bcrypt.hash(password, 10) },
    });
    res.status(201).json({ user: publicUser(user), ...issueTokens(user) });
  })
);

authRouter.post(
  "/login",
  validate(loginSchema),
  asyncHandler(async (req, res) => {
    const { email, password } = req.body;
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      throw new HttpError(401, "Invalid credentials");
    }
    res.json({ user: publicUser(user), ...issueTokens(user) });
  })
);

authRouter.post(
  "/refresh",
  validate(z.object({ refreshToken: z.string() })),
  asyncHandler(async (req, res) => {
    try {
      const payload = jwt.verify(req.body.refreshToken, config.JWT_REFRESH_SECRET) as jwt.JwtPayload;
      const user = await prisma.user.findUnique({ where: { id: payload.sub as string } });
      if (!user) throw new Error("no user");
      res.json(issueTokens(user));
    } catch {
      throw new HttpError(401, "Invalid refresh token");
    }
  })
);

authRouter.get(
  "/me",
  authenticate,
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
    if (!user) throw new HttpError(404, "User not found");
    res.json({ user: publicUser(user) });
  })
);