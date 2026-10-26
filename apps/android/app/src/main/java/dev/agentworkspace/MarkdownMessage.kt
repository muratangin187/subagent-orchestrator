package dev.agentworkspace

import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.widget.TextView
import android.widget.Toast
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.viewinterop.AndroidView
import io.noties.markwon.AbstractMarkwonPlugin
import io.noties.markwon.Markwon
import io.noties.markwon.MarkwonConfiguration
import io.noties.markwon.core.MarkwonTheme
import io.noties.markwon.ext.strikethrough.StrikethroughPlugin
import io.noties.markwon.ext.tables.TableAwareMovementMethod
import io.noties.markwon.ext.tables.TablePlugin
import io.noties.markwon.ext.tasklist.TaskListPlugin

/** Native spans: no WebView, executable HTML or automatic remote image fetching. */
@Composable
fun MarkdownMessage(markdown: String, onFileLink: (String) -> Unit = {}) {
    val context = LocalContext.current
    val currentFileLink = androidx.compose.runtime.rememberUpdatedState(onFileLink)
    val foreground = LocalContentColor.current.toArgb()
    val link = MaterialTheme.colorScheme.primary.toArgb()
    val codeBackground = MaterialTheme.colorScheme.surfaceVariant.toArgb()
    val density = LocalDensity.current
    val textSize = with(density) { MaterialTheme.typography.bodyLarge.fontSize.toPx() }
    val renderer =
        remember(context, link, codeBackground, foreground) {
            Markwon.builder(context)
                .usePlugin(StrikethroughPlugin.create())
                .usePlugin(TaskListPlugin.create(context))
                .usePlugin(TablePlugin.create(context))
                .usePlugin(
                    object : AbstractMarkwonPlugin() {
                        override fun configureTheme(builder: MarkwonTheme.Builder) {
                            builder
                                .linkColor(link)
                                .codeTextColor(foreground)
                                .codeBackgroundColor(codeBackground)
                                .codeBlockBackgroundColor(codeBackground)
                        }

                        override fun configureConfiguration(builder: MarkwonConfiguration.Builder) {
                            builder.linkResolver { view, destination ->
                                val uri = Uri.parse(destination)
                                if (destination.startsWith("/") || uri.scheme == "file") {
                                    currentFileLink.value(destination)
                                } else if (uri.scheme?.lowercase() in setOf("https", "http", "mailto")) {
                                    try {
                                        view.context.startActivity(Intent(Intent.ACTION_VIEW, uri))
                                    } catch (_: ActivityNotFoundException) {
                                        Toast.makeText(
                                                view.context,
                                                "Bu bağlantıyı açacak uygulama bulunamadı.",
                                                Toast.LENGTH_SHORT,
                                            )
                                            .show()
                                    }
                                } else {
                                    Toast.makeText(
                                            view.context,
                                            "Bilgisayar dosyası veya desteklenmeyen bağlantı: $destination",
                                            Toast.LENGTH_LONG,
                                        )
                                        .show()
                                }
                            }
                        }
                    }
                )
                .build()
        }
    // Polling updates do not reparse unchanged messages; partial streaming Markdown stays readable.
    val rendered = remember(renderer, markdown) { renderer.toMarkdown(markdown) }
    AndroidView(
        modifier = Modifier.fillMaxWidth(),
        factory = { ctx ->
            TextView(ctx).apply {
                setTextIsSelectable(true)
                movementMethod = TableAwareMovementMethod.create()
                includeFontPadding = false
                typeface = androidx.core.content.res.ResourcesCompat.getFont(ctx, R.font.ibm_plex_sans)
                setLineSpacing(0f, 1.2f)
                setPadding(0, 0, 0, 0)
            }
        },
        update = { view ->
            view.setTextColor(foreground)
            view.setLinkTextColor(link)
            view.setTextSize(android.util.TypedValue.COMPLEX_UNIT_PX, textSize)
            if (view.tag !== rendered) {
                renderer.setParsedMarkdown(view, rendered)
                view.tag = rendered
            }
        },
    )
}
