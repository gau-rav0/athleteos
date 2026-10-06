package com.athleteos.sync.data.remote

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

@Serializable
data class ServerConfig(val url: String, val publicKey: String)
@Serializable
data class AuthSession(val userId: String, val accessToken: String, val refreshToken: String, val expiresAt: Long)
@Serializable
private data class VaultState(val config: ServerConfig?, val session: AuthSession?)

/** OS-backed encryption; backup disabled in the manifest. Tokens never enter Room, logs or diagnostics. */
class SessionVault(context: Context) {
    private val preferences = context.getSharedPreferences("auth_vault", Context.MODE_PRIVATE)
    private val alias = "athleteos.auth.v1"
    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        return (store.getKey(alias, null) as? SecretKey) ?: KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
            init(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
        }.generateKey()
    }
    fun read(): Pair<ServerConfig?, AuthSession?> {
        val encrypted = preferences.getString("ciphertext", null) ?: return null to null
        return runCatching {
            val bytes = Base64.decode(encrypted, Base64.NO_WRAP)
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, bytes.copyOfRange(0, 12)))
            val state = Json.decodeFromString<VaultState>(cipher.doFinal(bytes.copyOfRange(12, bytes.size)).toString(Charsets.UTF_8))
            state.config to state.session
        }.getOrElse { null to null } // Key invalidation requires login again; never expose cryptographic errors.
    }
    fun write(config: ServerConfig?, session: AuthSession?) {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key())
        val encrypted = cipher.iv + cipher.doFinal(Json.encodeToString(VaultState(config, session)).toByteArray(Charsets.UTF_8))
        check(preferences.edit().putString("ciphertext", Base64.encodeToString(encrypted, Base64.NO_WRAP)).commit()) { "SESSION_STORAGE_FAILED" }
    }
}
