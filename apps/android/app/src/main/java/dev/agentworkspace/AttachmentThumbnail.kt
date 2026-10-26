package dev.agentworkspace

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import java.io.ByteArrayOutputStream

/** Decode a sampled bitmap on the IO dispatcher, never a full-resolution camera image. */
fun attachmentThumbnail(bytes: ByteArray, name: String): ByteArray? {
    if (!Regex("\\.(png|jpe?g|webp)$", RegexOption.IGNORE_CASE).containsMatchIn(name)) return null
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
    if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null
    var sample = 1
    while (maxOf(bounds.outWidth, bounds.outHeight) / sample > 256) sample *= 2
    val bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply { inSampleSize = sample }) ?: return null
    return try { ByteArrayOutputStream().use { out -> bitmap.compress(Bitmap.CompressFormat.PNG, 100, out); out.toByteArray() } }
    finally { bitmap.recycle() }
}
