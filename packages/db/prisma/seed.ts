import { PrismaClient, Role } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await bcrypt.hash("Password123!", 10);

  const users = [
    { email: "admin@lms.test", name: "Admin User", role: Role.ADMIN },
    { email: "instructor@lms.test", name: "Ira Instructor", role: Role.INSTRUCTOR },
    { email: "student@lms.test", name: "Sam Student", role: Role.STUDENT },
  ];

  for (const u of users) {
    await prisma.user.upsert({
      where: { email: u.email },
      update: {},
      create: { ...u, passwordHash },
    });
  }
  console.log("Seeded demo users (password: Password123!)");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());