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
import androidx.work.*
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
        val eventId = message.data["eventId"]?.takeIf { it.matches(Regex("[0-9]{1,16}")) } ?: return
        WorkspaceNotifications.show(this, eventId)
        // FCM only wakes the app. Fetch private text directly from the paired coordinator.
        val work = OneTimeWorkRequestBuilder<NotificationPreviewWorker>()
            .setInputData(workDataOf("eventId" to eventId))
            .apply { if (Build.VERSION.SDK_INT >= 31) setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST) }
            .build()
        WorkManager.getInstance(this).enqueueUniqueWork(
            "notification-$eventId", ExistingWorkPolicy.KEEP, work,
        )
    }
}

object WorkspaceNotifications {
    fun show(context: Context, eventId: String, title: String = "Agent Workspace", body: String = "Asistanında yeni bir güncelleme var.") {
        if (Build.VERSION.SDK_INT >= 33 && context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return
        val manager = context.getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(NotificationChannel(WorkspacePush.CHANNEL, "Asistan güncellemeleri", NotificationManager.IMPORTANCE_DEFAULT))
        val intent = Intent(context, MainActivity::class.java)
            .setAction("workspace-notification-$eventId")
            .putExtra("eventId", eventId)
        val pending = PendingIntent.getActivity(context, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val publicVersion = NotificationCompat.Builder(context, WorkspacePush.CHANNEL)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle("Agent Workspace")
            .setContentText("Yeni bir mesajın var.").build()
        val notification = NotificationCompat.Builder(context, WorkspacePush.CHANNEL)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setPublicVersion(publicVersion)
            .setContentIntent(pending)
            .setAutoCancel(true)
            .setOnlyAlertOnce(true)
            .build()
        manager.notify("workspace-$eventId", 1, notification)
    }
}

class NotificationPreviewWorker(context: Context, params: WorkerParameters) : Worker(context, params) {
    override fun doWork(): Result {
        val eventId = inputData.getString("eventId") ?: return Result.failure()
        if (!eventId.matches(Regex("[0-9]{1,16}"))) return Result.failure()
        val manager = applicationContext.getSystemService(NotificationManager::class.java)
        // Do not resurrect a notification the user has already opened or dismissed.
        if (manager.activeNotifications.none { it.tag == "workspace-$eventId" }) return Result.success()
        val repo = Repository(applicationContext)
        return try {
            val preview = repo.request("/v1/notifications?eventId=$eventId")
            if (manager.activeNotifications.any { it.tag == "workspace-$eventId" }) {
                WorkspaceNotifications.show(applicationContext, eventId, preview.getString("title"), preview.getString("body"))
            }
            Result.success()
        } catch (_: Exception) {
            if (runAttemptCount < 2) Result.retry() else Result.failure()
        } finally {
            repo.local.close()
        }
    }
}
