import {
  openSync,
  closeSync,
  fstatSync,
  readSync,
  realpathSync,
  constants,
} from "node:fs";
import { basename, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const artifactLimit = 5 * 1024 * 1024;
export function artifactPath(link: string): string {
  if (link.length > 4096 || /[\x00-\x1f]/.test(link))
    throw Error("Invalid file link");
  const path = link.startsWith("file:")
    ? fileURLToPath(link)
    : decodeURIComponent(link);
  if (!isAbsolute(path) || path.startsWith("//"))
    throw Error("An absolute file path is required");
  return resolve(path);
}
/** Only regular, bounded files inside the configured device workspace are exposed. */
export function readArtifact(link: string, root: string) {
  const path = artifactPath(link);
  const extensions =
    /\.(html?|pdf|png|jpe?g|webp|gif|txt|md|json|csv|log|ts|tsx|js|jsx|py|css|yaml|yml|xml)$/i;
  if (!extensions.test(path)) throw Error("Unsupported file type");
  const within = (candidate: string, base: string) => {
    const rel = relative(base, candidate);
    return rel !== ".." && !rel.startsWith("../") && !isAbsolute(rel);
  };
  if (!within(path, resolve(root))) return { missing: true as const };
  // Do not export hidden configuration, credentials or symlink escapes.
  if (
    relative(resolve(root), path)
      .split("/")
      .some((p) => p.startsWith("."))
  )
    throw Error("Hidden files cannot be previewed");
  let fd: number | undefined;
  try {
    const canonical = realpathSync(path);
    if (
      relative(realpathSync(root), canonical)
        .split("/")
        .some((p) => p.startsWith("."))
    )
      throw Error("Hidden files cannot be previewed");
    if (!within(canonical, realpathSync(root)))
      throw Error("File is outside the device workspace");
    fd = openSync(
      path,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    const stat = fstatSync(fd);
    if (!stat.isFile()) throw Error("Not a regular file");
    if (stat.size > artifactLimit) throw Error("Dosya sınırı 5 MiB");
    const bytes = Buffer.alloc(artifactLimit + 1);
    let size = 0,
      count = 0;
    do {
      count = readSync(fd, bytes, size, bytes.length - size, null);
      size += count;
    } while (count && size < bytes.length);
    if (size > artifactLimit) throw Error("Dosya sınırı 5 MiB");
    return {
      name: basename(path),
      content: bytes.subarray(0, size).toString("base64"),
    };
  } catch (error: any) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR")
      return { missing: true as const };
    throw error;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}
