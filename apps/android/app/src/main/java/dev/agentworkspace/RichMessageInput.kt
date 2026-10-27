package dev.agentworkspace

import android.net.Uri
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.border
import androidx.compose.foundation.content.ReceiveContentListener
import androidx.compose.foundation.content.consume
import androidx.compose.foundation.content.contentReceiver
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.input.TextFieldLineLimits
import androidx.compose.foundation.text.input.rememberTextFieldState
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.unit.dp
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.contentDescription
import kotlinx.coroutines.flow.distinctUntilChanged

/** State-based input supports Android clipboard, keyboard media and cross-app drops. */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun RichMessageInput(value: String, onValueChange: (String) -> Unit, onFile: (Uri) -> Unit, modifier: Modifier = Modifier) {
    val state = rememberTextFieldState(initialText = value)
    val change by rememberUpdatedState(onValueChange)
    val attach by rememberUpdatedState(onFile)
    LaunchedEffect(value) {
        if (state.text.toString() != value) state.edit { replace(0, length, value) }
    }
    LaunchedEffect(state) { snapshotFlow { state.text.toString() }.distinctUntilChanged().collect { change(it) } }
    val receiver = remember {
        ReceiveContentListener { content ->
            content.consume { item ->
                val uri = item.uri
                if (uri?.scheme == "content") { attach(uri); true } else false
            }
        }
    }
    BasicTextField(
        state = state,
        modifier = modifier.semantics { contentDescription = "Mesaj" }.contentReceiver(receiver).heightIn(min = 56.dp)
            .padding(horizontal = 12.dp, vertical = 10.dp),
        textStyle = MaterialTheme.typography.bodyLarge.copy(color = MaterialTheme.colorScheme.onSurface),
        cursorBrush = SolidColor(MaterialTheme.colorScheme.primary),
        lineLimits = TextFieldLineLimits.MultiLine(maxHeightInLines = 5),
        decorator = { inner ->
            Box { if (state.text.isEmpty()) Text("Mesajını yaz…", color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodyLarge); inner() }
        },
    )
}
