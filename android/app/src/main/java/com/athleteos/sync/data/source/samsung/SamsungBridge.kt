package com.athleteos.sync.data.source.samsung

import android.app.Activity
import com.athleteos.sync.domain.model.HealthRecord
import com.athleteos.sync.domain.repository.*
import java.time.Instant
import java.time.ZoneOffset
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.*

val samsungRawTypes = setOf("energy_score", "exercise", "heart_rate", "sleep", "skin_temperature", "blood_oxygen", "body_composition", "floors")

data class SamsungRawPoint(val uid: String, val startTime: Instant, val endTime: Instant? = null,
    val zoneOffset: ZoneOffset? = null, val updateTime: Instant? = null, val appId: String? = null,
    val deviceId: String? = null, val device: JsonObject = JsonObject(emptyMap()),
    val fields: JsonObject = JsonObject(emptyMap()), val clientDataId: String? = null, val clientVersion: Int? = null, val normalizationError: String? = null)

object SamsungNormalizer {
    fun normalize(type: String, point: SamsungRawPoint): HealthRecord {
        require(type in samsungRawTypes) { "UNSUPPORTED_SAMSUNG_RAW_TYPE" }
        require(point.normalizationError == null) { "MALFORMED_SAMSUNG_FIELDS" }
        return HealthRecord(provider = "samsung_health", recordType = type, sourceUid = point.uid,
            sourcePackage = point.appId, sourceDeviceId = point.deviceId, deviceProvenance = point.device,
            startTime = point.startTime.toString(), endTime = point.endTime?.toString(),
            sourceZoneOffset = point.zoneOffset?.id, sourceUpdatedAt = point.updateTime?.toString(),
            payload = buildJsonObject {
                put("sdk_version", "1.1.0"); put("uid", point.uid)
                put("fields", point.fields)
                point.clientDataId?.let { put("client_data_id", it) }
                point.clientVersion?.let { put("client_version", it) }
            }).also { it.validate() }
    }
}

data class SamsungReadPage(val points: List<SamsungRawPoint>, val nextPage: String? = null)
data class SamsungChangeEvent(val point: SamsungRawPoint? = null, val deletedUid: String? = null, val changeTime: Instant)
data class SamsungChangePage(val upserts: List<SamsungRawPoint>, val deletedIds: List<String>, val nextPage: String? = null, val events: List<SamsungChangeEvent>? = null)
interface SamsungReader {
    suspend fun availability(type: String): SourceAvailability
    suspend fun requestPermissions(activity: Activity): SourceAvailability
    suspend fun read(type: String, from: Instant, until: Instant, pageToken: String? = null, ids: List<String>? = null): SamsungReadPage
    suspend fun readChanges(type: String, from: Instant, until: Instant, pageToken: String? = null): SamsungChangePage
}

@Serializable
private data class SamsungCursor(val type: String, val from: String, val until: String? = null, val page: String? = null, val version: Int = 1)

class SamsungBridge(private val reader: SamsungReader, private val clock: () -> Instant = Instant::now) : SamsungSdkBridge {
    private val json = Json
    override suspend fun availability(type: String, background: Boolean): SourceAvailability =
        if (type !in samsungRawTypes) SourceAvailability.UNSUPPORTED else reader.availability(type)
    override suspend fun requestPermissions(activity: Activity) = reader.requestPermissions(activity)
    private suspend fun requirePermission(type: String) {
        check(type in samsungRawTypes) { "UNSUPPORTED_SAMSUNG_RAW_TYPE" }
        if (reader.availability(type) != SourceAvailability.AVAILABLE) throw SourceAccessException(SourceAccessProblem.PERMISSION_REVOKED)
    }
    override suspend fun newToken(type: String): String {
        requirePermission(type)
        return json.encodeToString(SamsungCursor.serializer(), SamsungCursor(type, clock().toString()))
    }
    private fun encode(cursor: SamsungCursor) = json.encodeToString(SamsungCursor.serializer(), cursor)
    private fun convert(type: String, point: SamsungRawPoint): SourceChange = try {
        SourceChange.Upsert(SamsungNormalizer.normalize(type, point))
    } catch (_: IllegalArgumentException) {
        SourceChange.Quarantine(point.uid, buildJsonObject {
            put("fields", point.fields); put("uid", point.uid); put("start_time", point.startTime.toString())
            point.endTime?.let { put("end_time", it.toString()) }
            point.zoneOffset?.let { put("zone_offset", it.id) }
            point.updateTime?.let { put("update_time", it.toString()) }
            point.appId?.let { put("app_id", it) }; point.deviceId?.let { put("device_id", it) }
            put("device", point.device)
        }.toString(), "MALFORMED_SAMSUNG_RECORD")
    }
    override suspend fun changes(type: String, token: String): ChangePage {
        requirePermission(type)
        val cursor = runCatching { json.decodeFromString(SamsungCursor.serializer(), token) }.getOrNull()
            ?: return ChangePage(emptyList(), token, expired = true)
        if (cursor.version != 1 || cursor.type != type) return ChangePage(emptyList(), token, expired = true)
        val from = runCatching { Instant.parse(cursor.from) }.getOrNull() ?: return ChangePage(emptyList(), token, expired = true)
        val until = if (cursor.until == null) clock() else runCatching { Instant.parse(cursor.until) }.getOrNull() ?: return ChangePage(emptyList(), token, expired = true)
        if (until < from) return ChangePage(emptyList(), token, expired = true)
        val page = reader.readChanges(type, from, until, cursor.page)
        requirePermission(type)
        val changes = page.events?.sortedBy { it.changeTime }?.map { event ->
            require((event.point == null) != (event.deletedUid == null)) { "INVALID_SAMSUNG_CHANGE" }
            event.point?.let { convert(type, it) } ?: requireNotNull(event.deletedUid).let {
                require(it.isNotBlank() && it.length <= 512) { "INVALID_SAMSUNG_DELETE_UID" }; SourceChange.Delete(it, event.changeTime.toString())
            }
        } ?: (page.upserts.map { convert(type, it) } + page.deletedIds.map {
            require(it.isNotBlank() && it.length <= 512) { "INVALID_SAMSUNG_DELETE_UID" }; SourceChange.Delete(it)
        })
        val next = if (!page.nextPage.isNullOrEmpty()) SamsungCursor(type, from.toString(), until.toString(), page.nextPage)
            else SamsungCursor(type, until.minusSeconds(1).toString())
        return ChangePage(changes, encode(next), !page.nextPage.isNullOrEmpty())
    }
    override suspend fun snapshot(type: String, from: Instant, until: Instant): Snapshot {
        requirePermission(type)
        val points = readAll(type, from, until, null)
        requirePermission(type)
        return Snapshot(points.map { convert(type, it) }, points.map { it.uid }.toSet(), from, until, reconcileMissing = false)
    }
    private suspend fun readAll(type: String, from: Instant, until: Instant, ids: List<String>?): List<SamsungRawPoint> {
        val result = mutableListOf<SamsungRawPoint>()
        val visited = mutableSetOf<String>()
        var token: String? = null
        do {
            val page = reader.read(type, from, until, token, ids)
            result += page.points
            token = page.nextPage?.takeIf { it.isNotEmpty() }
            if (token != null) check(visited.add(token)) { "SAMSUNG_NON_ADVANCING_PAGE" }
        } while (token != null)
        return result
    }
    override suspend fun inspectKnown(type: String, ids: List<String>): List<SourceChange> {
        requirePermission(type)
        val result = mutableListOf<SourceChange>()
        for (batch in ids.chunked(100)) {
            val points = readAll(type, Instant.EPOCH, clock(), batch)
            check(points.all { it.uid in batch }) { "SAMSUNG_ID_FILTER_MISMATCH" }
            requirePermission(type)
            val seen = points.map { it.uid }.toSet()
            result += points.map { convert(type, it) }
            result += batch.filter { it !in seen }.map { SourceChange.Delete(it) }
        }
        return result
    }
}
