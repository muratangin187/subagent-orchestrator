package dev.agentworkspace

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import java.util.concurrent.TimeUnit
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject

class LocalStore(context: Context) : SQLiteOpenHelper(context, "workspace.db", null, 1) {
    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL("CREATE TABLE cache(k TEXT PRIMARY KEY,v TEXT NOT NULL)")
        db.execSQL(
            "CREATE TABLE outbox(id TEXT PRIMARY KEY,path TEXT NOT NULL,body TEXT NOT NULL,state TEXT NOT NULL)"
        )
    }

    override fun onUpgrade(db: SQLiteDatabase, old: Int, new: Int) = Unit

    fun get(key: String): String? =
        readableDatabase.rawQuery("SELECT v FROM cache WHERE k=?", arrayOf(key)).use {
            if (it.moveToFirst()) it.getString(0) else null
        }

    fun put(key: String, value: String) {
        writableDatabase.execSQL("INSERT OR REPLACE INTO cache VALUES(?,?)", arrayOf(key, value))
    }

    fun enqueue(id: String, path: String, body: String) {
        writableDatabase.execSQL(
            "INSERT OR IGNORE INTO outbox VALUES(?,?,?,'pending')",
            arrayOf(id, path, body),
        )
    }

    fun pending(): List<Triple<String, String, String>> =
        readableDatabase
            .rawQuery("SELECT id,path,body FROM outbox WHERE state='pending' ORDER BY rowid", null)
            .use { c ->
                buildList {
                    while (c.moveToNext()) add(
                        Triple(c.getString(0), c.getString(1), c.getString(2))
                    )
                }
            }

    fun failed(id: String) {
        writableDatabase.execSQL("UPDATE outbox SET state='failed' WHERE id=?", arrayOf(id))
    }

    fun failures(): List<Pair<String, String>> =
        readableDatabase
            .rawQuery("SELECT id,body FROM outbox WHERE state='failed' ORDER BY rowid", null)
            .use { c ->
                buildList {
                    while (c.moveToNext()) add(
                        c.getString(0) to JSONObject(c.getString(1)).optString("text")
                    )
                }
            }

    fun done(id: String) {
        writableDatabase.execSQL("DELETE FROM outbox WHERE id=?", arrayOf(id))
    }
}

class Vault(context: Context) {
    private val prefs = context.getSharedPreferences("connection", Context.MODE_PRIVATE)
    var url: String
        get() = prefs.getString("url", "")!!
        set(v) {
            prefs.edit().putString("url", v).apply()
        }

    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey("workspace", null) as? SecretKey)?.let {
            return it
        }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
            .apply {
                init(
                    KeyGenParameterSpec.Builder(
                            "workspace",
                            KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
                        )
                        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                        .build()
                )
            }
            .generateKey()
    }

    fun token(): String? =
        try {
            prefs.getString("token", null)?.let {
                val parts = it.split(":")
                val c = Cipher.getInstance("AES/GCM/NoPadding")
                c.init(
                    Cipher.DECRYPT_MODE,
                    key(),
                    GCMParameterSpec(128, Base64.decode(parts[0], 0)),
                )
                String(c.doFinal(Base64.decode(parts[1], 0)))
            }
        } catch (_: Exception) {
            null
        }

    fun save(token: String) {
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        c.init(Cipher.ENCRYPT_MODE, key())
        prefs
            .edit()
            .putString(
                "token",
                Base64.encodeToString(c.iv, 2) +
                    ":" +
                    Base64.encodeToString(c.doFinal(token.toByteArray()), 2),
            )
            .apply()
    }
}

class ApiError(val status: Int, message: String) : Exception(message)

class Repository(context: Context) {
    val local = LocalStore(context)
    val vault = Vault(context)
    private val http =
        OkHttpClient.Builder()
            .connectTimeout(8, TimeUnit.SECONDS)
            .readTimeout(45, TimeUnit.SECONDS)
            .build()

    fun request(path: String, body: JSONObject? = null, auth: Boolean = true): JSONObject {
        require(vault.url.startsWith("https://")) { "HTTPS Tailscale adresi gerekli" }
        val builder = Request.Builder().url(vault.url.trimEnd('/') + path)
        if (auth) builder.header("Authorization", "Bearer " + (vault.token() ?: ""))
        if (body != null)
            builder.post(body.toString().toRequestBody("application/json".toMediaType()))
        http.newCall(builder.build()).execute().use { r ->
            val value = JSONObject(r.body?.string() ?: "{}")
            if (!r.isSuccessful) throw ApiError(r.code, value.optString("error", "Bağlantı hatası"))
            return value
        }
    }

    fun pair(url: String, code: String) {
        vault.url = url.trim().trimEnd('/')
        vault.save(
            request("/v1/pair", JSONObject().put("code", code.trim()), false).getString("token")
        )
    }
}
