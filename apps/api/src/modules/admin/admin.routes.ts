import { Router } from "express";
import { CourseStatus, prisma, Role } from "@lms/db";
import { authenticate, requireRole } from "../../middleware/auth";
import { asyncHandler, HttpError } from "../../middleware/error";

export const adminRouter = Router(); // mounted at /admin
adminRouter.use(authenticate, requireRole(Role.ADMIN));

adminRouter.get(
  "/courses",
  asyncHandler(async (req, res) => {
    const status = req.query.status as CourseStatus | undefined;
    const valid = status && Object.values(CourseStatus).includes(status);
    const courses = await prisma.course.findMany({
      where: valid ? { status } : {},
      orderBy: { updatedAt: "desc" },
      include: { instructor: { select: { id: true, name: true, email: true } } },
    });
    res.json({ courses });
  })
);

adminRouter.post(
  "/courses/:id/approve",
  asyncHandler(async (req, res) => {
    const course = await prisma.course.findUnique({ where: { id: req.params.id } });
    if (!course) throw new HttpError(404, "Course not found");
    if (course.status !== CourseStatus.PENDING_REVIEW) {
      throw new HttpError(409, "Only courses pending review can be approved");
    }
    const updated = await prisma.course.update({
      where: { id: course.id },
      data: { status: CourseStatus.PUBLISHED },
    });
    res.json({ course: updated });
  })
);

adminRouter.post(
  "/courses/:id/unpublish",
  asyncHandler(async (req, res) => {
    const course = await prisma.course.findUnique({ where: { id: req.params.id } });
    if (!course) throw new HttpError(404, "Course not found");
    const updated = await prisma.course.update({
      where: { id: course.id },
      data: { status: CourseStatus.UNPUBLISHED },
    });
    res.json({ course: updated });
  })
);