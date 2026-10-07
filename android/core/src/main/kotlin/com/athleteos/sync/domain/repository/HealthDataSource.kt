package com.athleteos.sync.domain.repository

import com.athleteos.sync.domain.model.HealthRecord
import java.time.Instant

sealed interface SourceChange {
    data class Upsert(val record: HealthRecord) : SourceChange
    data class Delete(val sourceUid: String, val sourceUpdatedAt: String? = null) : SourceChange
    /** Persist privately before allowing a cursor to advance. No payload in diagnostic messages. */
    data class Quarantine(val sourceUid: String, val payload: String, val reason: String) : SourceChange
}
data class ChangePage(val changes: List<SourceChange>, val nextToken: String, val hasMore: Boolean = false, val expired: Boolean = false)
data class Snapshot(val changes: List<SourceChange>, val seenIds: Set<String>, val from: Instant, val until: Instant, val reconcileMissing: Boolean = true)
enum class SourceAvailability { AVAILABLE, PERMISSION_REQUIRED, UNSUPPORTED, SDK_MISSING, SDK_BRIDGE_REQUIRED, PLATFORM_MISSING, PLATFORM_UPDATE_REQUIRED, PLATFORM_UNAVAILABLE }
enum class SourceAccessProblem { PERMISSION_REVOKED, HISTORY_REQUIRED_FOR_TOKEN_RESET }
class SourceAccessException(val problem: SourceAccessProblem) : SecurityException(problem.name)

interface HealthDataSource {
    val provider: String
    val recordTypes: Set<String>
    suspend fun availability(type: String, background: Boolean): SourceAvailability
    suspend fun newToken(type: String): String
    suspend fun changes(type: String, token: String): ChangePage
    /** All pages must succeed and permissions must remain granted before returning a complete snapshot. */
    suspend fun snapshot(type: String, from: Instant, until: Instant): Snapshot
    /** Persist pages without advancing the checkpoint; reconcile only after all pages succeed. */
    suspend fun streamSnapshot(type: String, from: Instant, until: Instant, consume: suspend (List<SourceChange>) -> Unit): Snapshot {
        val snapshot = snapshot(type, from, until)
        consume(snapshot.changes)
        return snapshot.copy(changes = emptyList())
    }
    /** Reset reconciles previously observed records even when they are outside the readable time window. */
    suspend fun inspectKnown(type: String, sourceUids: List<String>): List<SourceChange>
}
