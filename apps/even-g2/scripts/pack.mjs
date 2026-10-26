import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const origin = new URL(process.argv[2] ?? "");
if (
  origin.protocol !== "https:" ||
  origin.username ||
  origin.password ||
  origin.search ||
  origin.hash ||
  origin.pathname !== "/"
)
  throw Error("Pass your HTTPS server origin without credentials or path.");
const manifest = JSON.parse(readFileSync(resolve(root, "app.json"), "utf8"));
manifest.permissions.find((p) => p.name === "network").whitelist = [
  origin.origin,
];
const local = resolve(root, ".local");
mkdirSync(local, { recursive: true });
const file = resolve(local, "app.json");
writeFileSync(file, JSON.stringify(manifest, null, 2));
execFileSync("npm", ["run", "build"], { cwd: root, stdio: "inherit" });
execFileSync(
  resolve(root, "node_modules/.bin/evenhub"),
  [
    "pack",
    file,
    resolve(root, "dist"),
    "--sdk-ver",
    "0.0.16",
    "-o",
    resolve(local, "agent-workspace.ehpk"),
  ],
  { cwd: root, stdio: "inherit" },
);
