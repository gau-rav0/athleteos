package com.athleteos.sync

import com.athleteos.sync.domain.model.*
import com.athleteos.sync.domain.repository.*
import com.athleteos.sync.sync.SyncEngine
import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.*
import kotlin.test.*

private val NOW = Instant.parse("2025-01-15T12:00:00Z")
private fun sample(uid: String = "synthetic-id", value: Long = 1) = HealthRecord("health_connect", "steps", uid,
    startTime = NOW.minusSeconds(60).toString(), endTime = NOW.toString(), sourceZoneOffset = "+05:30",
    payload = buildJsonObject { put("count", value) })

/** Contract fake for orchestration tests; the production Room store is tested separately. */
private class MemoryStore : SyncStore {
    val records = mutableMapOf<String, QueuedRecord>()
    val queue = mutableMapOf<String, String>()
    val checkpoints = mutableMapOf<Triple<String, String, String>, Checkpoint>()
    val quarantine = mutableListOf<SourceChange.Quarantine>()
    val runs = mutableMapOf<String, SyncRun>()
    var rejectApply = false
    override suspend fun checkpoint(user: String, provider: String, type: String) = checkpoints[Triple(user, provider, type)]
    override suspend fun knownIds(user: String, provider: String, type: String) = records.values.filter { !it.record.deleted }.map { it.record.sourceUid }
    override suspend fun apply(user: String, provider: String, type: String, changes: List<SourceChange>, checkpoint: Checkpoint?, snapshot: Snapshot?) {
        if (rejectApply) error("DISK_FAILED")
        fun put(record: HealthRecord) {
            val id = record.identity(user)
            val old = records[id]
            if (old?.record == record) return
            records[id] = QueuedRecord(id, (old?.revision ?: 0) + 1, record, NOW.toString())
            queue[id] = "PENDING"
        }
        for (change in changes) when (change) {
            is SourceChange.Upsert -> try { change.record.validate(); put(change.record) }
                catch (_: IllegalArgumentException) { quarantine.add(SourceChange.Quarantine(change.record.sourceUid, change.record.payload.toString(), "INVALID_RECORD")) }
            is SourceChange.Delete -> put(records[HealthRecord(provider, type, change.sourceUid).identity(user)]?.record?.tombstone() ?: HealthRecord(provider, type, change.sourceUid, deleted = true))
            is SourceChange.Quarantine -> quarantine.add(change)
        }
        if (snapshot != null && snapshot.reconcileMissing) records.values.toList().filter { !it.record.deleted && it.record.startTime != null && Instant.parse(it.record.startTime) >= snapshot.from && Instant.parse(it.record.startTime) < snapshot.until && it.record.sourceUid !in snapshot.seenIds }.forEach { put(it.record.tombstone()) }
        if (checkpoint != null) checkpoints[Triple(user, provider, type)] = checkpoint
    }
    override suspend fun recoverQueue(user: String) { queue.keys.toList().forEach { queue[it] = "PENDING" } }
    override suspend fun claim(user: String, limit: Int): List<QueuedRecord> = queue.filterValues { it == "PENDING" }.keys.take(limit).map { id -> queue[id] = "UPLOADING"; records.getValue(id) }
    override suspend fun acknowledge(user: String, batch: List<QueuedRecord>) { batch.forEach { if (records[it.id]?.revision == it.revision) queue.remove(it.id) } }
    override suspend fun fail(user: String, batch: List<QueuedRecord>, code: String) { batch.forEach { if (records[it.id]?.revision == it.revision) queue[it.id] = "FAILED" } }
    override suspend fun retryFailed(user: String) = recoverQueue(user)
    override suspend fun addRun(user: String, run: SyncRun) { runs[run.id] = run }
    override suspend fun pendingRuns(user: String) = runs.values.toList()
    override suspend fun acknowledgeRuns(user: String, ids: List<String>) { ids.forEach { runs.remove(it) } }
}

private class FakeSource(var data: List<HealthRecord> = listOf(sample())) : HealthDataSource {
    override val provider = "health_connect"
    override val recordTypes = setOf("steps")
    var pages = ArrayDeque<ChangePage>()
    var access = SourceAvailability.AVAILABLE
    var snapshotFails = false
    var failAfterFirstPage = false
    var tokenCount = 0
    var tokenHook: () -> Unit = {}
    val windows = mutableListOf<Instant>()
    val events = mutableListOf<String>()
    override suspend fun availability(type: String, background: Boolean) = access
    override suspend fun newToken(type: String): String { events.add("token"); tokenHook(); return "fresh-${++tokenCount}" }
    override suspend fun changes(type: String, token: String) = if (pages.isEmpty()) ChangePage(emptyList(), "$token-next") else pages.removeFirst()
    override suspend fun snapshot(type: String, from: Instant, until: Instant): Snapshot {
        events.add("snapshot"); windows.add(from)
        if (snapshotFails) error("READ_FAILED")
        val records = data.filter { Instant.parse(it.startTime) >= from && Instant.parse(it.startTime) < until }
        return Snapshot(records.map { SourceChange.Upsert(it) }, records.map { it.sourceUid }.toSet(), from, until)
    }
    override suspend fun streamSnapshot(type: String, from: Instant, until: Instant, consume: suspend (List<SourceChange>) -> Unit): Snapshot {
        if (failAfterFirstPage) {
            consume(data.take(1).map { SourceChange.Upsert(it) })
            error("SECOND_PAGE_FAILED")
        }
        return super.streamSnapshot(type, from, until, consume)
    }
    override suspend fun inspectKnown(type: String, sourceUids: List<String>) = sourceUids.filterNot { uid -> data.any { it.sourceUid == uid } }.map { SourceChange.Delete(it) }
}
private class FakeUpload(private val store: MemoryStore) : UploadClient {
    var fail = false
    val batches = mutableListOf<Int>()
    val uploaded = mutableListOf<HealthRecord>()
    override suspend fun upload(user: String, batch: List<QueuedRecord>, runs: List<SyncRun>) {
        batch.forEach { check(store.records.containsKey(it.id)) } // Raw store precedes network.
        if (fail) error("NETWORK_OFFLINE")
        if (batch.isNotEmpty()) batches.add(batch.size)
        uploaded.addAll(batch.map { it.record })
    }
}

class ReliabilityTest {
    @Test fun failedSnapshotPageKeepsPersistedRecordsWithoutAdvancingCheckpointOrInferringDeletion() = runTest {
        val store = MemoryStore()
        store.apply("u", "health_connect", "steps", listOf(SourceChange.Upsert(sample("existing"))), null, null)
        val source = FakeSource(listOf(sample("first-page"))).apply { failAfterFirstPage = true }
        engine(source, store, FakeUpload(store)).run("u")
        assertEquals(setOf("existing", "first-page"), store.records.values.map { it.record.sourceUid }.toSet())
        assertTrue(store.records.values.none { it.record.deleted })
        assertTrue(store.checkpoints.isEmpty())
    }
    @Test fun foregroundSyncDoesNotProcessRecordsOnTheCallingThread() = runTest {
        val caller = Thread.currentThread()
        val source = FakeSource()
        var processingThread: Thread? = null
        source.tokenHook = { processingThread = Thread.currentThread() }
        val store = MemoryStore()
        engine(source, store, FakeUpload(store)).run("synthetic-user")
        assertNotNull(processingThread)
        assertNotSame(caller, processingThread)
    }
    @Test fun undatedHistoricalConfigurationKeepsRawSemanticsWithoutAllowingUndatedLiveMetrics() {
        HealthRecord("samsung_health", "training_load_goal", "synthetic-goal", ingestionOrigin = "historical").validate()
        assertFailsWith<IllegalArgumentException> { HealthRecord("samsung_health", "steps", "synthetic", ingestionOrigin = "historical").validate() }
        assertFailsWith<IllegalArgumentException> { HealthRecord("samsung_health", "vendor_raw", "synthetic").validate() }
        assertFailsWith<IllegalArgumentException> { sample().copy(sourcePriority = 301).validate() }
        assertFailsWith<IllegalArgumentException> { sample().copy(recordType = "hrv_rmssd", provider = "samsung_health").validate() }
    }
    private fun engine(source: FakeSource, store: MemoryStore, upload: FakeUpload) = SyncEngine(listOf(source), store, upload, Clock.fixed(NOW, ZoneOffset.UTC))
    @Test fun normalizedIdentityIsStableAndSeparatesProvidersAccountsAndDelimitedFields() {
        assertEquals(sample().identity("a"), sample().copy(startTime = NOW.toString()).identity("a"))
        assertNotEquals(sample().identity("a"), sample().identity("b"))
        assertNotEquals(sample().identity("a"), sample().copy(provider = "samsung_health").identity("a"))
        assertNotEquals(HealthRecord("health_connect", "steps", "bc").identity("a"), HealthRecord("health_connect", "steps", "c").identity("ab"))
    }
    @Test fun utcAndOffsetsArePreservedIncludingCrossDayAndDst() {
        assertEquals("2025-01-01T18:45:00Z", HealthRecord.utc("2025-01-02T00:15:00+05:30"))
        assertEquals("+05:30", HealthRecord.offset("2025-01-02T00:15:00+05:30"))
        assertNotEquals(HealthRecord.utc("2025-11-02T01:30:00-04:00"), HealthRecord.utc("2025-11-02T01:30:00-05:00"))
    }
    @Test fun duplicatesAreIdempotentAndSourceUpdatesAdvanceRevision() = runTest {
        val store = MemoryStore()
        store.apply("u", "health_connect", "steps", listOf(SourceChange.Upsert(sample())), null, null)
        store.apply("u", "health_connect", "steps", listOf(SourceChange.Upsert(sample())), null, null)
        assertEquals(1, store.records.size); assertEquals(1L, store.records.values.single().revision)
        store.apply("u", "health_connect", "steps", listOf(SourceChange.Upsert(sample(value = 2))), null, null)
        assertEquals(2L, store.records.values.single().revision)
    }
    @Test fun uploadRetriesKeepRawRecordsAndSafelyAdvanceDurableLocalCursor() = runTest {
        val store = MemoryStore(); val source = FakeSource(); val upload = FakeUpload(store)
        upload.fail = true
        val engine = engine(source, store, upload)
        assertTrue(engine.run("u").retryable)
        assertEquals("FAILED", store.queue.values.single())
        assertNotNull(store.checkpoint("u", "health_connect", "steps"))
        upload.fail = false
        assertEquals("SUCCESS", engine.run("u").status)
        assertTrue(store.queue.isEmpty()); assertEquals(1, store.records.size)
    }
    @Test fun batchingNeverExceeds500() = runTest {
        val store = MemoryStore(); val source = FakeSource((1..1001).map { sample("synthetic-$it") }); val upload = FakeUpload(store)
        engine(source, store, upload).run("u")
        assertEquals(listOf(500, 500, 1), upload.batches)
    }
    @Test fun checkpointNeverAdvancesWhenPersistenceFails() = runTest {
        val store = MemoryStore(); store.rejectApply = true
        val source = FakeSource(); val upload = FakeUpload(store)
        engine(source, store, upload).run("u")
        assertNull(store.checkpoint("u", "health_connect", "steps")); assertTrue(store.records.isEmpty())
        assertEquals(listOf("token", "snapshot"), source.events)
    }
    @Test fun failedReconciliationCannotTombstoneLocalData() = runTest {
        val store = MemoryStore(); val source = FakeSource(); val upload = FakeUpload(store)
        val engine = engine(source, store, upload)
        engine.run("u"); source.data = emptyList(); source.snapshotFails = true
        engine.run("u")
        assertFalse(store.records.values.single().record.deleted)
    }
    @Test fun completeReconciliationPropagatesDeletion() = runTest {
        val store = MemoryStore(); val source = FakeSource(); val upload = FakeUpload(store)
        val engine = engine(source, store, upload)
        engine.run("u"); source.data = emptyList(); engine.run("u")
        assertTrue(store.records.values.single().record.deleted)
        assertTrue(upload.uploaded.last().deleted)
    }
    @Test fun expiredTokenReconcilesKnownIdsAndFreshCursor() = runTest {
        val store = MemoryStore(); val source = FakeSource(); val upload = FakeUpload(store)
        val engine = engine(source, store, upload)
        engine.run("u"); source.data = emptyList()
        source.pages.add(ChangePage(emptyList(), "expired", expired = true))
        engine.run("u")
        assertEquals(2, source.tokenCount)
        assertTrue(store.records.values.single().record.deleted)
        assertTrue(store.checkpoint("u", "health_connect", "steps")!!.token.startsWith("fresh-2"))
    }
    @Test fun revocationPreservesCursorAndQueue() = runTest {
        val store = MemoryStore(); val source = FakeSource(); val upload = FakeUpload(store)
        val engine = engine(source, store, upload)
        engine.run("u"); val checkpoint = store.checkpoint("u", "health_connect", "steps")
        source.access = SourceAvailability.PERMISSION_REQUIRED
        assertEquals("PARTIAL_FAILURE", engine.run("u").status)
        assertEquals(checkpoint, store.checkpoint("u", "health_connect", "steps"))
    }
    @Test fun oldUploadAcknowledgementCannotEraseNewEdit() = runTest {
        val store = MemoryStore()
        store.apply("u", "health_connect", "steps", listOf(SourceChange.Upsert(sample())), null, null)
        val batch = store.claim("u", 500)
        store.apply("u", "health_connect", "steps", listOf(SourceChange.Upsert(sample(value = 2))), null, null)
        store.acknowledge("u", batch)
        assertEquals("PENDING", store.queue.values.single())
    }
    @Test fun inFlightQueueRecoversAfterInterruption() = runTest {
        val store = MemoryStore()
        store.apply("u", "health_connect", "steps", listOf(SourceChange.Upsert(sample())), null, null)
        store.claim("u", 500); assertEquals("UPLOADING", store.queue.values.single())
        store.recoverQueue("u"); assertEquals(1, store.claim("u", 500).size)
    }
    @Test fun malformedRecordsAreQuarantinedBeforeCheckpointAdvances() = runTest {
        val store = MemoryStore()
        store.apply("u", "health_connect", "steps", listOf(SourceChange.Upsert(sample().copy(startTime = null))), Checkpoint("safe"), null)
        assertEquals(1, store.quarantine.size); assertTrue(store.queue.isEmpty())
        assertEquals("safe", store.checkpoint("u", "health_connect", "steps")?.token)
    }
    @Test fun dailySevenDayThenNormal72HourWindows() = runTest {
        val store = MemoryStore(); val source = FakeSource(); val upload = FakeUpload(store)
        val engine = engine(source, store, upload)
        engine.run("u"); engine.run("u"); engine.run("u", sevenDays = true)
        assertEquals(listOf(Instant.EPOCH, NOW.minusSeconds(7 * 86400), NOW.minusSeconds(72 * 3600), NOW.minusSeconds(7 * 86400)), source.windows)
    }
    @Test fun unsupportedCapabilitiesDoNotPreventSuccessfulAvailableSourceSync() = runTest {
        val store = MemoryStore(); val source = FakeSource(); val upload = FakeUpload(store)
        val unsupported = object : HealthDataSource by source {
            override val provider = "samsung_health"
            override suspend fun availability(type: String, background: Boolean) = SourceAvailability.UNSUPPORTED
        }
        val result = SyncEngine(listOf(source, unsupported), store, upload, Clock.fixed(NOW, ZoneOffset.UTC)).run("u")
        assertEquals("SUCCESS", result.status)
        assertEquals(0, result.failures)
        assertEquals(1, store.records.size)
        assertNull(store.checkpoint("u", "samsung_health", "steps"))
    }
    @Test fun bootstrapSnapshotIncludesRecordsCreatedBeforeTheFreshCursorWasObtained() = runTest {
        var current = NOW
        val clock = object : Clock() {
            override fun getZone() = ZoneOffset.UTC
            override fun withZone(zone: java.time.ZoneId): Clock = this
            override fun instant() = current
        }
        val gapRecord = sample("synthetic-bootstrap-gap").copy(startTime = NOW.plusSeconds(1).toString(), endTime = NOW.plusSeconds(2).toString())
        val source = FakeSource(listOf(gapRecord))
        source.tokenHook = { current = NOW.plusSeconds(2) }
        val store = MemoryStore(); val upload = FakeUpload(store)
        assertEquals("SUCCESS", SyncEngine(listOf(source), store, upload, clock).run("u").status)
        assertEquals("synthetic-bootstrap-gap", store.records.values.single().record.sourceUid)
        assertFalse(store.records.values.single().record.deleted)
        assertTrue(store.queue.isEmpty())
    }
    @Test fun sourcePriorityIsMetadataOnlyAndNeverInventsHrv() {
        assertEquals(0, SourcePolicy.priority("samsung_health", "steps", "watch"))
        assertTrue(SourcePolicy.priority("samsung_health", "sleep") > SourcePolicy.priority("health_connect", "sleep"))
        assertTrue(SourcePolicy.priority("samsung_health", "heart_rate", "watch") > SourcePolicy.priority("samsung_health", "heart_rate", "phone"))
        assertEquals(200, SourcePolicy.priority("samsung_health", "heart_rate", "MOBILE"))
        assertEquals(0, SourcePolicy.priority("samsung_health", "hrv_rmssd"))
        assertEquals(100, SourcePolicy.priority("health_connect", "hrv_rmssd"))
    }
}
