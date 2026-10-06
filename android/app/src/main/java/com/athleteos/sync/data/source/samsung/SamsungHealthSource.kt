package com.athleteos.sync.data.source.samsung

import com.athleteos.sync.domain.repository.*
import java.time.Instant
import android.app.Activity

/** Boundary for the current com.samsung.android.sdk.health.data API, never the deprecated SDK. */
interface SamsungSdkBridge {
    suspend fun requestPermissions(activity: Activity): SourceAvailability = SourceAvailability.SDK_BRIDGE_REQUIRED
    suspend fun availability(type: String, background: Boolean): SourceAvailability
    suspend fun newToken(type: String): String
    suspend fun changes(type: String, token: String): ChangePage
    suspend fun snapshot(type: String, from: Instant, until: Instant): Snapshot
    suspend fun inspectKnown(type: String, ids: List<String>): List<SourceChange>
}

class SamsungHealthSource(private val bridge: SamsungSdkBridge? = null) : HealthDataSource {
    override val provider = "samsung_health"
    override val recordTypes = setOf("activity_summary", "energy_score", "exercise", "heart_rate", "sleep", "steps",
        "skin_temperature", "blood_oxygen", "body_composition", "floors", "user_profile")
    val sdkPresent: Boolean get() = runCatching { Class.forName("com.samsung.android.sdk.health.data.HealthDataService") }.isSuccess
    override suspend fun availability(type: String, background: Boolean) = bridge?.availability(type, background)
        ?: if (sdkPresent) SourceAvailability.SDK_BRIDGE_REQUIRED else SourceAvailability.SDK_MISSING
    suspend fun requestPermissions(activity: Activity): SourceAvailability = bridge?.requestPermissions(activity) ?: SourceAvailability.SDK_MISSING
    private fun required(): SamsungSdkBridge = bridge ?: error("SAMSUNG_SDK_BRIDGE_UNAVAILABLE")
    override suspend fun newToken(type: String) = required().newToken(type)
    override suspend fun changes(type: String, token: String) = required().changes(type, token)
    override suspend fun snapshot(type: String, from: Instant, until: Instant) = required().snapshot(type, from, until)
    override suspend fun inspectKnown(type: String, sourceUids: List<String>) = required().inspectKnown(type, sourceUids)
}
