import { Router } from "express";
import { z } from "zod";
import { CourseStatus, LessonType, Prisma, prisma, Role, VideoStatus } from "@lms/db";
import { authenticate, optionalAuth, requireRole } from "../../middleware/auth";
import { asyncHandler, HttpError, validate } from "../../middleware/error";
import { ownCourse, ownLesson, ownSection } from "./ownership";

export const courseRouter = Router(); // mounted at /courses
export const contentRouter = Router(); // mounted at / (sections + lessons)

const courseBody = z.object({
  title: z.string().min(3),
  description: z.string().min(10),
  category: z.string().optional(),
  price: z.number().int().min(0).optional(), // paise
  currency: z.string().length(3).optional(),
});

/* ---------- Public catalog ---------- */
courseRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const q = String(req.query.q ?? "").trim();
    const category = req.query.category ? String(req.query.category) : undefined;
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(50, Number(req.query.pageSize) || 12);

    const where: Prisma.CourseWhereInput = {
      status: CourseStatus.PUBLISHED,
      ...(category && { category }),
      ...(q && {
        OR: [
          { title: { contains: q, mode: "insensitive" as const } },
          { description: { contains: q, mode: "insensitive" as const } },
        ],
      }),
    };

    const [items, total] = await Promise.all([
      prisma.course.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true, title: true, description: true, category: true, price: true,
          currency: true, thumbnailKey: true,
          instructor: { select: { id: true, name: true } },
          _count: { select: { enrollments: true } },
        },
      }),
      prisma.course.count({ where }),
    ]);
    res.json({ items, total, page, pageSize });
  })
);

/* ---------- Instructor: my courses (must be before /:id) ---------- */
courseRouter.get(
  "/mine",
  authenticate,
  requireRole(Role.INSTRUCTOR),
  asyncHandler(async (req, res) => {
    const courses = await prisma.course.findMany({
      where: { instructorId: req.user!.id },
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { enrollments: true, sections: true } } },
    });
    res.json({ courses });
  })
);

/* ---------- Course detail ---------- */
courseRouter.get(
  "/:id",
  optionalAuth,
  asyncHandler(async (req, res) => {
    const course = await prisma.course.findUnique({
      where: { id: req.params.id },
      include: {
        instructor: { select: { id: true, name: true } },
        _count: { select: { enrollments: true } },
        sections: {
          orderBy: { order: "asc" },
          include: {
            lessons: {
              orderBy: { order: "asc" },
              select: {
                id: true, title: true, order: true, type: true, durationSec: true,
                videoAsset: { select: { id: true, status: true, progress: true } },
              },
            },
          },
        },
      },
    });
    if (!course) throw new HttpError(404, "Course not found");

    const isOwner = req.user?.id === course.instructorId;
    const isAdmin = req.user?.role === Role.ADMIN;
    if (course.status !== CourseStatus.PUBLISHED && !isOwner && !isAdmin) {
      throw new HttpError(404, "Course not found");
    }
    res.json({ course });
  })
);

/* ---------- Instructor: create / edit / submit ---------- */
courseRouter.post(
  "/",
  authenticate,
  requireRole(Role.INSTRUCTOR),
  validate(courseBody),
  asyncHandler(async (req, res) => {
    const course = await prisma.course.create({
      data: { ...req.body, instructorId: req.user!.id },
    });
    res.status(201).json({ course });
  })
);

courseRouter.patch(
  "/:id",
  authenticate,
  requireRole(Role.INSTRUCTOR),
  validate(courseBody.partial()),
  asyncHandler(async (req, res) => {
    await ownCourse(req.params.id, req.user!);
    const course = await prisma.course.update({ where: { id: req.params.id }, data: req.body });
    res.json({ course });
  })
);

courseRouter.post(
  "/:id/submit",
  authenticate,
  requireRole(Role.INSTRUCTOR),
  asyncHandler(async (req, res) => {
    await ownCourse(req.params.id, req.user!);
    const lessons = await prisma.lesson.findMany({
      where: { section: { courseId: req.params.id } },
      include: { videoAsset: true },
    });
    if (lessons.length === 0) throw new HttpError(400, "Add at least one lesson before submitting");
    const bad = lessons.find(
      (l) => l.type === LessonType.VIDEO && l.videoAsset?.status !== VideoStatus.READY
    );
    if (bad) throw new HttpError(400, `Lesson "${bad.title}" has no processed video yet`);

    const course = await prisma.course.update({
      where: { id: req.params.id },
      data: { status: CourseStatus.PENDING_REVIEW },
    });
    res.json({ course });
  })
);

/* ---------- Sections ---------- */
contentRouter.post(
  "/courses/:courseId/sections",
  authenticate,
  requireRole(Role.INSTRUCTOR),
  validate(z.object({ title: z.string().min(1) })),
  asyncHandler(async (req, res) => {
    const { courseId } = req.params;
    await ownCourse(courseId, req.user!);
    const last = await prisma.section.aggregate({ where: { courseId }, _max: { order: true } });
    const section = await prisma.section.create({
      data: { courseId, title: req.body.title, order: (last._max.order ?? 0) + 1 },
    });
    res.status(201).json({ section });
  })
);

contentRouter.patch(
  "/sections/:id",
  authenticate,
  requireRole(Role.INSTRUCTOR),
  validate(z.object({ title: z.string().min(1).optional(), order: z.number().int().min(1).optional() })),
  asyncHandler(async (req, res) => {
    await ownSection(req.params.id, req.user!);
    const section = await prisma.section.update({ where: { id: req.params.id }, data: req.body });
    res.json({ section });
  })
);

contentRouter.delete(
  "/sections/:id",
  authenticate,
  requireRole(Role.INSTRUCTOR),
  asyncHandler(async (req, res) => {
    await ownSection(req.params.id, req.user!);
    await prisma.section.delete({ where: { id: req.params.id } });
    res.status(204).end();
  })
);

/* ---------- Lessons ---------- */
contentRouter.post(
  "/sections/:sectionId/lessons",
  authenticate,
  requireRole(Role.INSTRUCTOR),
  validate(
    z.object({
      title: z.string().min(1),
      type: z.enum(["VIDEO", "TEXT"]).optional(),
      content: z.string().optional(),
    })
  ),
  asyncHandler(async (req, res) => {
    const { sectionId } = req.params;
    await ownSection(sectionId, req.user!);
    const last = await prisma.lesson.aggregate({ where: { sectionId }, _max: { order: true } });
    const lesson = await prisma.lesson.create({
      data: { ...req.body, sectionId, order: (last._max.order ?? 0) + 1 },
    });
    res.status(201).json({ lesson });
  })
);

contentRouter.patch(
  "/lessons/:id",
  authenticate,
  requireRole(Role.INSTRUCTOR),
  validate(
    z.object({
      title: z.string().min(1).optional(),
      order: z.number().int().min(1).optional(),
      content: z.string().optional(),
    })
  ),
  asyncHandler(async (req, res) => {
    await ownLesson(req.params.id, req.user!);
    const lesson = await prisma.lesson.update({ where: { id: req.params.id }, data: req.body });
    res.json({ lesson });
  })
);

contentRouter.delete(
  "/lessons/:id",
  authenticate,
  requireRole(Role.INSTRUCTOR),
  asyncHandler(async (req, res) => {
    await ownLesson(req.params.id, req.user!);
    await prisma.lesson.delete({ where: { id: req.params.id } });
    res.status(204).end();
  })
);