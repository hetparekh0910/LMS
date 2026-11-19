import fs from "fs";
import path from "path";

const API = process.env.API_URL ?? "http://localhost:4000";
const file = process.argv[2];
if (!file || !fs.existsSync(file)) {
  console.error('Usage: npm run smoke:part2 -w @lms/api -- "C:\\full\\path\\video.mp4"');
  process.exit(1);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function call(method: string, url: string, token?: string, body?: unknown) {
  const res = await fetch(API + url, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${url} -> ${res.status} ${JSON.stringify(json)}`);
  return json;
}

const login = async (email: string) =>
  (await call("POST", "/auth/login", undefined, { email, password: "Password123!" })).accessToken as string;

(async () => {
  const inst = await login("instructor@lms.test");
  const admin = await login("admin@lms.test");

  const { course } = await call("POST", "/courses", inst, {
    title: "Intro to Video Streaming",
    description: "Demo course created by the smoke test.",
    category: "Technology",
    price: 49900,
  });
  const { section } = await call("POST", `/courses/${course.id}/sections`, inst, { title: "Getting started" });
  const { lesson } = await call("POST", `/sections/${section.id}/lessons`, inst, { title: "Sample lesson" });
  console.log("Created course", course.id);

  const presign = await call("POST", "/videos/presign", inst, {
    filename: path.basename(file),
    contentType: "video/mp4",
  });
  console.log("Uploading to S3...");
  const put = await fetch(presign.uploadUrl, {
    method: "PUT",
    headers: presign.headers,
    body: fs.readFileSync(file),
  });
  if (!put.ok) throw new Error(`S3 upload failed: ${put.status} ${await put.text()}`);

  await call("POST", `/videos/${presign.assetId}/complete`, inst, { lessonId: lesson.id });
  console.log("Transcode job queued. Watching progress...");

  let status = "PROCESSING";
  while (status === "PROCESSING") {
    await sleep(3000);
    const { video } = await call("GET", `/videos/${presign.assetId}`, inst);
    status = video.status;
    console.log(`  ${status} ${video.progress}%`, video.errorMessage ?? "");
    if (status === "READY") console.log("  renditions:", video.renditions.join(", "), "| hls:", video.hlsKey);
  }
  if (status !== "READY") throw new Error("Transcoding did not finish: " + status);

  await call("POST", `/courses/${course.id}/submit`, inst);
  await call("POST", `/admin/courses/${course.id}/approve`, admin);
  const list = await call("GET", "/courses");
  console.log(`Course published. Public catalog now has ${list.total} course(s).`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});