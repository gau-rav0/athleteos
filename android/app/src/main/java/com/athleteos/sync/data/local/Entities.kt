package com.athleteos.sync.data.local

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

@Entity(tableName = "raw_health_records", indices = [Index(value = ["userId", "provider", "recordType", "sourceRecordId"], unique = true), Index("userId")])
data class RawHealthRecordEntity(
    @PrimaryKey val id: String,
    val userId: String,
    val provider: String,
    val recordType: String,
    val sourceRecordId: String,
    val sourcePackage: String?,
    val sourceDeviceId: String?,
    val startTimeUtc: String?,
    val endTimeUtc: String?,
    val sourceZoneOffset: String?,
    val sourceCreatedAt: String?,
    val sourceUpdatedAt: String?,
    val schemaVersion: Int,
    val payloadJson: String,
    val deleted: Boolean,
    val uploadState: String,
    val revision: Long,
    val observedAt: String,
)

@Entity(tableName = "upload_queue", indices = [Index("userId")])
data class UploadQueueEntity(@PrimaryKey val recordId: String, val userId: String, val revision: Long, val state: String = "PENDING", val attempts: Int = 0, val errorCode: String? = null)

@Entity(tableName = "sync_checkpoints", primaryKeys = ["userId", "provider", "recordType"])
data class SyncCheckpointEntity(val userId: String, val provider: String, val recordType: String, val token: String, val dailyReconciledAt: String?)

@Entity(tableName = "sync_runs", indices = [Index("userId")])
data class SyncRunEntity(@PrimaryKey val id: String, val userId: String, val startedAt: String, val finishedAt: String, val status: String, val recordsRead: Int, val recordsFailed: Int, val errorCode: String?, val uploaded: Boolean = false, val sourceResultsJson: String = "{}")

@Entity(tableName = "devices", primaryKeys = ["userId", "deviceUid"])
data class DeviceEntity(val userId: String, val deviceUid: String, val platform: String, val model: String?, val appVersion: String)

@Entity(tableName = "quarantine", indices = [Index("userId")])
data class QuarantineEntity(@PrimaryKey val id: String, val userId: String, val provider: String, val recordType: String, val sourceUid: String, val payloadJson: String, val reasonCode: String)

data class TypeSummary(val recordType: String, val latest: String?, val count: Int)
