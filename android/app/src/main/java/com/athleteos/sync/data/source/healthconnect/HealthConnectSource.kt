package com.athleteos.sync.data.source.healthconnect

import android.content.Context
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.HealthConnectFeatures
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.request.ChangesTokenRequest
import androidx.health.connect.client.request.ReadRecordsRequest
import androidx.health.connect.client.time.TimeRangeFilter
import com.athleteos.sync.domain.repository.*
import java.time.Duration
import java.time.Instant

class HealthConnectSource(private val context: Context, private val injectedClient: HealthConnectClient? = null) : HealthDataSource {
    override val provider = "health_connect"
    override val recordTypes = HealthConnectMapper.types.keys
    private fun client() = injectedClient ?: HealthConnectClient.getOrCreate(context)
    fun sdkStatus(): Int = HealthConnectClient.getSdkStatus(context)
    private fun feature(id: Int): Boolean = client().features.getFeatureStatus(id) == HealthConnectFeatures.FEATURE_STATUS_AVAILABLE

    suspend fun permissionsToRequest(): Set<String> {
        if (sdkStatus() != HealthConnectClient.SDK_AVAILABLE) return emptySet()
        return buildSet {
            addAll(HealthConnectMapper.types.values.map { HealthPermission.getReadPermission(it) })
            if (feature(HealthConnectFeatures.FEATURE_READ_HEALTH_DATA_IN_BACKGROUND)) add(HealthPermission.PERMISSION_READ_HEALTH_DATA_IN_BACKGROUND)
            if (feature(HealthConnectFeatures.FEATURE_READ_HEALTH_DATA_HISTORY)) add(HealthPermission.PERMISSION_READ_HEALTH_DATA_HISTORY)
        }
    }
    suspend fun grantedPermissions(): Set<String> = if (sdkStatus() == HealthConnectClient.SDK_AVAILABLE) client().permissionController.getGrantedPermissions() else emptySet()

    override suspend fun availability(type: String, background: Boolean): SourceAvailability {
        if (sdkStatus() != HealthConnectClient.SDK_AVAILABLE || type !in recordTypes) return SourceAvailability.UNSUPPORTED
        val permissions = grantedPermissions()
        if (HealthPermission.getReadPermission(HealthConnectMapper.types.getValue(type)) !in permissions) return SourceAvailability.PERMISSION_REQUIRED
        if (background && (!feature(HealthConnectFeatures.FEATURE_READ_HEALTH_DATA_IN_BACKGROUND) || HealthPermission.PERMISSION_READ_HEALTH_DATA_IN_BACKGROUND !in permissions)) return SourceAvailability.PERMISSION_REQUIRED
        return SourceAvailability.AVAILABLE
    }
    private suspend fun requirePermission(type: String) {
        if (availability(type, false) != SourceAvailability.AVAILABLE) throw SecurityException("READ_PERMISSION_REQUIRED")
    }
    override suspend fun newToken(type: String): String {
        requirePermission(type)
        return client().getChangesToken(ChangesTokenRequest(setOf(HealthConnectMapper.types.getValue(type))))
    }
    override suspend fun changes(type: String, token: String): ChangePage {
        requirePermission(type)
        val response = client().getChanges(token)
        requirePermission(type)
        return ChangePage(response.changes.map { HealthConnectMapper.change(type, it) }, response.nextChangesToken, response.hasMore, response.changesTokenExpired)
    }

    override suspend fun snapshot(type: String, from: Instant, until: Instant): Snapshot {
        requirePermission(type)
        val history = HealthPermission.PERMISSION_READ_HEALTH_DATA_HISTORY in grantedPermissions()
        // Conservatively stay within the default access interval when history is unavailable.
        val actualFrom = if (history) from else maxOf(from, Instant.now().minus(Duration.ofDays(29)))
        if (actualFrom >= until) return Snapshot(emptyList(), emptySet(), actualFrom, until)
        val result = mutableListOf<SourceChange>()
        val seen = mutableSetOf<String>()
        var token: String? = null
        do {
            val response = client().readRecords(ReadRecordsRequest(HealthConnectMapper.types.getValue(type),
                TimeRangeFilter.between(actualFrom, until), pageSize = 500, pageToken = token))
            for (record in response.records) {
                seen.add(record.metadata.id) // Even quarantined records are present, not deletions.
                result.add(HealthConnectMapper.record(type, record))
            }
            val next = response.pageToken
            check(next == null || next != token) { "NON_ADVANCING_PAGE" }
            token = next
        } while (token != null)
        requirePermission(type)
        if (history && HealthPermission.PERMISSION_READ_HEALTH_DATA_HISTORY !in grantedPermissions()) throw SecurityException("HISTORY_REVOKED")
        return Snapshot(result, seen, actualFrom, until)
    }

    override suspend fun inspectKnown(type: String, sourceUids: List<String>): List<SourceChange> {
        if (sourceUids.isEmpty()) return emptyList()
        val snapshot = snapshot(type, Instant.EPOCH, Instant.now())
        val missing = sourceUids.filterNot { it in snapshot.seenIds }
        // IPC/IO exceptions on read-by-ID cannot distinguish deletion from permission/access failures.
        // Require a complete historical snapshot before inferring old deletions after cursor expiry.
        if (missing.isNotEmpty() && HealthPermission.PERMISSION_READ_HEALTH_DATA_HISTORY !in grantedPermissions()) {
            throw SourceAccessException(SourceAccessProblem.HISTORY_REQUIRED_FOR_TOKEN_RESET)
        }
        return snapshot.changes + missing.map { SourceChange.Delete(it) }
    }
}
