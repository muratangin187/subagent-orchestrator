package dev.agentworkspace

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import com.google.firebase.FirebaseApp
import com.google.firebase.messaging.FirebaseMessaging
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

object WorkspacePush {
    const val CHANNEL = "workspace_updates"

    fun prepare(context: Context) {
        context
            .getSystemService(NotificationManager::class.java)
            .createNotificationChannel(
                NotificationChannel(
                    CHANNEL,
                    "Asistan güncellemeleri",
                    NotificationManager.IMPORTANCE_DEFAULT,
                )
            )
        if (FirebaseApp.initializeApp(context) == null) return
        FirebaseMessaging.getInstance().isAutoInitEnabled = true
        FirebaseMessaging.getInstance().token.addOnSuccessListener { token ->
            context
                .getSharedPreferences("push", Context.MODE_PRIVATE)
                .edit()
                .putString("token", token)
                .apply()
        }
    }

    // Run on IO during normal sync. A rotated token retries whenever the app reconnects.
    fun register(context: Context, repo: Repository) {
        val prefs = context.getSharedPreferences("push", Context.MODE_PRIVATE)
        val token = prefs.getString("token", null) ?: return
        val registered = prefs.getString("registered", null)
        val key = repo.vault.url + ":" + token
        if (registered == key) return
        repo.request("/v1/push/register", org.json.JSONObject().put("token", token))
        prefs.edit().putString("registered", key).apply()
    }
}

class WorkspaceMessagingService : FirebaseMessagingService() {
    override fun onNewToken(token: String) {
        getSharedPreferences("push", MODE_PRIVATE)
            .edit()
            .putString("token", token)
            .remove("registered")
            .apply()
    }

    override fun onMessageReceived(message: RemoteMessage) {
        if (
            Build.VERSION.SDK_INT >= 33 &&
                checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) !=
                    PackageManager.PERMISSION_GRANTED
        )
            return
        val intent =
            Intent(this, MainActivity::class.java).putExtra("eventId", message.data["eventId"])
        val pending =
            PendingIntent.getActivity(
                this,
                0,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
        // Do not display arbitrary remote text; our fixed copy keeps lock-screen contents private.
        val notification =
            NotificationCompat.Builder(this, WorkspacePush.CHANNEL)
                .setSmallIcon(android.R.drawable.ic_dialog_info)
                .setContentTitle("Agent Workspace")
                .setContentText("Asistanında yeni bir güncelleme var.")
                .setContentIntent(pending)
                .setAutoCancel(true)
                .setOnlyAlertOnce(true)
                .build()
        getSystemService(NotificationManager::class.java)
            .notify("workspace-update", 1, notification)
    }
}
