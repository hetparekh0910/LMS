import { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { Role } from "@lms/db";
import { config } from "../config";
import { HttpError } from "./error";

export interface AuthUser {
  id: string;
  role: Role;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export function authenticate(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return next(new HttpError(401, "Missing token"));
  try {
    const payload = jwt.verify(header.slice(7), config.JWT_ACCESS_SECRET) as jwt.JwtPayload;
    req.user = { id: payload.sub as string, role: payload.role as Role };
    next();
  } catch {
    next(new HttpError(401, "Invalid or expired token"));
  }
}

export const requireRole =
  (...roles: Role[]) =>
  (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(new HttpError(401, "Not authenticated"));
    if (!roles.includes(req.user.role)) return next(new HttpError(403, "Forbidden"));
    next();
  };