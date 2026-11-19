import { spawn } from "child_process";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { prisma, VideoStatus } from "@lms/db";
import { downloadTo, uploadDir } from "./s3";

const LADDER = [
  { name: "360p", height: 360, vKbps: 800, bandwidth: 928_000 },
  { name: "720p", height: 720, vKbps: 2800, bandwidth: 2_928_000 },
  { name: "1080p", height: 1080, vKbps: 5000, bandwidth: 5_128_000 },
];

function run(
  cmd: string,
  args: string[],
  opts: { cwd?: string; onLine?: (line: string) => void } = {}
): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd: opts.cwd, windowsHide: true });
    let out = "";
    let err = "";
    p.stdout.on("data", (d) => {
      const s = d.toString();
      if (opts.onLine) s.split(/\r?\n/).forEach((l: string) => l && opts.onLine!(l));
      else out += s;
    });
    p.stderr.on("data", (d) => {
      err = (err + d.toString()).slice(-4000);
    });
    p.on("error", reject);
    p.on("close", (code) =>
      code === 0 ? resolve(out) : reject(new Error(`${cmd} exited with ${code}: ${err.slice(-1200)}`))
    );
  });
}

async function probe(file: string) {
  const out = await run("ffprobe", [
    "-v", "error",
    "-select_streams", "v:0",
    "-show_entries", "stream=width,height:format=duration",
    "-of", "json",
    file,
  ]);
  const j = JSON.parse(out);
  return {
    width: Number(j.streams[0].width),
    height: Number(j.streams[0].height),
    duration: Number(j.format.duration),
  };
}

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

export async function transcode(assetId: string, reportQueueProgress?: (p: number) => void) {
  const started = Date.now();
  const asset = await prisma.videoAsset.findUniqueOrThrow({ where: { id: assetId } });
  await prisma.videoAsset.update({
    where: { id: assetId },
    data: { status: VideoStatus.PROCESSING, progress: 0, errorMessage: null },
  });

  const work = await fs.mkdtemp(path.join(os.tmpdir(), `lms-${assetId}-`));
  let lastSaved = 0;
  const setProgress = async (p: number) => {
    const value = Math.min(99, Math.floor(p));
    if (value >= lastSaved + 3) {
      lastSaved = value;
      reportQueueProgress?.(value);
      await prisma.videoAsset.update({ where: { id: assetId }, data: { progress: value } });
    }
  };

  try {
    // 1) download source
    const input = path.join(work, "source" + path.extname(asset.rawKey));
    await downloadTo(asset.rawKey, input);
    const src = await probe(input);
    await setProgress(4);

    // 2) encode each rendition (never upscale; always at least 360p)
    const outDir = path.join(work, "hls");
    const chosen = LADDER.filter((r, i) => i === 0 || r.height <= src.height);
    const span = 85 / chosen.length;

    for (let i = 0; i < chosen.length; i++) {
      const r = chosen[i];
      const dir = path.join(outDir, r.name);
      await fs.mkdir(dir, { recursive: true });

      const args = [
        "-y", "-i", input,
        "-map", "0:v:0", "-map", "0:a:0?",
        "-vf", `scale=-2:${r.height}`,
        "-c:v", "libx264", "-preset", "veryfast", "-profile:v", "main", "-crf", "23",
        "-maxrate", `${r.vKbps}k`, "-bufsize", `${r.vKbps * 2}k`,
        "-sc_threshold", "0",
        "-force_key_frames", "expr:gte(t,n_forced*6)",
        "-c:a", "aac", "-b:a", "128k", "-ac", "2",
        "-f", "hls", "-hls_time", "6", "-hls_playlist_type", "vod",
        "-hls_segment_filename", "seg_%04d.ts",
        "-progress", "pipe:1", "-nostats",
        "index.m3u8",
      ];

      await run("ffmpeg", args, {
        cwd: dir, // relative output names keep playlist entries clean on Windows
        onLine: (line) => {
          const m = line.match(/^out_time_(?:us|ms)=(\d+)/);
          if (m && src.duration > 0) {
            const frac = Math.min(1, Number(m[1]) / 1e6 / src.duration);
            void setProgress(4 + i * span + frac * span);
          }
        },
      });
    }

    // 3) master playlist
    const master = [
      "#EXTM3U",
      "#EXT-X-VERSION:3",
      ...chosen.flatMap((r) => [
        `#EXT-X-STREAM-INF:BANDWIDTH=${r.bandwidth},RESOLUTION=${even((r.height * src.width) / src.height)}x${r.height}`,
        `${r.name}/index.m3u8`,
      ]),
    ].join("\n");
    await fs.writeFile(path.join(outDir, "master.m3u8"), master + "\n");

    // 4) thumbnail
    await run("ffmpeg", [
      "-y", "-ss", String(Math.min(5, src.duration / 2)), "-i", input,
      "-frames:v", "1", "-vf", "scale=640:-2",
      path.join(outDir, "thumb.jpg"),
    ]);

    // 5) upload results
    await setProgress(90);
    await uploadDir(outDir, `hls/${assetId}`);

    const durationSec = Math.round(src.duration);
    await prisma.videoAsset.update({
      where: { id: assetId },
      data: {
        status: VideoStatus.READY,
        progress: 100,
        hlsKey: `hls/${assetId}/master.m3u8`,
        thumbnailKey: `hls/${assetId}/thumb.jpg`,
        renditions: chosen.map((r) => r.name),
        durationSec,
      },
    });
    await prisma.lesson.updateMany({ where: { videoAssetId: assetId }, data: { durationSec } });

    const elapsed = (Date.now() - started) / 1000;
    console.log(
      `[transcode] ${assetId} READY | ${durationSec}s video -> ${elapsed.toFixed(1)}s ` +
        `(${(elapsed / Math.max(1, durationSec)).toFixed(2)}x realtime) | ${chosen.map((r) => r.name).join(", ")}`
    );
  } finally {
    await fs.rm(work, { recursive: true, force: true });
  }
}