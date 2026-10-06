package com.athleteos.sync.domain.model

import java.security.MessageDigest
import java.time.Instant
import java.time.OffsetDateTime
import java.time.ZoneOffset
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject

@Serializable
data class HealthRecord(
    val provider: String,
    @SerialName("record_type") val recordType: String,
    @SerialName("source_uid") val sourceUid: String,
    @SerialName("source_package") val sourcePackage: String? = null,
    @SerialName("source_device_id") val sourceDeviceId: String? = null,
    @SerialName("device_provenance") val deviceProvenance: JsonObject = JsonObject(emptyMap()),
    @SerialName("start_time") val startTime: String? = null,
    @SerialName("end_time") val endTime: String? = null,
    @SerialName("source_zone_offset") val sourceZoneOffset: String? = null,
    @SerialName("end_zone_offset") val endZoneOffset: String? = null,
    @SerialName("source_created_at") val sourceCreatedAt: String? = null,
    @SerialName("source_updated_at") val sourceUpdatedAt: String? = null,
    @SerialName("schema_version") val schemaVersion: Int = 1,
    val payload: JsonObject = JsonObject(emptyMap()),
    val deleted: Boolean = false,
    @SerialName("ingestion_origin") val ingestionOrigin: String = "live",
    @SerialName("source_priority") val sourcePriority: Int = SourcePolicy.priority(provider, recordType, deviceProvenance.toString()),
) {
    /** Hash a length-delimited tuple; never timestamp-based and never trim/change vendor IDs. */
    fun identity(userId: String): String = digest(listOf(userId, provider, recordType, sourceUid)
        .joinToString("") { "${it.toByteArray(Charsets.UTF_8).size}:$it" })

    fun validate() {
        require(provider in setOf("health_connect", "samsung_health")) { "INVALID_PROVIDER" }
        require(recordType in SourcePolicy.types && sourceUid.isNotBlank() && sourceUid.length <= 512) { "INVALID_IDENTITY" }
        require(schemaVersion == 1 && ingestionOrigin in setOf("live", "historical")) { "INVALID_SCHEMA" }
        require(sourcePriority in 0..300) { "INVALID_PRIORITY" }
        require(recordType != "hrv_rmssd" || provider == "health_connect") { "REAL_RMSSD_SOURCE_REQUIRED" }
        listOfNotNull(startTime, endTime, sourceCreatedAt, sourceUpdatedAt).forEach {
            require(it.endsWith("Z") && runCatching { Instant.parse(it) }.isSuccess) { "INVALID_TIMESTAMP" }
        }
        listOfNotNull(sourceZoneOffset, endZoneOffset).forEach {
            require(runCatching { ZoneOffset.of(it).id == it }.getOrDefault(false)) { "INVALID_OFFSET" }
        }
        listOfNotNull(sourcePackage, sourceDeviceId).forEach { require(it.isNotBlank() && it.length <= 512) { "INVALID_PROVENANCE" } }
        require(deleted || startTime != null || (provider == "samsung_health" && ingestionOrigin == "historical" && recordType in SourcePolicy.undatedTypes)) { "MISSING_TIME" }
        if (startTime != null && endTime != null) require(Instant.parse(endTime) >= Instant.parse(startTime)) { "INVALID_INTERVAL" }
        require(payload.toString().toByteArray().size <= 262_144) { "PAYLOAD_TOO_LARGE" }
    }

    fun tombstone(): HealthRecord = copy(deleted = true)
    companion object {
        fun digest(value: String): String = MessageDigest.getInstance("SHA-256")
            .digest(value.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }
        fun utc(value: String): String = OffsetDateTime.parse(value).toInstant().toString()
        fun offset(value: String): String = OffsetDateTime.parse(value).offset.id
    }
}

object SourcePolicy {
    val undatedTypes = setOf("vendor_raw", "training_load_goal", "device_metadata", "source_metadata", "user_profile")
    val types = setOf("steps", "sleep", "heart_rate", "exercise", "weight", "body_fat", "active_calories",
        "total_calories", "distance", "speed", "floors", "hrv_rmssd", "activity_summary", "energy_score",
        "skin_temperature", "blood_oxygen", "body_composition", "user_profile", "sleep_stage", "steps_daily", "pedometer_day_summary", "floors_daily", "hrv_envelope", "respiratory_rate", "movement", "stress", "nap", "food_intake", "nutrition", "water", "ecg", "mood", "heart_health_score", "training_load_goal", "device_metadata", "source_metadata", "vendor_raw")
    // Metadata only. No aggregation or destructive canonical-source selection in Phase 1.
    fun priority(provider: String, type: String, device: String = ""): Int = when {
        type in setOf("steps", "steps_daily", "pedometer_day_summary", "activity_summary") -> 0 // Cannot add watch and phone counts.
        type == "hrv_rmssd" -> if (provider == "health_connect") 100 else 0
        provider == "samsung_health" && type == "heart_rate" -> when {
            device.contains("watch", true) -> 300
            device.contains("phone", true) -> 200
            else -> 150
        }
        provider == "samsung_health" -> 200
        else -> 100
    }
}

enum class UploadState { PENDING, UPLOADING, SYNCED, FAILED }
enum class DataStatus { AVAILABLE, MISSING, PERMISSION_REQUIRED, STALE, UNSUPPORTED }
