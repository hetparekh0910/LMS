import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@lms/db";
import { app } from "../src/app";

const email = `test_${Date.now()}@lms.test`;
let token = "";

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email } });
  await prisma.$disconnect();
});

describe("auth + RBAC", () => {
  it("registers a student", async () => {
    const res = await request(app)
      .post("/auth/register")
      .send({ name: "Test User", email, password: "Password123!" });
    expect(res.status).toBe(201);
    expect(res.body.user.role).toBe("STUDENT");
    token = res.body.accessToken;
  });

  it("rejects duplicate email", async () => {
    const res = await request(app)
      .post("/auth/register")
      .send({ name: "Test User", email, password: "Password123!" });
    expect(res.status).toBe(409);
  });

  it("does not allow self-registering as admin", async () => {
    const res = await request(app)
      .post("/auth/register")
      .send({ name: "Evil", email: `x_${email}`, password: "Password123!", role: "ADMIN" });
    expect(res.status).toBe(400);
  });

  it("returns current user with a valid token", async () => {
    const res = await request(app).get("/auth/me").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe(email);
  });

  it("blocks a student from admin routes", async () => {
    const res = await request(app).get("/admin/users").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it("allows admin into admin routes", async () => {
    const login = await request(app)
      .post("/auth/login")
      .send({ email: "admin@lms.test", password: "Password123!" });
    const res = await request(app)
      .get("/admin/users")
      .set("Authorization", `Bearer ${login.body.accessToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.users)).toBe(true);
  });
});