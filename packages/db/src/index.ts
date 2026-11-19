import path from "path";
import dotenv from "dotenv";

// Load the repo-root .env before Prisma reads DATABASE_URL
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient();
export * from "@prisma/client";