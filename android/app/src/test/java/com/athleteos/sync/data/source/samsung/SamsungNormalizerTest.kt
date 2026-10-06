package com.athleteos.sync.data.source.samsung

import java.time.Instant
import java.time.ZoneOffset
import kotlinx.serialization.json.*
import kotlin.test.*

/** Synthetic SDK-boundary fixtures; these tests never contact Samsung Health. */
class SamsungNormalizerTest {
    private val start = Instant.parse("2025-01-01T18:30:00Z")
    private val end = start.plusSeconds(3600)
    private fun point() = SamsungRawPoint(
        uid = "synthetic-vendor-uid",
        startTime = start,
        endTime = end,
        zoneOffset = ZoneOffset.of("+05:30"),
        updateTime = end.plusSeconds(1),
        appId = "synthetic.source.package",
        deviceId = "synthetic-device-id",
        device = buildJsonObject { put("model", "synthetic-watch") },
        fields = buildJsonObject { put("vendor_field", 1) },
        clientDataId = "synthetic-client-id",
        clientVersion = 2,
    )

    @Test fun vendorIdentityUtcOffsetAndProvenanceSurviveNormalization() {
        val record = SamsungNormalizer.normalize("heart_rate", point())
        record.validate()
        assertEquals("samsung_health", record.provider)
        assertEquals("synthetic-vendor-uid", record.sourceUid)
        assertEquals("heart_rate", record.recordType)
        assertEquals(start.toString(), record.startTime)
        assertEquals(end.toString(), record.endTime)
        assertEquals("+05:30", record.sourceZoneOffset)
        assertEquals(end.plusSeconds(1).toString(), record.sourceUpdatedAt)
        assertNull(record.sourceCreatedAt, "SDK v1.1.0 has no created timestamp API")
        assertEquals("synthetic.source.package", record.sourcePackage)
        assertEquals("synthetic-device-id", record.sourceDeviceId)
        assertEquals("synthetic-watch", record.deviceProvenance["model"]?.jsonPrimitive?.content)
        assertEquals(300, record.sourcePriority)
    }

    @Test fun absentDeviceAndOffsetRemainAbsent() {
        val record = SamsungNormalizer.normalize("sleep", point().copy(deviceId = null, device = JsonObject(emptyMap()), zoneOffset = null))
        record.validate()
        assertNull(record.sourceDeviceId)
        assertNull(record.sourceZoneOffset)
        assertTrue(record.deviceProvenance.isEmpty())
    }

    @Test fun updatesKeepVendorIdentityWhilePreservingNewModifiedTimestamp() {
        val first = SamsungNormalizer.normalize("heart_rate", point())
        val updated = SamsungNormalizer.normalize("heart_rate", point().copy(updateTime = end.plusSeconds(2), fields = buildJsonObject { put("vendor_field", 2) }))
        assertEquals(first.identity("synthetic-account"), updated.identity("synthetic-account"))
        assertNotEquals(first.payload, updated.payload)
        assertEquals(end.plusSeconds(2).toString(), updated.sourceUpdatedAt)
        assertNotEquals(first.identity("synthetic-account"), first.copy(sourceUid = "another-synthetic-uid").identity("synthetic-account"))
    }

    @Test fun historicalAndLiveMatchingVendorIdsUseSameIdentityWithoutGuessedAliases() {
        val live = SamsungNormalizer.normalize("sleep", point())
        val historical = live.copy(ingestionOrigin = "historical")
        assertEquals(live.identity("synthetic-account"), historical.identity("synthetic-account"))
        assertNotEquals(live.identity("synthetic-account"), historical.copy(sourceUid = "different-export-datauuid").identity("synthetic-account"))
    }

    @Test fun vendorEnergyFieldsStayVendorFieldsAndCannotBecomeRmssd() {
        val record = SamsungNormalizer.normalize("energy_score", point().copy(fields = buildJsonObject { put("shrv_value", 1) }))
        record.validate()
        assertEquals("energy_score", record.recordType)
        assertFalse(record.payload.toString().contains("rmssd", ignoreCase = true))
        assertFailsWith<IllegalArgumentException> { SamsungNormalizer.normalize("hrv_rmssd", point()).validate() }
    }

    @Test fun malformedVendorIdentityAndIntervalCannotBecomeValidRawRecords() {
        assertFailsWith<IllegalArgumentException> { SamsungNormalizer.normalize("sleep", point().copy(uid = "")).validate() }
        assertFailsWith<IllegalArgumentException> { SamsungNormalizer.normalize("sleep", point().copy(endTime = start.minusSeconds(1))).validate() }
    }
}
