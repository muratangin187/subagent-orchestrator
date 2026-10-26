export const MAX_ATTACHMENTS = 5;
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
const extensions =
  /\.(txt|md|json|csv|log|ts|js|py|html?|pdf|png|jpe?g|webp)$/i;
export function transferredFiles(transfer) {
  if (!transfer) return [];
  const files = Array.from(transfer.files || []);
  if (files.length) return files;
  return Array.from(transfer.items || [])
    .filter((item) => item.kind === "file")
    .map((item) => item.getAsFile())
    .filter(Boolean);
}
export function attachmentName(file) {
  if (extensions.test(file.name)) return file.name;
  const extension = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
  }[file.type];
  if (extension) return `image-${Date.now()}.${extension}`;
  throw Error(`${file.name || "Dosya"}: desteklenmeyen dosya türü.`);
}
export function validateAttachments(files, existingCount) {
  if (existingCount + files.length > MAX_ATTACHMENTS)
    throw Error("En fazla 5 dosya ekleyebilirsin.");
  return files.map((file) => {
    if (file.size > MAX_ATTACHMENT_BYTES)
      throw Error(`${file.name}: en fazla 5 MiB.`);
    if (!file.size) throw Error(`${file.name}: dosya boş.`);
    return attachmentName(file);
  });
}
export async function imageThumbnail(file) {
  if (
    !/^image\/(png|jpeg|webp)$/.test(file.type) &&
    !/\.(png|jpe?g|webp)$/i.test(file.name)
  )
    return undefined;
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 192 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) return undefined;
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/png");
  } catch {
    return undefined;
  } finally {
    bitmap?.close();
  }
}
