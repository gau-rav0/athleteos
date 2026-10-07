package com.athleteos.sync.data.source.samsung

import android.app.Activity
import com.athleteos.sync.domain.repository.*
import java.time.Instant
import kotlinx.coroutines.test.runTest
import kotlin.test.*

class SamsungBridgeTest {
    @Test fun snapshotPersistsEachPageBeforeRequestingTheNextPage() = runTest {
        val reader = FakeReader()
        val persisted = mutableListOf<String>()
        reader.onRead = { token, _ ->
            if (token == null) SamsungReadPage(listOf(point("first")), "second")
            else {
                assertEquals(listOf("first"), persisted)
                SamsungReadPage(listOf(point("second")))
            }
        }
        val summary = SamsungBridge(reader).streamSnapshot("sleep", start, start.plusSeconds(1)) { page ->
            persisted.addAll(page.map { (it as SourceChange.Upsert).record.sourceUid })
        }
        assertEquals(listOf("first", "second"), persisted)
        assertEquals(setOf("first", "second"), summary.seenIds)
        assertTrue(summary.changes.isEmpty())
        assertFalse(summary.reconcileMissing)
    }
    private val start = Instant.parse("2025-01-01T00:00:00Z")
    private fun point(id: String = "synthetic-id") = SamsungRawPoint(id, start, updateTime = start)
    private class FakeReader : SamsungReader {
        var state = SourceAvailability.AVAILABLE
        val readCalls = mutableListOf<List<String>?>()
        val changeCalls = mutableListOf<Triple<Instant, Instant, String?>>()
        var onRead: suspend (String?, List<String>?) -> SamsungReadPage = { _, _ -> SamsungReadPage(emptyList()) }
        var onChanges: suspend (String?) -> SamsungChangePage = { SamsungChangePage(emptyList(), emptyList()) }
        override suspend fun availability(type: String) = state
        override suspend fun requestPermissions(activity: Activity) = state
        override suspend fun read(type: String, from: Instant, until: Instant, pageToken: String?, ids: List<String>?): SamsungReadPage {
            readCalls += ids
            return onRead(pageToken, ids)
        }
        override suspend fun readChanges(type: String, from: Instant, until: Instant, pageToken: String?): SamsungChangePage {
            changeCalls += Triple(from, until, pageToken)
            return onChanges(pageToken)
        }
    }

    @Test fun unsupportedTypesNeverBecomeReadableOrInventRmssd() = runTest {
        val reader = FakeReader()
        val bridge = SamsungBridge(reader) { start }
        for (type in listOf("activity_summary", "steps", "user_profile", "hrv_rmssd")) {
            assertEquals(SourceAvailability.UNSUPPORTED, bridge.availability(type, false))
        }
        for (type in samsungRawTypes) assertEquals(SourceAvailability.AVAILABLE, bridge.availability(type, true))
        assertTrue(reader.readCalls.isEmpty())
        assertTrue(reader.changeCalls.isEmpty())
    }

    @Test fun deniedPermissionAndMissingAppDoNotReadOrAdvanceTokens() = runTest {
        val reader = FakeReader()
        val bridge = SamsungBridge(reader) { start }
        for (state in listOf(SourceAvailability.PERMISSION_REQUIRED, SourceAvailability.SDK_MISSING, SourceAvailability.PLATFORM_MISSING, SourceAvailability.PLATFORM_UPDATE_REQUIRED, SourceAvailability.PLATFORM_UNAVAILABLE)) {
            reader.state = state
            assertEquals(state, bridge.availability("sleep", false))
            assertFailsWith<SourceAccessException> { bridge.newToken("sleep") }
            assertFailsWith<SourceAccessException> { bridge.snapshot("sleep", start, start.plusSeconds(1)) }
        }
        assertTrue(reader.readCalls.isEmpty())
    }

    @Test fun changePagesPreserveUpdatesAndDeletesAndPinTheReadInterval() = runTest {
        val reader = FakeReader()
        var now = start
        val bridge = SamsungBridge(reader) { now }
        val firstToken = bridge.newToken("sleep")
        now = start.plusSeconds(10)
        reader.onChanges = { page ->
            if (page == null) SamsungChangePage(listOf(point().copy(updateTime = now)), emptyList(), "next")
            else SamsungChangePage(emptyList(), listOf("synthetic-deleted-id"))
        }
        val first = bridge.changes("sleep", firstToken)
        assertTrue(first.hasMore)
        assertEquals(now.toString(), assertIs<SourceChange.Upsert>(first.changes.single()).record.sourceUpdatedAt)
        now = start.plusSeconds(20)
        val second = bridge.changes("sleep", first.nextToken)
        assertFalse(second.hasMore)
        assertEquals(SourceChange.Delete("synthetic-deleted-id"), second.changes.single())
        assertEquals(start.plusSeconds(10), reader.changeCalls[1].second)
        bridge.changes("sleep", second.nextToken)
        assertEquals(start.plusSeconds(9), reader.changeCalls[2].first, "One-second overlap prevents boundary loss")
    }

    @Test fun malformedWrongTypeFutureAndInvalidUntilCursorsRequireReset() = runTest {
        val reader = FakeReader()
        val bridge = SamsungBridge(reader) { start }
        val tokens = listOf(
            "malformed",
            """{"type":"heart_rate","from":"$start"}""",
            """{"type":"sleep","from":"${start.plusSeconds(1)}"}""",
            """{"type":"sleep","from":"$start","version":2}""",
            """{"type":"sleep","from":"$start","until":"invalid"}""",
        )
        for (token in tokens) assertTrue(bridge.changes("sleep", token).expired)
        assertTrue(reader.changeCalls.isEmpty())
    }

    @Test fun completeSnapshotIncludesEveryPageAndQuarantinesMalformedRecords() = runTest {
        val reader = FakeReader()
        reader.onRead = { page, _ ->
            if (page == null) SamsungReadPage(listOf(point()), "next")
            else SamsungReadPage(listOf(point("synthetic-second-id"), point("")))
        }
        val snapshot = SamsungBridge(reader) { start }.snapshot("sleep", start.minusSeconds(72 * 3600), start)
        assertEquals(setOf("synthetic-id", "synthetic-second-id", ""), snapshot.seenIds)
        assertEquals(2, snapshot.changes.filterIsInstance<SourceChange.Upsert>().size)
        assertEquals("MALFORMED_SAMSUNG_RECORD", assertIs<SourceChange.Quarantine>(snapshot.changes.last()).reason)
        assertFalse(snapshot.reconcileMissing, "Samsung range absence alone is not deletion proof")
        assertEquals(start.minusSeconds(72 * 3600), snapshot.from)
        assertEquals(start, snapshot.until)
    }

    @Test fun sdkFieldSerializationFailureIsDurablyQuarantinableWithoutAcceptingPartialRecord() = runTest {
        val reader = FakeReader()
        reader.onRead = { _, _ -> SamsungReadPage(listOf(point().copy(normalizationError = "SDK_FIELD_NOT_SERIALIZABLE"))) }
        val snapshot = SamsungBridge(reader) { start }.snapshot("sleep", start.minusSeconds(1), start.plusSeconds(1))
        assertEquals(setOf("synthetic-id"), snapshot.seenIds)
        assertEquals("MALFORMED_SAMSUNG_RECORD", assertIs<SourceChange.Quarantine>(snapshot.changes.single()).reason)
        assertTrue(snapshot.changes.filterIsInstance<SourceChange.Upsert>().isEmpty())
    }

    @Test fun snapshotReadFailureAndRevocationCannotReturnCompleteWindow() = runTest {
        val reader = FakeReader()
        val bridge = SamsungBridge(reader) { start }
        reader.onRead = { page, _ ->
            if (page == null) SamsungReadPage(listOf(point()), "next") else error("SYNTHETIC_READ_FAILURE")
        }
        assertFailsWith<IllegalStateException> { bridge.snapshot("sleep", start.minusSeconds(7 * 86400), start) }
        reader.onRead = { _, _ -> reader.state = SourceAvailability.PERMISSION_REQUIRED; SamsungReadPage(emptyList()) }
        assertFailsWith<SourceAccessException> { bridge.snapshot("sleep", start.minusSeconds(7 * 86400), start) }
    }

    @Test fun repeatedPageCannotCertifyACompleteSnapshot() = runTest {
        val reader = FakeReader()
        reader.onRead = { _, _ -> SamsungReadPage(listOf(point()), "same-page") }
        assertFailsWith<IllegalStateException> { SamsungBridge(reader) { start }.snapshot("sleep", start.minusSeconds(1), start) }
        assertEquals(2, reader.readCalls.size)
    }

    @Test fun knownIdsReconcileInBoundedBatchesAndOnlyMissingIdsBecomeTombstones() = runTest {
        val reader = FakeReader()
        reader.onRead = { _, ids -> SamsungReadPage(ids.orEmpty().filter { it != "synthetic-id-150" }.map { point(it) }) }
        val ids = (1..201).map { "synthetic-id-$it" }
        val changes = SamsungBridge(reader) { start }.inspectKnown("sleep", ids)
        assertEquals(listOf(100, 100, 1), reader.readCalls.map { it?.size })
        assertEquals(listOf(SourceChange.Delete("synthetic-id-150")), changes.filterIsInstance<SourceChange.Delete>())
        assertEquals(200, changes.filterIsInstance<SourceChange.Upsert>().size)
    }

    @Test fun knownIdPermissionRevocationCannotProduceDeletion() = runTest {
        val reader = FakeReader()
        reader.onRead = { _, _ -> reader.state = SourceAvailability.PERMISSION_REQUIRED; SamsungReadPage(emptyList()) }
        assertFailsWith<SourceAccessException> { SamsungBridge(reader) { start }.inspectKnown("sleep", listOf("synthetic-id")) }
    }

    @Test fun changeReadRevocationAndInvalidDeletionCannotAdvanceCursor() = runTest {
        val reader = FakeReader()
        val bridge = SamsungBridge(reader) { start }
        val token = bridge.newToken("sleep")
        reader.onChanges = { reader.state = SourceAvailability.PERMISSION_REQUIRED; SamsungChangePage(emptyList(), listOf("synthetic-id")) }
        assertFailsWith<SourceAccessException> { bridge.changes("sleep", token) }
        reader.state = SourceAvailability.AVAILABLE
        reader.onChanges = { SamsungChangePage(emptyList(), listOf("")) }
        assertFailsWith<IllegalArgumentException> { bridge.changes("sleep", token) }
        reader.onChanges = { SamsungChangePage(emptyList(), emptyList(), events = listOf(SamsungChangeEvent(deletedUid = "", changeTime = start))) }
        assertFailsWith<IllegalArgumentException> { bridge.changes("sleep", token) }
    }

    @Test fun deleteThenNewerUpsertKeepsNewestVendorChange() = runTest {
        val reader = FakeReader()
        val bridge = SamsungBridge(reader) { start.plusSeconds(10) }
        val updated = point().copy(updateTime = start.plusSeconds(2))
        // Deliberately reversed delivery order: the SDK does not promise event ordering.
        reader.onChanges = { SamsungChangePage(emptyList(), emptyList(), events = listOf(
            SamsungChangeEvent(point = updated, changeTime = start.plusSeconds(2)),
            SamsungChangeEvent(deletedUid = updated.uid, changeTime = start.plusSeconds(1)),
        )) }
        val result = bridge.changes("sleep", bridge.newToken("sleep"))
        assertEquals(SourceChange.Delete(updated.uid, start.plusSeconds(1).toString()), result.changes.first())
        assertEquals(updated.uid, assertIs<SourceChange.Upsert>(result.changes.last()).record.sourceUid)
        assertEquals(updated.updateTime.toString(), assertIs<SourceChange.Upsert>(result.changes.last()).record.sourceUpdatedAt)
    }

    @Test fun upsertThenNewerDeleteKeepsNewestVendorChange() = runTest {
        val reader = FakeReader()
        val bridge = SamsungBridge(reader) { start.plusSeconds(10) }
        reader.onChanges = { SamsungChangePage(emptyList(), emptyList(), events = listOf(
            SamsungChangeEvent(deletedUid = "synthetic-id", changeTime = start.plusSeconds(2)),
            SamsungChangeEvent(point = point(), changeTime = start.plusSeconds(1)),
        )) }
        val result = bridge.changes("sleep", bridge.newToken("sleep"))
        assertIs<SourceChange.Upsert>(result.changes.first())
        assertEquals(SourceChange.Delete("synthetic-id", start.plusSeconds(2).toString()), result.changes.last())
    }

    @Test fun sourceAdapterDelegatesVendorChangesWithoutMixingProviders() = runTest {
        val reader = FakeReader()
        val source = SamsungHealthSource(SamsungBridge(reader) { start })
        reader.onChanges = { SamsungChangePage(listOf(point()), listOf("synthetic-deleted-id")) }
        val changes = source.changes("sleep", source.newToken("sleep"))
        assertEquals("samsung_health", source.provider)
        assertEquals("samsung_health", assertIs<SourceChange.Upsert>(changes.changes.first()).record.provider)
        assertEquals(SourceChange.Delete("synthetic-deleted-id"), changes.changes.last())
    }
}
