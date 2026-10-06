package com.athleteos.sync.data.remote

import android.os.Build
import android.content.Context
import com.athleteos.sync.BuildConfig
import com.athleteos.sync.domain.repository.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.withContext
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody

class SupabaseUploadClient(context: Context, private val auth: SupabaseAuth, private val http: OkHttpClient, private val deviceUid: String) : UploadClient {
    private val preferences = context.getSharedPreferences("server_diagnostics", Context.MODE_PRIVATE)
    val lastServerResult = MutableStateFlow(preferences.getString("last_result", "NOT_CONTACTED") ?: "NOT_CONTACTED")
    private fun result(code: String) {
        lastServerResult.value = code
        preferences.edit().putString("last_result", code).apply()
    }
    private val json = Json { encodeDefaults = true }

    override suspend fun upload(user: String, batch: List<QueuedRecord>, runs: List<SyncRun>) {
        require(batch.size <= 500 && runs.size <= 100)
        // Bound both record count and bytes. Retry of an already accepted sub-batch is idempotent.
        val records = batch.map { item -> buildJsonObject {
            json.encodeToJsonElement(item.record).jsonObject.forEach { (key, value) -> put(key, value) }
            put("client_revision", item.revision)
            put("observed_at", item.observedAt)
        } }
        val chunks = mutableListOf<List<JsonObject>>()
        var current = mutableListOf<JsonObject>()
        var size = 0
        for (record in records) {
            val bytes = record.toString().toByteArray(Charsets.UTF_8).size
            if (current.isNotEmpty() && size + bytes > 7 * 1024 * 1024) { chunks.add(current); current = mutableListOf(); size = 0 }
            current.add(record); size += bytes
        }
        if (current.isNotEmpty() || chunks.isEmpty()) chunks.add(current)
        for ((index, chunk) in chunks.withIndex()) {
            val transmittedRuns = if (index == chunks.lastIndex) runs else emptyList()
            val (config, session) = auth.credentials(user)
            val body = buildJsonObject {
                put("device", buildJsonObject { put("device_uid", deviceUid); put("platform", "android"); put("model", Build.MODEL); put("app_version", BuildConfig.VERSION_NAME) })
                put("records", JsonArray(chunk))
                put("runs", json.encodeToJsonElement(transmittedRuns))
            }
            withContext(Dispatchers.IO) {
                val request = Request.Builder().url(config.url + "/functions/v1/sync-batch")
                    .header("apikey", config.publicKey).header("Authorization", "Bearer ${session.accessToken}")
                    .post(body.toString().toRequestBody("application/json".toMediaType())).build()
                var received = false
                try {
                    http.newCall(request).execute().use { response ->
                        received = true
                        result("HTTP_${response.code}")
                        check(response.isSuccessful) { "UPLOAD_FAILED" }
                        val acknowledgement = Json.parseToJsonElement(requireNotNull(response.body).string()).jsonObject
                        if (acknowledgement["accepted"]?.jsonPrimitive?.int != chunk.size ||
                            acknowledgement["runs_accepted"]?.jsonPrimitive?.int != transmittedRuns.size) {
                            result("INVALID_ACKNOWLEDGEMENT")
                            error("INVALID_ACKNOWLEDGEMENT")
                        }
                    }
                } catch (error: Exception) {
                    if (!received) result("NETWORK_FAILED")
                    throw error
                }
            }
        }
    }
}
