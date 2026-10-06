package com.athleteos.sync.sync

import com.athleteos.sync.domain.repository.*
import java.time.Clock
import java.time.Duration
import java.time.Instant
import java.util.UUID
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

data class SyncResult(val status: String, val recordsRead: Int, val failures: Int, val retryable: Boolean = false)

class SyncEngine(
    private val sources: List<HealthDataSource>,
    private val store: SyncStore,
    private val client: UploadClient,
    private val clock: Clock = Clock.systemUTC(),
) {
    private val mutex = Mutex()

    suspend fun run(user: String, background: Boolean = false, sevenDays: Boolean = false): SyncResult = mutex.withLock {
        require(user.isNotBlank())
        val started = clock.instant()
        var read = 0
        var failures = 0
        var lastCode: String? = null
        var retryable = false
        val sourceResults = mutableMapOf<String, String>()
        fun safe(changes: List<SourceChange>): List<SourceChange> = changes.map { change ->
            val checked = if (change is SourceChange.Upsert) {
                try { change.record.validate(); change }
                catch (_: IllegalArgumentException) { SourceChange.Quarantine(change.record.sourceUid, Json.encodeToString(change.record), "INVALID_RECORD") }
            } else change
            if (checked is SourceChange.Quarantine) { failures++; lastCode = "QUARANTINED" }
            checked
        }
        store.recoverQueue(user)
        for (source in sources) for (type in source.recordTypes) {
            val sourceKey = "${source.provider}:$type"
            val failuresBefore = failures
            try {
                val available = source.availability(type, background)
                if (available != SourceAvailability.AVAILABLE) {
                    // Missing Samsung SDK is an explicit blocker; other sources still run.
                    failures++
                    lastCode = available.name
                    sourceResults[sourceKey] = available.name
                    continue
                }
                var checkpoint = store.checkpoint(user, source.provider, type)
                if (checkpoint == null) {
                    // Create cursor BEFORE snapshot so updates during bootstrap are replayed.
                    val token = source.newToken(type)
                    val snapshot = source.snapshot(type, Instant.EPOCH, started)
                    read += snapshot.changes.size
                    checkpoint = Checkpoint(token)
                    store.apply(user, source.provider, type, safe(snapshot.changes), checkpoint, snapshot)
                }
                var more: Boolean
                var resets = 0
                do {
                    val page = source.changes(type, checkpoint!!.token)
                    if (page.expired) {
                        check(++resets <= 1) { "REPEATED_TOKEN_EXPIRY" }
                        val token = source.newToken(type)
                        val known = source.inspectKnown(type, store.knownIds(user, source.provider, type))
                        val snapshot = source.snapshot(type, Instant.EPOCH, started)
                        read += known.size + snapshot.changes.size
                        checkpoint = Checkpoint(token, checkpoint.dailyReconciledAt)
                        store.apply(user, source.provider, type, safe(known + snapshot.changes), checkpoint, snapshot)
                        more = true
                    } else {
                        require(page.nextToken != checkpoint.token || !page.hasMore) { "NON_ADVANCING_CURSOR" }
                        read += page.changes.size
                        checkpoint = checkpoint.copy(token = page.nextToken)
                        store.apply(user, source.provider, type, safe(page.changes), checkpoint)
                        more = page.hasMore
                    }
                } while (more)
                val daily = sevenDays || checkpoint!!.dailyReconciledAt == null ||
                    Duration.between(checkpoint.dailyReconciledAt, started) >= Duration.ofDays(1)
                val window = started.minus(Duration.ofHours(if (daily) 168 else 72))
                val snapshot = source.snapshot(type, window, started)
                read += snapshot.changes.size
                checkpoint = checkpoint.copy(dailyReconciledAt = if (daily) started else checkpoint.dailyReconciledAt)
                store.apply(user, source.provider, type, safe(snapshot.changes), checkpoint, snapshot)
                sourceResults[sourceKey] = if (failures == failuresBefore) "SUCCESS" else "QUARANTINED"
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (denied: SourceAccessException) {
                failures++
                lastCode = denied.problem.name
                sourceResults[sourceKey] = denied.problem.name
            } catch (_: SecurityException) {
                failures++
                lastCode = "PERMISSION_REVOKED"
                sourceResults[sourceKey] = "PERMISSION_REVOKED"
            } catch (_: Exception) {
                failures++
                lastCode = "SOURCE_FAILED" // Never record exception text: vendors may include health values.
                retryable = true
                sourceResults[sourceKey] = "SOURCE_FAILED"
            }
        }
        try {
            while (true) {
                val batch = store.claim(user, 500)
                if (batch.isEmpty()) break
                try {
                    client.upload(user, batch, emptyList())
                    store.acknowledge(user, batch)
                } catch (cancelled: CancellationException) {
                    throw cancelled // UPLOADING is recovered on the next run.
                } catch (_: Exception) {
                    store.fail(user, batch, "UPLOAD_FAILED")
                    throw IllegalStateException("UPLOAD_FAILED")
                }
            }
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (_: Exception) {
            failures++
            lastCode = "UPLOAD_FAILED"
            retryable = true
        }
        val status = if (failures == 0) "SUCCESS" else "PARTIAL_FAILURE"
        val run = SyncRun(UUID.randomUUID().toString(), started.toString(), clock.instant().toString(), status, read, failures, lastCode, sourceResults)
        store.addRun(user, run)
        try {
            val runs = store.pendingRuns(user)
            if (runs.isNotEmpty()) {
                client.upload(user, emptyList(), runs)
                store.acknowledgeRuns(user, runs.map { it.id })
            }
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (_: Exception) {
            failures++
            retryable = true
            store.addRun(user, run.copy(status = "PARTIAL_FAILURE", recordsFailed = failures, errorCode = "RUN_UPLOAD_FAILED"))
        }
        SyncResult(if (failures == 0) "SUCCESS" else "PARTIAL_FAILURE", read, failures, retryable)
    }
}
