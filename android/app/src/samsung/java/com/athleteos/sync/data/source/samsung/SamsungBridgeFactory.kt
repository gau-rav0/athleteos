package com.athleteos.sync.data.source.samsung

import android.app.Activity
import android.content.Context
import com.athleteos.sync.domain.repository.*
import com.samsung.android.sdk.health.data.HealthDataService
import com.samsung.android.sdk.health.data.data.*
import com.samsung.android.sdk.health.data.permission.AccessType
import com.samsung.android.sdk.health.data.permission.Permission
import com.samsung.android.sdk.health.data.request.*
import com.samsung.android.sdk.health.data.error.HealthDataException
import com.samsung.android.sdk.health.data.error.ErrorCode
import java.time.*
import java.lang.reflect.Modifier
import kotlinx.coroutines.CancellationException
import kotlinx.serialization.json.*

object SamsungBridgeFactory {
    fun create(context: Context): SamsungSdkBridge = SamsungBridge(SamsungSdkReader(context.applicationContext))
}

/** Only these public v1.1 SDK operations are called; no writes or aggregate-derived fake raw IDs. */
private class SamsungSdkReader(private val context: Context) : SamsungReader {
    private val store by lazy { HealthDataService.getStore(context) }
    private val types: Map<String, DataType> = mapOf(
        "energy_score" to DataTypes.ENERGY_SCORE, "exercise" to DataTypes.EXERCISE,
        "heart_rate" to DataTypes.HEART_RATE, "sleep" to DataTypes.SLEEP,
        "skin_temperature" to DataTypes.SKIN_TEMPERATURE, "blood_oxygen" to DataTypes.BLOOD_OXYGEN,
        "body_composition" to DataTypes.BODY_COMPOSITION, "floors" to DataTypes.FLOORS_CLIMBED)
    private fun permission(type: String) = Permission.of(types.getValue(type), AccessType.READ)
    override suspend fun availability(type: String): SourceAvailability {
        if (type !in types) return SourceAvailability.UNSUPPORTED
        return try {
            if (permission(type) in store.getGrantedPermissions(setOf(permission(type)))) SourceAvailability.AVAILABLE
            else SourceAvailability.PERMISSION_REQUIRED
        } catch (e: HealthDataException) {
            when (e.errorCode) {
                ErrorCode.ERR_PLATFORM_NOT_INSTALLED -> SourceAvailability.PLATFORM_MISSING
                ErrorCode.ERR_OLD_VERSION_PLATFORM -> SourceAvailability.PLATFORM_UPDATE_REQUIRED
                ErrorCode.ERR_PLATFORM_DISABLED, ErrorCode.ERR_PLATFORM_NOT_INITIALIZED -> SourceAvailability.PLATFORM_UNAVAILABLE
                ErrorCode.ERR_UNSUPPORTED_OPERATION -> SourceAvailability.UNSUPPORTED
                else -> SourceAvailability.PERMISSION_REQUIRED
            }
        }
    }
    override suspend fun requestPermissions(activity: Activity): SourceAvailability {
        val wanted = types.keys.map { permission(it) }.toSet()
        val granted = store.requestPermissions(wanted, activity)
        return if (granted.containsAll(wanted)) SourceAvailability.AVAILABLE else SourceAvailability.PERMISSION_REQUIRED
    }
    @Suppress("UNCHECKED_CAST")
    private fun readable(type: String) = types.getValue(type) as DataType.Readable<HealthDataPoint, ReadDataRequest.Builder<HealthDataPoint>>
    @Suppress("UNCHECKED_CAST")
    private fun changeReadable(type: String) = types.getValue(type) as DataType.ChangeReadable<HealthDataPoint>
    override suspend fun read(type: String, from: Instant, until: Instant, pageToken: String?, ids: List<String>?): SamsungReadPage {
        val builder = readable(type).readDataRequestBuilder
        val idFilter = ids?.let { values ->
            // Public builder supports multiple UIDs; never substitute client data IDs.
            val idBuilder = IdFilter.builder()
            values.forEach { idBuilder.addDataUid(it) }
            idBuilder.build()
        }
        val request = when (builder) {
            is ReadDataRequest.DualTimeBuilder -> {
                builder.setPageSize(500)
                if (pageToken != null) builder.setPageToken(pageToken)
                if (idFilter != null) builder.setIdFilter(idFilter)
                else builder.setInstantTimeFilter(InstantTimeFilter.of(from, until, true, true))
                builder.build()
            }
            is ReadDataRequest.LocalDateBuilder -> {
                builder.setPageSize(500)
                if (pageToken != null) builder.setPageToken(pageToken)
                if (idFilter != null) builder.setIdFilter(idFilter)
                // Expand by one day for offsets up to +/-18h, then filter authoritative instants below.
                else builder.setLocalDateFilter(LocalDateFilter.of(from.atOffset(ZoneOffset.UTC).toLocalDate().minusDays(1), until.atOffset(ZoneOffset.UTC).toLocalDate().plusDays(1), true, true))
                builder.build()
            }
            else -> error("UNSUPPORTED_SAMSUNG_READ_BUILDER")
        }
        val response = store.readData(request)
        val points = response.dataList.map { convert(type, it) }.filter { ids != null || it.startTime in from..until }
        return SamsungReadPage(points, response.pageToken)
    }
    override suspend fun readChanges(type: String, from: Instant, until: Instant, pageToken: String?): SamsungChangePage {
        val events = mutableListOf<SamsungChangeEvent>()
        val visited = mutableSetOf<String>()
        var next = pageToken
        do {
            val builder = changeReadable(type).changedDataRequestBuilder
                .setPageSize(500).setChangeTimeFilter(InstantTimeFilter.of(from, until, true, true))
            if (next != null) builder.setPageToken(next)
            val response = store.readChanges(builder.build())
            response.dataList.forEach { change ->
                events += when (change.changeType) {
                    ChangeType.UPSERT -> SamsungChangeEvent(point = convert(type, requireNotNull(change.upsertDataPoint)), changeTime = change.changeTime)
                    ChangeType.DELETE -> SamsungChangeEvent(deletedUid = requireNotNull(change.deleteDataUid), changeTime = change.changeTime)
                }
            }
            next = response.pageToken?.takeIf { it.isNotEmpty() }
            if (next != null) check(visited.add(next)) { "SAMSUNG_NON_ADVANCING_PAGE" }
        } while (next != null)
        // SDK pages are not assumed to be ordered. Keep final event per authoritative UID.
        val finalEvents = events.sortedBy { it.changeTime }.associateBy { it.point?.uid ?: it.deletedUid }.values.toList()
        return SamsungChangePage(emptyList(), emptyList(), events = finalEvents)
    }
    @Suppress("UNCHECKED_CAST")
    private suspend fun convert(type: String, point: HealthDataPoint): SamsungRawPoint {
        val device = point.dataSource?.deviceId?.let { id ->
            try {
                store.getDeviceManager().getDevice(id)?.let { value -> buildJsonObject {
                    put("manufacturer", value.manufacturer); put("model", value.model)
                    put("name", value.name); put("type", value.deviceType.toString())
                } }
            } catch (e: CancellationException) { throw e } catch (_: HealthDataException) { null }
        } ?: JsonObject(emptyMap())
        var fieldFailure = false
        val fields = buildJsonObject {
            types.getValue(type).allFields.forEach { field ->
                try {
                    point.getValue(field as Field<Any>)?.let { put(field.name, rawJson(it)) }
                } catch (e: CancellationException) { throw e } catch (_: Exception) {
                    fieldFailure = true
                    put(field.name, buildJsonObject { put("quarantine_reason", "SDK_FIELD_NOT_SERIALIZABLE") })
                }
            }
        }
        return SamsungRawPoint(point.uid, point.startTime, point.endTime, point.zoneOffset,
            point.updateTime, point.dataSource?.appId, point.dataSource?.deviceId, device, fields,
            point.clientDataId, point.clientVersion, if (fieldFailure) "SDK_FIELD_NOT_SERIALIZABLE" else null)
    }
    /** Preserve typed public SDK fields and entry properties, with no guessed physiological conversions. */
    private fun rawJson(value: Any, depth: Int = 0): JsonElement {
        require(depth <= 12) { "SAMSUNG_PAYLOAD_TOO_DEEP" }
        return when (value) {
            is String -> JsonPrimitive(value)
            is Number -> {
                require(value.toDouble().isFinite()) { "SAMSUNG_NON_FINITE_VALUE" }
                JsonPrimitive(value)
            }
            is Boolean -> JsonPrimitive(value)
            is Enum<*> -> JsonPrimitive(value.name)
            is Instant, is Duration, is LocalDate, is LocalDateTime, is ZoneOffset -> JsonPrimitive(value.toString())
            is List<*> -> JsonArray(value.map { if (it == null) JsonNull else rawJson(it, depth + 1) })
            else -> {
                require(value.javaClass.name.startsWith("com.samsung.android.sdk.health.data.data.entries.")) { "UNSUPPORTED_SAMSUNG_FIELD_VALUE" }
                buildJsonObject {
                    value.javaClass.methods.filter { it.parameterCount == 0 && !Modifier.isStatic(it.modifiers) && it.name.startsWith("get") && it.name != "getClass" }
                        .sortedBy { it.name }.forEach { method ->
                            val property = method.name.removePrefix("get").replaceFirstChar { it.lowercase() }
                            method.invoke(value)?.let { put(property, rawJson(it, depth + 1)) }
                        }
                }
            }
        }
    }
}
