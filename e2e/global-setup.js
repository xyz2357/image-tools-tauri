import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

export default async function globalSetup() {
  const r = spawnSync(
    "cargo",
    ["build", "--release", "--manifest-path", path.join(projectRoot, "src-tauri", "Cargo.toml")],
    { stdio: "inherit", shell: process.platform === "win32" },
  );
  if (r.status !== 0) throw new Error("cargo build --release failed");
}
