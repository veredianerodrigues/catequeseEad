import { execFileSync } from "node:child_process";
import path from "node:path";

export default function setup() {
  const url = process.env.TEST_DATABASE_URL ?? "mysql://root:root@localhost:3307/quiz_test";
  process.env.TEST_DATABASE_URL = url;
  const prisma = path.resolve(__dirname, "../node_modules/prisma/build/index.js");
  execFileSync(process.execPath, [prisma, "migrate", "deploy"], {
    cwd: path.resolve(__dirname, ".."),
    env: { ...process.env, DATABASE_URL: url },
    stdio: "inherit",
  });
}
