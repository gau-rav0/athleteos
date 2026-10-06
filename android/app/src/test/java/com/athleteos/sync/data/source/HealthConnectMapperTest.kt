package com.athleteos.sync.data.source

import android.app.Application
import androidx.health.connect.client.changes.*
import androidx.health.connect.client.records.*
import androidx.health.connect.client.records.metadata.Device
import androidx.health.connect.client.records.metadata.Metadata
import com.athleteos.sync.data.source.healthconnect.HealthConnectMapper
import com.athleteos.sync.domain.repository.SourceChange
import java.time.Instant
import java.time.ZoneOffset
import kotlinx.serialization.json.*
import kotlin.test.*
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(application = Application::class, sdk = [33])
class HealthConnectMapperTest {
    private val start = Instant.parse("2025-01-01T00:00:00Z")
    private val end = start.plusSeconds(3600)
    private val metadata = Metadata.autoRecordedWithId("synthetic-source-id", Device(Device.TYPE_WATCH, "synthetic", "synthetic-watch"))
    @Test fun upsertionPreservesIdOffsetsAndDeviceMetadata() {
        val source = StepsRecord(start, ZoneOffset.of("+05:30"), end, ZoneOffset.of("+06:00"), 1, metadata)
        val result = HealthConnectMapper.change("steps", UpsertionChange(source)) as SourceChange.Upsert
        assertEquals("synthetic-source-id", result.record.sourceUid)
        assertEquals("+05:30", result.record.sourceZoneOffset)
        assertEquals("+06:00", result.record.endZoneOffset)
        assertEquals("synthetic-watch", result.record.deviceProvenance["model"]?.jsonPrimitive?.content)
        assertNull(result.record.sourceDeviceId)
    }
    @Test fun deletionUsesSourceIdAndMismatchedTypeQuarantines() {
        assertEquals(SourceChange.Delete("synthetic-source-id"), HealthConnectMapper.change("steps", DeletionChange("synthetic-source-id")))
        val source = StepsRecord(start, null, end, null, 1, metadata)
        assertIs<SourceChange.Quarantine>(HealthConnectMapper.record("sleep", source))
    }
    @Test fun onlyActualRmssdRecordProducesHrv() {
        val source = HeartRateVariabilityRmssdRecord(start, ZoneOffset.UTC, 1.0, metadata)
        val result = HealthConnectMapper.record("hrv_rmssd", source) as SourceChange.Upsert
        assertEquals(1.0, result.record.payload["rmssd_milliseconds"]?.jsonPrimitive?.double)
        assertIs<SourceChange.Quarantine>(HealthConnectMapper.record("hrv_rmssd", StepsRecord(start, null, end, null, 1, metadata)))
    }
    @Test fun sleepStagesRetainOriginalIntervals() {
        val source = SleepSessionRecord(start, ZoneOffset.UTC, end, ZoneOffset.UTC, metadata, stages = listOf(SleepSessionRecord.Stage(start, end, SleepSessionRecord.STAGE_TYPE_SLEEPING)))
        val result = HealthConnectMapper.record("sleep", source) as SourceChange.Upsert
        assertEquals(start.toString(), result.record.payload["stages"]?.jsonArray?.single()?.jsonObject?.get("start_time")?.jsonPrimitive?.content)
    }
}
