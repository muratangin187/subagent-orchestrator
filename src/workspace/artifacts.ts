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

export const artifactLimit = 512 * 1024 * 1024;
export const artifactChunk = 4 * 1024 * 1024;
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
export function readArtifact(link: string, root: string, offset = 0) {
  const path = artifactPath(link);
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
    if (stat.size > artifactLimit) throw Error("Dosya sınırı 512 MiB");
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > stat.size)
      throw Error("Invalid file offset");
    const bytes = Buffer.alloc(Math.min(artifactChunk, stat.size - offset));
    let size = 0;
    while (size < bytes.length) {
      const count = readSync(
        fd,
        bytes,
        size,
        bytes.length - size,
        offset + size,
      );
      if (!count) throw Error("File changed while reading");
      size += count;
    }
    return {
      name: basename(path),
      content: bytes.toString("base64"),
      size: stat.size,
      version: `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`,
      nextOffset: offset + size,
    };
  } catch (error: any) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR")
      return { missing: true as const };
    throw error;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}
