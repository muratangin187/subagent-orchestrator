import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";
const origin = new URL(process.argv[2] ?? "");
if (
  origin.protocol !== "https:" ||
  origin.username ||
  origin.password ||
  origin.search ||
  origin.hash ||
  origin.pathname !== "/"
)
  throw Error("Pass a clean HTTPS origin.");
const state =
  process.argv[3] ?? resolve(homedir(), ".local/share/agent-workspace");
const out = resolve(".local/even-connection.json");
mkdirSync(".local", { recursive: true, mode: 0o700 });
const token = readFileSync(resolve(state, "device-secret"), "utf8").trim();
if (!/^[a-f0-9]{64}$/.test(token)) throw Error("Invalid local device token");
writeFileSync(out, JSON.stringify({ origin: origin.origin, token }), {
  mode: 0o600,
});
console.log(
  "Private pairing file written: " +
    out +
    "\nImport only into your own workspace app. Never upload it to Even Hub or GitHub.",
);
