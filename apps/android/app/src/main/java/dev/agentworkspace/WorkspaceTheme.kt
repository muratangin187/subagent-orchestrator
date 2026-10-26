package dev.agentworkspace

import android.app.Activity
import android.content.SharedPreferences
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.core.view.WindowCompat

class AppearancePreferences(private val prefs: SharedPreferences) {
    var mode by mutableStateOf(prefs.getString("mode", "system")?.takeIf { it in listOf("system", "light", "dark") } ?: "system")
        private set
    var accent by mutableStateOf(prefs.getString("accent", "teal")?.takeIf { it in listOf("teal", "blue", "copper", "rose") } ?: "teal")
        private set
    fun chooseMode(value: String) { if (value !in listOf("system", "light", "dark")) return; mode = value; prefs.edit().putString("mode", value).apply() }
    fun chooseAccent(value: String) { if (value !in listOf("teal", "blue", "copper", "rose")) return; accent = value; prefs.edit().putString("accent", value).apply() }
}
val LocalAppearance = staticCompositionLocalOf<AppearancePreferences> { error("Appearance provider missing") }
private val WorkspaceFont = FontFamily(Font(R.font.ibm_plex_sans, FontWeight.Normal), Font(R.font.ibm_plex_sans, FontWeight.Medium), Font(R.font.ibm_plex_sans, FontWeight.SemiBold), Font(R.font.ibm_plex_sans, FontWeight.Bold))
private val BaseType = Typography()
private val WorkspaceType = Typography(
    displayLarge = BaseType.displayLarge.copy(fontFamily = WorkspaceFont),
    displayMedium = BaseType.displayMedium.copy(fontFamily = WorkspaceFont),
    displaySmall = BaseType.displaySmall.copy(fontFamily = WorkspaceFont),
    headlineLarge = BaseType.headlineLarge.copy(fontFamily = WorkspaceFont),
    headlineMedium = BaseType.headlineMedium.copy(fontFamily = WorkspaceFont),
    headlineSmall = BaseType.headlineSmall.copy(fontFamily = WorkspaceFont),
    titleLarge = BaseType.titleLarge.copy(fontFamily = WorkspaceFont),
    titleMedium = BaseType.titleMedium.copy(fontFamily = WorkspaceFont),
    titleSmall = BaseType.titleSmall.copy(fontFamily = WorkspaceFont),
    bodyLarge = BaseType.bodyLarge.copy(fontFamily = WorkspaceFont),
    bodyMedium = BaseType.bodyMedium.copy(fontFamily = WorkspaceFont),
    bodySmall = BaseType.bodySmall.copy(fontFamily = WorkspaceFont),
    labelLarge = BaseType.labelLarge.copy(fontFamily = WorkspaceFont),
    labelMedium = BaseType.labelMedium.copy(fontFamily = WorkspaceFont),
    labelSmall = BaseType.labelSmall.copy(fontFamily = WorkspaceFont),
 )
@Composable
fun WorkspaceTheme(content: @Composable () -> Unit) {
    val context = LocalContext.current
    val appearance = remember { AppearancePreferences(context.getSharedPreferences("appearance", 0)) }
    val dark = when (appearance.mode) { "light" -> false; "dark" -> true; else -> isSystemInDarkTheme() }
    val bg = if (dark) Color(0xff101213) else Color(0xfff4f5f6)
    val surface = if (dark) Color(0xff17181a) else Color(0xfffdfdfe)
    val raised = if (dark) Color(0xff222426) else Color(0xffeaebed)
    val fg = if (dark) Color(0xffe6e8ea) else Color(0xff1f2225)
    val muted = if (dark) Color(0xffa1a5a9) else Color(0xff5a5e63)
    val line = if (dark) Color(0xff3a3d41) else Color(0xffced1d4)
    val control = if (dark) Color(0xff777b7f) else Color(0xff7d8185)
    val error = if (dark) Color(0xfff4a19a) else Color(0xffa5292b)
    val accent = when (appearance.accent) {
        "teal" -> if (dark) Color(0xff71cbb9) else Color(0xff0c665a)
        "blue" -> if (dark) Color(0xff85bcf5) else Color(0xff0c60a3)
        "copper" -> if (dark) Color(0xfff4a988) else Color(0xff96461d)
        "rose" -> if (dark) Color(0xfff3a0ac) else Color(0xff9b3a4f)
        else -> fg
    }
    val base = if (dark) darkColorScheme() else lightColorScheme()
    val colors = base.copy(
        primary = accent, onPrimary = if (dark) bg else Color.White,
        primaryContainer = lerp(surface, accent, .12f), onPrimaryContainer = fg,
        secondary = muted, onSecondary = surface, secondaryContainer = raised, onSecondaryContainer = fg,
        tertiary = accent, onTertiary = bg, tertiaryContainer = raised, onTertiaryContainer = fg,
        background = bg, onBackground = fg, surface = surface, onSurface = fg,
        surfaceVariant = raised, onSurfaceVariant = muted, surfaceTint = Color.Transparent,
        surfaceDim = bg, surfaceBright = raised, surfaceContainerLowest = bg,
        surfaceContainerLow = surface, surfaceContainer = raised, surfaceContainerHigh = raised,
        surfaceContainerHighest = raised, outline = control, outlineVariant = line,
        error = error, onError = if (dark) bg else Color.White,
        errorContainer = lerp(surface, error, .12f), onErrorContainer = error,
        inverseSurface = fg, inverseOnSurface = surface, inversePrimary = accent,
    )
    SideEffect {
        (context as? Activity)?.window?.let { window ->
            WindowCompat.getInsetsController(window, window.decorView).apply {
                isAppearanceLightStatusBars = !dark
                isAppearanceLightNavigationBars = !dark
            }
        }
    }
    CompositionLocalProvider(LocalAppearance provides appearance) {
        MaterialTheme(colorScheme = colors, typography = WorkspaceType, shapes = Shapes(
            extraSmall = RoundedCornerShape(6.dp), small = RoundedCornerShape(6.dp),
            medium = RoundedCornerShape(12.dp), large = RoundedCornerShape(12.dp), extraLarge = RoundedCornerShape(12.dp)
        ), content = content)
    }
}
@Composable
fun AppearanceSettings() {
    val appearance = LocalAppearance.current
    Text("Görünüm", style = MaterialTheme.typography.titleLarge)
    Text("Tema", style = MaterialTheme.typography.labelLarge)
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        listOf("system" to "Sistem", "light" to "Açık", "dark" to "Koyu").forEach { (id, label) ->
            FilterChip(selected = appearance.mode == id, onClick = { appearance.chooseMode(id) }, label = { Text(label) }, modifier = Modifier.weight(1f).heightIn(min = 48.dp))
        }
    }
    Text("Vurgu rengi", style = MaterialTheme.typography.labelLarge)
    listOf(listOf("teal" to "Petrol", "blue" to "Mavi"), listOf("copper" to "Bakır", "rose" to "Gül")).forEach { row ->
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            row.forEach { (id, label) ->
                FilterChip(selected = appearance.accent == id, onClick = { appearance.chooseAccent(id) }, label = { Text(label) }, modifier = Modifier.weight(1f).heightIn(min = 48.dp))
            }
        }
    }
    Text("Bu cihazda kaydedilir. Sistem modu telefonunun görünümünü izler.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    HorizontalDivider()
}
