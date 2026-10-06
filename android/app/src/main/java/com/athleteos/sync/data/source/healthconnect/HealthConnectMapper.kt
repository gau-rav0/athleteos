package com.athleteos.sync.data.source.healthconnect

import androidx.health.connect.client.changes.Change
import androidx.health.connect.client.changes.DeletionChange
import androidx.health.connect.client.changes.UpsertionChange
import androidx.health.connect.client.records.*
import com.athleteos.sync.domain.model.HealthRecord
import com.athleteos.sync.domain.repository.SourceChange
import java.time.Instant
import java.time.ZoneOffset
import kotlinx.serialization.json.*

object HealthConnectMapper {
    val types = linkedMapOf(
        "steps" to StepsRecord::class, "sleep" to SleepSessionRecord::class,
        "heart_rate" to HeartRateRecord::class, "exercise" to ExerciseSessionRecord::class,
        "weight" to WeightRecord::class, "body_fat" to BodyFatRecord::class,
        "active_calories" to ActiveCaloriesBurnedRecord::class, "total_calories" to TotalCaloriesBurnedRecord::class,
        "distance" to DistanceRecord::class, "speed" to SpeedRecord::class,
        "floors" to FloorsClimbedRecord::class, "hrv_rmssd" to HeartRateVariabilityRmssdRecord::class,
    )

    fun change(type: String, change: Change): SourceChange = when (change) {
        is UpsertionChange -> record(type, change.record)
        is DeletionChange -> SourceChange.Delete(change.recordId)
        else -> error("UNKNOWN_CHANGE")
    }

    fun record(type: String, record: Record): SourceChange {
        // No vendor toString in logs. If conversion fails, retain the vendor representation privately in Room.
        return try {
            require(record::class == types[type])
            SourceChange.Upsert(convert(type, record).also { it.validate() })
        } catch (_: IllegalArgumentException) {
            SourceChange.Quarantine(record.metadata.id, record.toString(), "MALFORMED_RECORD")
        }
    }

    private fun convert(type: String, record: Record): HealthRecord {
        val metadata = record.metadata
        val times = times(record)
        val device = buildJsonObject {
            metadata.device?.let {
                put("type", it.type)
                it.manufacturer?.let { value -> put("manufacturer", value) }
                it.model?.let { value -> put("model", value) }
            }
        }
        val payload = buildJsonObject {
            put("metadata", buildJsonObject {
                put("id", metadata.id)
                put("data_origin", metadata.dataOrigin.packageName)
                put("last_modified_time", metadata.lastModifiedTime.toString())
                put("recording_method", metadata.recordingMethod)
                metadata.clientRecordId?.let { put("client_record_id", it) }
                put("client_record_version", metadata.clientRecordVersion)
            })
            when (record) {
                is StepsRecord -> put("count", record.count)
                is SleepSessionRecord -> {
                    record.title?.let { put("title", it) }
                    record.notes?.let { put("notes", it) }
                    put("stages", buildJsonArray { record.stages.forEach { stage -> add(buildJsonObject {
                        put("start_time", stage.startTime.toString()); put("end_time", stage.endTime.toString()); put("stage", stage.stage)
                    }) } })
                }
                is HeartRateRecord -> put("samples", buildJsonArray { record.samples.forEach { sample -> add(buildJsonObject {
                    put("time", sample.time.toString()); put("beats_per_minute", sample.beatsPerMinute)
                }) } })
                is ExerciseSessionRecord -> {
                    put("exercise_type", record.exerciseType)
                    record.title?.let { put("title", it) }
                    record.notes?.let { put("notes", it) }
                    record.plannedExerciseSessionId?.let { put("planned_session_id", it) }
                    put("segments", buildJsonArray { record.segments.forEach { segment -> add(buildJsonObject {
                        put("start_time", segment.startTime.toString()); put("end_time", segment.endTime.toString())
                        put("segment_type", segment.segmentType); put("repetitions", segment.repetitions)
                    }) } })
                    put("laps", buildJsonArray { record.laps.forEach { lap -> add(buildJsonObject {
                        put("start_time", lap.startTime.toString()); put("end_time", lap.endTime.toString())
                        lap.length?.let { put("length_metres", it.inMeters) }
                    }) } })
                    // Route access has its own consent boundary and is outside the Phase 1 permission set.
                }
                is WeightRecord -> put("kilograms", record.weight.inKilograms)
                is BodyFatRecord -> put("percentage", record.percentage.value)
                is ActiveCaloriesBurnedRecord -> put("kilocalories", record.energy.inKilocalories)
                is TotalCaloriesBurnedRecord -> put("kilocalories", record.energy.inKilocalories)
                is DistanceRecord -> put("metres", record.distance.inMeters)
                is SpeedRecord -> put("samples", buildJsonArray { record.samples.forEach { sample -> add(buildJsonObject {
                    put("time", sample.time.toString()); put("metres_per_second", sample.speed.inMetersPerSecond)
                }) } })
                is FloorsClimbedRecord -> put("floors", record.floors)
                is HeartRateVariabilityRmssdRecord -> put("rmssd_milliseconds", record.heartRateVariabilityMillis)
                else -> error("UNSUPPORTED_RECORD")
            }
        }
        return HealthRecord("health_connect", type, metadata.id, sourcePackage = metadata.dataOrigin.packageName.takeIf { it.isNotBlank() },
            // Health Connect exposes descriptive device metadata, not a physical device UID. Do not invent one.
            sourceDeviceId = null, deviceProvenance = device,
            startTime = times.start.toString(),
            endTime = times.end?.toString(),
            sourceZoneOffset = times.startOffset?.id,
            endZoneOffset = times.endOffset?.id,
            sourceUpdatedAt = metadata.lastModifiedTime.toString(), payload = payload)
    }

    private data class Times(val start: Instant, val startOffset: ZoneOffset?, val end: Instant? = null, val endOffset: ZoneOffset? = null)
    // Jetpack's shared IntervalRecord/InstantaneousRecord interfaces are internal. Use public types only.
    private fun times(record: Record): Times = when (record) {
        is StepsRecord -> Times(record.startTime, record.startZoneOffset, record.endTime, record.endZoneOffset)
        is SleepSessionRecord -> Times(record.startTime, record.startZoneOffset, record.endTime, record.endZoneOffset)
        is HeartRateRecord -> Times(record.startTime, record.startZoneOffset, record.endTime, record.endZoneOffset)
        is ExerciseSessionRecord -> Times(record.startTime, record.startZoneOffset, record.endTime, record.endZoneOffset)
        is ActiveCaloriesBurnedRecord -> Times(record.startTime, record.startZoneOffset, record.endTime, record.endZoneOffset)
        is TotalCaloriesBurnedRecord -> Times(record.startTime, record.startZoneOffset, record.endTime, record.endZoneOffset)
        is DistanceRecord -> Times(record.startTime, record.startZoneOffset, record.endTime, record.endZoneOffset)
        is SpeedRecord -> Times(record.startTime, record.startZoneOffset, record.endTime, record.endZoneOffset)
        is FloorsClimbedRecord -> Times(record.startTime, record.startZoneOffset, record.endTime, record.endZoneOffset)
        is WeightRecord -> Times(record.time, record.zoneOffset)
        is BodyFatRecord -> Times(record.time, record.zoneOffset)
        is HeartRateVariabilityRmssdRecord -> Times(record.time, record.zoneOffset)
        else -> error("UNSUPPORTED_RECORD")
    }
}
