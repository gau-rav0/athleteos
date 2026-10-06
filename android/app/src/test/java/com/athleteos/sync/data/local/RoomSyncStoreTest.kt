package com.athleteos.sync.data.local

import android.app.Application
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import com.athleteos.sync.domain.model.HealthRecord
import com.athleteos.sync.domain.repository.*
import java.time.Instant
import java.util.UUID
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.*
import kotlin.test.*
import org.junit.After
import org.junit.Before
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(application = Application::class, sdk = [33])
class RoomSyncStoreTest {
    private lateinit var db: HealthDatabase
    private lateinit var store: RoomSyncStore
    private val user = "synthetic-user"
    private fun record(value: Int = 1) = HealthRecord("health_connect", "steps", "synthetic-record",
        startTime = "2025-01-01T00:00:00Z", sourceZoneOffset = "+05:30", endZoneOffset = "+06:00", payload = buildJsonObject { put("count", value) })
    private suspend fun put(value: HealthRecord) = store.apply(user, value.provider, value.recordType, listOf(SourceChange.Upsert(value)), null, null)
    @Before fun setup() {
        db = Room.inMemoryDatabaseBuilder(ApplicationProvider.getApplicationContext(), HealthDatabase::class.java).allowMainThreadQueries().build()
        store = RoomSyncStore(db)
    }
    @After fun close() { db.close() }

    @Test fun duplicatesUpdatesAndRevisionSpecificAcknowledgements() = runTest {
        put(record()); put(record())
        assertEquals(1, db.dao().queueLength(user).first())
        val old = store.claim(user, 500)
        assertEquals(1L, old.single().revision)
        put(record(2)); store.acknowledge(user, old)
        val latest = store.claim(user, 500).single()
        assertEquals(2L, latest.revision)
        assertEquals(2, latest.record.payload["count"]?.jsonPrimitive?.int)
        assertEquals("+06:00", latest.record.endZoneOffset)
        store.acknowledge(user, listOf(latest)); assertEquals(0, db.dao().queueLength(user).first())
    }
    @Test fun failedAndUploadingRowsRecover() = runTest {
        put(record()); val batch = store.claim(user, 500)
        store.fail(user, batch, "UPLOAD_FAILED")
        assertEquals(1, db.dao().failedCount(user).first())
        store.recoverQueue(user); assertEquals(1, store.claim(user, 500).size)
        store.recoverQueue(user); assertEquals(1, store.claim(user, 500).size)
    }
    @Test fun olderIncrementalReplayCannotReplaceNewerSnapshot() = runTest {
        put(record(2).copy(sourceUpdatedAt = "2025-01-01T00:02:00Z"))
        put(record(1).copy(sourceUpdatedAt = "2025-01-01T00:01:00Z"))
        assertEquals(2, store.claim(user, 500).single().record.payload["count"]?.jsonPrimitive?.int)
    }
    @Test fun malformedRecordRetainedPrivatelyWithSafeCursor() = runTest {
        store.apply(user, "health_connect", "steps", listOf(SourceChange.Upsert(record().copy(startTime = "invalid"))), Checkpoint("synthetic-cursor"), null)
        assertEquals(1, db.dao().quarantineCount(user).first())
        assertEquals(0, db.dao().queueLength(user).first())
        assertEquals("synthetic-cursor", store.checkpoint(user, "health_connect", "steps")?.token)
    }
    @Test fun invalidDeletionRollsBackRecordsQueueAndCheckpointTogether() = runTest {
        assertFailsWith<IllegalArgumentException> {
            store.apply(user, "health_connect", "steps", listOf(SourceChange.Upsert(record()), SourceChange.Delete("")), Checkpoint("unsafe"), null)
        }
        assertEquals(0, db.dao().queueLength(user).first())
        assertNull(store.checkpoint(user, "health_connect", "steps"))
        assertTrue(store.knownIds(user, "health_connect", "steps").isEmpty())
    }
    @Test fun accountIsolationCoversRecordsQueueAndCheckpoints() = runTest {
        put(record()); store.apply(user, "health_connect", "steps", emptyList(), Checkpoint("private"), null)
        assertTrue(store.claim("other-user", 500).isEmpty())
        assertTrue(store.knownIds("other-user", "health_connect", "steps").isEmpty())
        assertNull(store.checkpoint("other-user", "health_connect", "steps"))
        assertEquals(0, db.dao().queueLength("other-user").first())
    }
    @Test fun latestTimestampOrdersFractionalSecondsChronologically() = runTest {
        put(record().copy(sourceUid = "whole-second", startTime = "2025-01-01T00:00:00Z"))
        put(record().copy(sourceUid = "fractional-second", startTime = "2025-01-01T00:00:00.500Z"))
        assertEquals(Instant.parse("2025-01-01T00:00:00.500Z"), Instant.parse(db.dao().summaries(user).first().single().latest))
    }
    @Test fun reconciliationOnlyDeletesWithinCompleteWindow() = runTest {
        put(record())
        val newerWindow = Snapshot(emptyList(), emptySet(), Instant.parse("2025-01-02T00:00:00Z"), Instant.parse("2025-01-03T00:00:00Z"))
        store.apply(user, "health_connect", "steps", emptyList(), null, newerWindow)
        assertFalse(store.claim(user, 500).single().record.deleted)
        val actualWindow = newerWindow.copy(from = Instant.parse("2024-12-31T00:00:00Z"))
        store.apply(user, "health_connect", "steps", emptyList(), null, actualWindow)
        assertTrue(store.claim(user, 500).single().record.deleted)
    }
    @Test fun windowWithoutAuthoritativeStartMembershipCannotInferDeletion() = runTest {
        put(record())
        val window = Snapshot(emptyList(), emptySet(), Instant.parse("2024-12-31T00:00:00Z"), Instant.parse("2025-01-03T00:00:00Z"), reconcileMissing = false)
        store.apply(user, "health_connect", "steps", emptyList(), Checkpoint("safe-window"), window)
        assertFalse(store.claim(user, 500).single().record.deleted)
        assertEquals("safe-window", store.checkpoint(user, "health_connect", "steps")?.token)
    }
    @Test fun authoritativeDeletionTimestampSurvivesWhileOriginalRecordMetadataIsPreserved() = runTest {
        put(record().copy(sourceUpdatedAt = "2025-01-01T00:01:00Z"))
        store.apply(user, "health_connect", "steps", listOf(SourceChange.Delete(record().sourceUid, "2025-01-01T00:02:00Z")), Checkpoint("deleted"), null)
        val deleted = store.claim(user, 500).single().record
        assertTrue(deleted.deleted)
        assertEquals("2025-01-01T00:02:00Z", deleted.sourceUpdatedAt)
        assertEquals(record().startTime, deleted.startTime)
        assertEquals(record().payload, deleted.payload)
    }
    @Test fun diskStoreSurvivesReopenWithInFlightQueue() = runTest {
        db.close()
        val context = ApplicationProvider.getApplicationContext<Application>()
        val name = "synthetic-${UUID.randomUUID()}.db"
        fun open() = Room.databaseBuilder(context, HealthDatabase::class.java, name).allowMainThreadQueries().build()
        db = open(); store = RoomSyncStore(db)
        put(record()); store.claim(user, 500)
        db.close(); db = open(); store = RoomSyncStore(db)
        store.recoverQueue(user)
        assertEquals(1, store.claim(user, 500).size)
        db.close(); context.deleteDatabase(name)
    }
}
