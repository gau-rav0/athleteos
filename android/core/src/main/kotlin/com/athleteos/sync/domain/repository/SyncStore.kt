package com.athleteos.sync.domain.repository

import com.athleteos.sync.domain.model.HealthRecord
import java.time.Instant
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

data class QueuedRecord(val id: String, val revision: Long, val record: HealthRecord, val observedAt: String)
data class Checkpoint(val token: String, val dailyReconciledAt: Instant? = null)
@Serializable
data class SyncRun(
    val id: String,
    @SerialName("started_at") val startedAt: String,
    @SerialName("finished_at") val finishedAt: String,
    val status: String,
    @SerialName("records_read") val recordsRead: Int,
    @SerialName("records_failed") val recordsFailed: Int,
    @SerialName("error_code") val errorCode: String? = null,
    @SerialName("source_results") val sourceResults: Map<String, String> = emptyMap(),
)

interface SyncStore {
    suspend fun checkpoint(user: String, provider: String, type: String): Checkpoint?
    suspend fun knownIds(user: String, provider: String, type: String): List<String>
    suspend fun quarantinedIds(user: String, provider: String, type: String): List<String> = emptyList()
    /** Atomic: records + queue + quarantine + checkpoint. Throw/rollback on persistence failure. */
    suspend fun apply(user: String, provider: String, type: String, changes: List<SourceChange>, checkpoint: Checkpoint? = null, snapshot: Snapshot? = null)
    suspend fun recoverQueue(user: String)
    suspend fun claim(user: String, limit: Int): List<QueuedRecord>
    suspend fun acknowledge(user: String, batch: List<QueuedRecord>)
    suspend fun fail(user: String, batch: List<QueuedRecord>, code: String)
    suspend fun retryFailed(user: String)
    suspend fun addRun(user: String, run: SyncRun)
    suspend fun pendingRuns(user: String): List<SyncRun>
    suspend fun acknowledgeRuns(user: String, ids: List<String>)
}
interface UploadClient {
    /** Success means an atomic server transaction acknowledged every submitted record and run. */
    suspend fun upload(user: String, batch: List<QueuedRecord>, runs: List<SyncRun>)
}
