package com.athleteos.sync.data.remote

import java.time.Instant
import java.util.Base64
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.HttpUrl.Companion.toHttpUrl

class SupabaseAuth(private val vault: SessionVault, private val http: OkHttpClient) {
    private val mutex = Mutex()
    private val stored = vault.read()
    private var config: ServerConfig? = stored.first
    private var session: AuthSession? = stored.second
    private val accountState = MutableStateFlow(session?.userId)
    val user: StateFlow<String?> = accountState
    val configured: Boolean get() = config != null

    suspend fun signIn(url: String, key: String, email: String, password: String) = mutex.withLock {
        val parsed = url.trim().trimEnd('/').toHttpUrl()
        require(parsed.scheme == "https" && parsed.username.isEmpty() && parsed.password.isEmpty() && parsed.encodedPath == "/" && parsed.query == null && parsed.fragment == null) { "HTTPS_BASE_URL_REQUIRED" }
        requirePublicKey(key.trim())
        val newConfig = ServerConfig(parsed.toString().trimEnd('/'), key.trim())
        val result = request(newConfig, "/auth/v1/token?grant_type=password", buildJsonObject { put("email", email.trim()); put("password", password) })
        val newSession = parseSession(result)
        vault.write(newConfig, newSession)
        config = newConfig
        session = newSession
        accountState.value = newSession.userId
    }
    private fun requirePublicKey(key: String) {
        if (key.startsWith("sb_publishable_") && key.length > 20) return
        val claims = runCatching { Json.parseToJsonElement(String(Base64.getUrlDecoder().decode(key.split('.')[1]), Charsets.UTF_8)).jsonObject }.getOrNull()
        require(claims?.get("role")?.jsonPrimitive?.content == "anon") { "PUBLIC_KEY_REQUIRED" }
    }
    suspend fun credentials(expectedUser: String): Pair<ServerConfig, AuthSession> = mutex.withLock {
        val currentConfig = requireNotNull(config) { "LOGIN_REQUIRED" }
        var current = requireNotNull(session) { "LOGIN_REQUIRED" }
        check(current.userId == expectedUser) { "ACCOUNT_CHANGED" }
        if (current.expiresAt <= Instant.now().epochSecond + 60) {
            val response = request(currentConfig, "/auth/v1/token?grant_type=refresh_token", buildJsonObject { put("refresh_token", current.refreshToken) })
            current = parseSession(response)
            check(current.userId == expectedUser) { "ACCOUNT_CHANGED" }
            vault.write(currentConfig, current)
            session = current
        }
        currentConfig to current
    }
    suspend fun signOut() = mutex.withLock {
        vault.write(config, null)
        session = null
        accountState.value = null
    }
    private suspend fun request(config: ServerConfig, path: String, payload: JsonObject): JsonObject = withContext(Dispatchers.IO) {
        val request = Request.Builder().url(config.url + path).header("apikey", config.publicKey)
            .post(payload.toString().toRequestBody("application/json".toMediaType())).build()
        http.newCall(request).execute().use { response ->
            check(response.isSuccessful) { "AUTH_FAILED" }
            val body = requireNotNull(response.body)
            check(body.contentLength() <= 1_048_576) { "AUTH_RESPONSE_TOO_LARGE" }
            Json.parseToJsonElement(body.string()).jsonObject
        }
    }
    private fun parseSession(body: JsonObject): AuthSession {
        val userId = body.getValue("user").jsonObject.getValue("id").jsonPrimitive.content
        require(userId.matches(Regex("[0-9a-fA-F-]{36}"))) { "INVALID_SESSION" }
        return AuthSession(userId, body.getValue("access_token").jsonPrimitive.content,
            body.getValue("refresh_token").jsonPrimitive.content,
            body["expires_at"]?.jsonPrimitive?.long ?: (Instant.now().epochSecond + body.getValue("expires_in").jsonPrimitive.long))
    }
}
