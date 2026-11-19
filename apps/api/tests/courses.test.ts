import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@lms/db";
import { app } from "../src/app";

const otherEmail = `inst2_${Date.now()}@lms.test`;
let inst = "";
let other = "";
let student = "";
let courseId = "";

const login = async (email: string) =>
  (await request(app).post("/auth/login").send({ email, password: "Password123!" })).body
    .accessToken as string;

const body = { title: "Test Course", description: "A course used by the test suite." };

beforeAll(async () => {
  inst = await login("instructor@lms.test");
  student = await login("student@lms.test");
  const r = await request(app)
    .post("/auth/register")
    .send({ name: "Other Inst", email: otherEmail, password: "Password123!", role: "INSTRUCTOR" });
  other = r.body.accessToken;
});

afterAll(async () => {
  if (courseId) await prisma.course.delete({ where: { id: courseId } }).catch(() => undefined);
  await prisma.user.deleteMany({ where: { email: otherEmail } });
  await prisma.$disconnect();
});

describe("courses + ownership", () => {
  it("student cannot create a course", async () => {
    const res = await request(app).post("/courses").set("Authorization", `Bearer ${student}`).send(body);
    expect(res.status).toBe(403);
  });

  it("instructor creates a DRAFT course", async () => {
    const res = await request(app).post("/courses").set("Authorization", `Bearer ${inst}`).send(body);
    expect(res.status).toBe(201);
    expect(res.body.course.status).toBe("DRAFT");
    courseId = res.body.course.id;
  });

  it("draft is hidden from the public", async () => {
    const res = await request(app).get(`/courses/${courseId}`);
    expect(res.status).toBe(404);
  });

  it("owner can see their own draft", async () => {
    const res = await request(app).get(`/courses/${courseId}`).set("Authorization", `Bearer ${inst}`);
    expect(res.status).toBe(200);
  });

  it("another instructor cannot edit it", async () => {
    const res = await request(app)
      .patch(`/courses/${courseId}`)
      .set("Authorization", `Bearer ${other}`)
      .send({ title: "Hijacked" });
    expect(res.status).toBe(403);
  });

  it("public list excludes drafts", async () => {
    const res = await request(app).get("/courses");
    expect(res.status).toBe(200);
    expect(res.body.items.some((c: { id: string }) => c.id === courseId)).toBe(false);
  });

  it("cannot submit a course with no lessons", async () => {
    const res = await request(app).post(`/courses/${courseId}/submit`).set("Authorization", `Bearer ${inst}`);
    expect(res.status).toBe(400);
  });

  it("student cannot approve courses", async () => {
    const res = await request(app)
      .post(`/admin/courses/${courseId}/approve`)
      .set("Authorization", `Bearer ${student}`);
    expect(res.status).toBe(403);
  });
});