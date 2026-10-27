package dev.agentworkspace

import android.os.Bundle
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.pdf.PdfDocument
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import java.io.File

/** Debug-only, local fixtures. No WorkspaceModel, connection vault or network transport. */
class ViewerQaActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Refuse to run in a build that shares the personal app's data directory.
        check(packageName.endsWith(".qa")) { "Build with -PisolatedQa=true -PwithFirebase=false" }
        val dir = File(cacheDir, "attachments").apply { mkdirs() }
        val pdf = File(dir, "iki-sayfa.pdf")
        val doc = PdfDocument()
        try {
            repeat(2) { i ->
                val page = doc.startPage(PdfDocument.PageInfo.Builder(300, 400, i + 1).create())
                page.canvas.drawText("QA page ${i + 1}", 30f, 60f, Paint().apply { textSize = 24f; color = Color.BLACK })
                doc.finishPage(page)
            }
            pdf.outputStream().use(doc::writeTo)
        } finally { doc.close() }
        val image = File(dir, "gorsel.png")
        val bitmap = Bitmap.createBitmap(400, 300, Bitmap.Config.ARGB_8888)
        Canvas(bitmap).apply { drawColor(Color.rgb(35, 110, 100)); drawText("Viewer QA", 50f, 150f, Paint().apply { color = Color.WHITE; textSize = 40f }) }
        image.outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }; bitmap.recycle()
        val fixtures = listOf(
            pdf, image,
            File(dir, "inceleme.md").apply { writeText("# İnceleme\n\n**Yerel QA verisi.**\n\n- Birinci madde\n- İkinci madde\n\n| Durum | Sonuç |\n|---|---|\n| QA | Tamam |") },
            File(dir, "rapor.html").apply { writeText("<!doctype html><meta name='viewport' content='width=device-width'><style>body{font:18px system-ui;padding:20px}button{padding:14px}</style><h1>Yerel rapor</h1><button onclick=\"document.querySelector('p').textContent='Filtre uygulandı'\">Filtrele</button><p>İki sonuç</p>") },
            File(dir, "uzun-metin.txt").apply { writeText((1..150).joinToString("\n") { "Satır $it: Yerel görüntüleyici kontrolü." }) },
            File(dir, "bozuk.pdf").apply { writeText("invalid pdf") },
            File(dir, "bozuk.png").apply { writeText("invalid image") },
        )
        setContent {
            WorkspaceTheme {
                var selected by remember { mutableStateOf<File?>(null) }
                Surface(Modifier.fillMaxSize()) {
                    Column(Modifier.safeDrawingPadding().verticalScroll(rememberScrollState()).padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        Text("Dosya görüntüleyici QA", style = MaterialTheme.typography.headlineSmall)
                        Text("Yalnızca yerel örnekler. Kişisel bağlantı kullanılmaz.")
                        fixtures.forEach { file -> OutlinedButton(onClick = { selected = file }, modifier = Modifier.fillMaxWidth()) { Text(file.name) } }
                        WorkActivityGroup(WorkActivityRun("qa", state = "completed", end = 1, items = listOf(WorkActivityItem("tool", title = "Dosya kontrolü", state = "completed", output = "Yerel örnek tamamlandı."))))
                    }
                }
                selected?.let { file -> AttachmentViewer(AttachmentPreview(file.name, file), onClose = { selected = null }) }
            }
        }
    }
}
