import { randomUUID } from "crypto";
import path from "path";
import { Router } from "express";
import { z } from "zod";
import { prisma, Role, VideoStatus } from "@lms/db";
import { authenticate, requireRole } from "../../middleware/auth";
import { asyncHandler, HttpError, validate } from "../../middleware/error";
import { objectExists, presignUpload } from "../../lib/s3";
import { transcodeQueue } from "../../queue";
import { ownLesson } from "../courses/ownership";

export const videoRouter = Router(); // mounted at /videos
videoRouter.use(authenticate, requireRole(Role.INSTRUCTOR));

async function ownAsset(id: string, userId: string) {
  const asset = await prisma.videoAsset.findUnique({ where: { id } });
  if (!asset) throw new HttpError(404, "Video not found");
  if (asset.ownerId !== userId) throw new HttpError(403, "Not your video");
  return asset;
}

// 1) Browser asks for an upload URL, then PUTs the file straight to S3
videoRouter.post(
  "/presign",
  validate(
    z.object({
      filename: z.string().min(1).max(200),
      contentType: z.string().refine((t) => t.startsWith("video/"), "Must be a video type"),
    })
  ),
  asyncHandler(async (req, res) => {
    const id = randomUUID();
    const ext = path.extname(req.body.filename).toLowerCase().replace(/[^.a-z0-9]/g, "") || ".mp4";
    const rawKey = `raw/${id}/source${ext}`;

    await prisma.videoAsset.create({
      data: { id, ownerId: req.user!.id, originalName: req.body.filename, rawKey },
    });
    const uploadUrl = await presignUpload(rawKey, req.body.contentType);
    res.status(201).json({
      assetId: id,
      uploadUrl,
      headers: { "Content-Type": req.body.contentType },
    });
  })
);

// 2) After the upload finishes, enqueue the transcode job
videoRouter.post(
  "/:id/complete",
  validate(z.object({ lessonId: z.string().optional() })),
  asyncHandler(async (req, res) => {
    const asset = await ownAsset(req.params.id, req.user!.id);
    if (asset.status === VideoStatus.PROCESSING || asset.status === VideoStatus.READY) {
      throw new HttpError(409, `Video is already ${asset.status}`);
    }
    if (!(await objectExists(asset.rawKey))) {
      throw new HttpError(400, "Upload not found in S3 yet");
    }
    if (req.body.lessonId) {
      const lesson = await ownLesson(req.body.lessonId, req.user!);
      await prisma.lesson.update({ where: { id: lesson.id }, data: { videoAssetId: asset.id } });
    }

    await prisma.videoAsset.update({
      where: { id: asset.id },
      data: { status: VideoStatus.PROCESSING, progress: 0, errorMessage: null },
    });
    await transcodeQueue().add(
      "transcode",
      { assetId: asset.id },
      { jobId: `${asset.id}-${Date.now()}` }
    );
    res.status(202).json({ assetId: asset.id, status: VideoStatus.PROCESSING });
  })
);

// 3) UI polls this for the progress bar
videoRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const video = await ownAsset(req.params.id, req.user!.id);
    res.json({ video });
  })
);