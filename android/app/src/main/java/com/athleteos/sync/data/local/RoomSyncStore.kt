package com.athleteos.sync.data.local

import androidx.room.withTransaction
import com.athleteos.sync.domain.model.HealthRecord
import com.athleteos.sync.domain.repository.*
import java.time.Instant
import java.time.format.DateTimeFormatterBuilder
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

class RoomSyncStore(private val db: HealthDatabase) : SyncStore {
    private val dao = db.dao()
    private val json = Json { encodeDefaults = true }
    // Fixed fractional precision makes indexed ISO UTC strings sort chronologically on API 29 SQLite.
    // The canonical envelope retains the source's original timestamp representation independently.
    private val indexedTime = DateTimeFormatterBuilder().appendInstant(9).toFormatter()
    private fun utcIndex(value: String?) = value?.let { indexedTime.format(Instant.parse(it)) }

    override suspend fun checkpoint(user: String, provider: String, type: String) = dao.checkpoint(user, provider, type)?.let {
        Checkpoint(it.token, it.dailyReconciledAt?.let(Instant::parse))
    }
    override suspend fun knownIds(user: String, provider: String, type: String) = dao.records(user, provider, type).filterNot { it.deleted }.map { it.sourceRecordId }

    override suspend fun apply(user: String, provider: String, type: String, changes: List<SourceChange>, checkpoint: Checkpoint?, snapshot: Snapshot?) = db.withTransaction {
        for (change in changes) when (change) {
            is SourceChange.Upsert -> {
                require(change.record.provider == provider && change.record.recordType == type)
                try {
                    change.record.validate()
                    upsert(user, change.record)
                } catch (_: IllegalArgumentException) {
                    quarantine(user, provider, type, change.record.sourceUid, json.encodeToString(change.record), "INVALID_RECORD")
                }
            }
            is SourceChange.Delete -> {
                val old = dao.record(user, HealthRecord(provider, type, change.sourceUid).identity(user))
                val record = old?.let { json.decodeFromString<HealthRecord>(it.payloadJson).tombstone() }
                    ?: HealthRecord(provider, type, change.sourceUid, deleted = true)
                record.validate()
                upsert(user, record)
            }
            is SourceChange.Quarantine -> quarantine(user, provider, type, change.sourceUid, change.payload, change.reason)
        }
        if (snapshot != null) {
            for (old in dao.records(user, provider, type)) {
                // Use start time membership, matching Health Connect's interval start filter.
                val time = old.startTimeUtc?.let(Instant::parse) ?: continue
                if (!old.deleted && time >= snapshot.from && time < snapshot.until && old.sourceRecordId !in snapshot.seenIds) {
                    upsert(user, json.decodeFromString<HealthRecord>(old.payloadJson).tombstone())
                }
            }
        }
        if (checkpoint != null) dao.putCheckpoint(SyncCheckpointEntity(user, provider, type, checkpoint.token, checkpoint.dailyReconciledAt?.toString()))
    }

    private suspend fun quarantine(user: String, provider: String, type: String, uid: String, payload: String, reason: String) {
        val id = HealthRecord.digest("$user:$provider:$type:$uid:$payload")
        dao.putQuarantine(QuarantineEntity(id, user, provider, type, uid, payload, reason.takeIf { it.matches(Regex("[A-Z_]{1,64}")) } ?: "INVALID_RECORD"))
    }

    private suspend fun upsert(user: String, record: HealthRecord) {
        val id = record.identity(user)
        val encoded = json.encodeToString(record)
        val old = dao.record(user, id)
        if (old?.payloadJson == encoded) return
        if (!record.deleted && old?.sourceUpdatedAt != null && record.sourceUpdatedAt != null &&
            Instant.parse(record.sourceUpdatedAt) < Instant.parse(old.sourceUpdatedAt)) return
        val revision = (old?.revision ?: 0) + 1
        dao.putRecord(RawHealthRecordEntity(id, user, record.provider, record.recordType, record.sourceUid, record.sourcePackage,
            record.sourceDeviceId, utcIndex(record.startTime), utcIndex(record.endTime), record.sourceZoneOffset, record.sourceCreatedAt,
            record.sourceUpdatedAt, record.schemaVersion, encoded, record.deleted, "PENDING", revision, Instant.now().toString()))
        dao.putQueue(UploadQueueEntity(id, user, revision))
    }

    override suspend fun recoverQueue(user: String) = db.withTransaction { dao.recover(user); dao.recoverRecords(user) }
    override suspend fun retryFailed(user: String) = recoverQueue(user)
    override suspend fun claim(user: String, limit: Int): List<QueuedRecord> = db.withTransaction {
        require(limit in 1..500)
        dao.pending(user, limit).map { item ->
            val record = requireNotNull(dao.record(user, item.recordId))
            check(record.revision == item.revision)
            dao.queueState(user, item.recordId, item.revision, "UPLOADING", 1)
            dao.recordState(user, item.recordId, item.revision, "UPLOADING")
            QueuedRecord(item.recordId, item.revision, json.decodeFromString(record.payloadJson), record.observedAt)
        }
    }
    override suspend fun acknowledge(user: String, batch: List<QueuedRecord>) = db.withTransaction {
        for (item in batch) {
            dao.recordState(user, item.id, item.revision, "SYNCED")
            dao.deleteQueue(user, item.id, item.revision)
        }
    }
    override suspend fun fail(user: String, batch: List<QueuedRecord>, code: String) = db.withTransaction {
        for (item in batch) {
            dao.queueState(user, item.id, item.revision, "FAILED", code = code)
            dao.recordState(user, item.id, item.revision, "FAILED")
        }
    }
    override suspend fun addRun(user: String, run: SyncRun) = dao.putRun(SyncRunEntity(run.id, user, run.startedAt, run.finishedAt, run.status, run.recordsRead, run.recordsFailed, run.errorCode, sourceResultsJson = json.encodeToString(run.sourceResults)))
    override suspend fun pendingRuns(user: String) = dao.pendingRuns(user).map { SyncRun(it.id, it.startedAt, it.finishedAt, it.status, it.recordsRead, it.recordsFailed, it.errorCode, json.decodeFromString(it.sourceResultsJson)) }
    override suspend fun acknowledgeRuns(user: String, ids: List<String>) = dao.acknowledgeRuns(user, ids)
}
