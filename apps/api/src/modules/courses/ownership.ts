import { prisma } from "@lms/db";
import { AuthUser } from "../../middleware/auth";
import { HttpError } from "../../middleware/error";

export async function ownCourse(courseId: string, user: AuthUser) {
  const course = await prisma.course.findUnique({ where: { id: courseId } });
  if (!course) throw new HttpError(404, "Course not found");
  if (course.instructorId !== user.id) throw new HttpError(403, "Not your course");
  return course;
}

export async function ownSection(sectionId: string, user: AuthUser) {
  const section = await prisma.section.findUnique({
    where: { id: sectionId },
    include: { course: true },
  });
  if (!section) throw new HttpError(404, "Section not found");
  if (section.course.instructorId !== user.id) throw new HttpError(403, "Not your course");
  return section;
}

export async function ownLesson(lessonId: string, user: AuthUser) {
  const lesson = await prisma.lesson.findUnique({
    where: { id: lessonId },
    include: { section: { include: { course: true } } },
  });
  if (!lesson) throw new HttpError(404, "Lesson not found");
  if (lesson.section.course.instructorId !== user.id) throw new HttpError(403, "Not your course");
  return lesson;
}