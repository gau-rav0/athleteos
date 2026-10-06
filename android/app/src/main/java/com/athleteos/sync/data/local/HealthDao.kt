package com.athleteos.sync.data.local

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import kotlinx.coroutines.flow.Flow

@Dao
interface HealthDao {
    @Query("SELECT * FROM raw_health_records WHERE id = :id AND userId = :user")
    suspend fun record(user: String, id: String): RawHealthRecordEntity?
    @Query("SELECT * FROM raw_health_records WHERE userId = :user AND provider = :provider AND recordType = :type")
    suspend fun records(user: String, provider: String, type: String): List<RawHealthRecordEntity>
    @Insert(onConflict = OnConflictStrategy.REPLACE) suspend fun putRecord(value: RawHealthRecordEntity)
    @Insert(onConflict = OnConflictStrategy.REPLACE) suspend fun putQueue(value: UploadQueueEntity)
    @Insert(onConflict = OnConflictStrategy.REPLACE) suspend fun putCheckpoint(value: SyncCheckpointEntity)
    @Insert(onConflict = OnConflictStrategy.REPLACE) suspend fun putQuarantine(value: QuarantineEntity)
    @Insert(onConflict = OnConflictStrategy.REPLACE) suspend fun putRun(value: SyncRunEntity)
    @Insert(onConflict = OnConflictStrategy.REPLACE) suspend fun putDevice(value: DeviceEntity)
    @Query("SELECT * FROM sync_checkpoints WHERE userId = :user AND provider = :provider AND recordType = :type")
    suspend fun checkpoint(user: String, provider: String, type: String): SyncCheckpointEntity?
    @Query("UPDATE upload_queue SET state = 'PENDING' WHERE userId = :user AND state IN ('UPLOADING', 'FAILED')")
    suspend fun recover(user: String)
    @Query("UPDATE raw_health_records SET uploadState = 'PENDING' WHERE userId = :user AND uploadState IN ('UPLOADING', 'FAILED')")
    suspend fun recoverRecords(user: String)
    @Query("SELECT * FROM upload_queue WHERE userId = :user AND state = 'PENDING' ORDER BY recordId LIMIT :limit")
    suspend fun pending(user: String, limit: Int): List<UploadQueueEntity>
    @Query("UPDATE upload_queue SET state = :state, attempts = attempts + :attempt, errorCode = :code WHERE userId = :user AND recordId = :id AND revision = :revision")
    suspend fun queueState(user: String, id: String, revision: Long, state: String, attempt: Int = 0, code: String? = null)
    @Query("UPDATE raw_health_records SET uploadState = :state WHERE userId = :user AND id = :id AND revision = :revision")
    suspend fun recordState(user: String, id: String, revision: Long, state: String)
    @Query("DELETE FROM upload_queue WHERE userId = :user AND recordId = :id AND revision = :revision")
    suspend fun deleteQueue(user: String, id: String, revision: Long)
    @Query("SELECT * FROM sync_runs WHERE userId = :user AND uploaded = 0 ORDER BY startedAt LIMIT 100")
    suspend fun pendingRuns(user: String): List<SyncRunEntity>
    @Query("UPDATE sync_runs SET uploaded = 1 WHERE userId = :user AND id IN (:ids)")
    suspend fun acknowledgeRuns(user: String, ids: List<String>)
    @Query("SELECT * FROM sync_runs WHERE userId = :user ORDER BY startedAt DESC LIMIT 1")
    fun latestRun(user: String): Flow<SyncRunEntity?>
    @Query("SELECT finishedAt FROM sync_runs WHERE userId = :user AND status = 'SUCCESS' ORDER BY finishedAt DESC LIMIT 1")
    fun lastSuccess(user: String): Flow<String?>
    @Query("SELECT COUNT(*) FROM upload_queue WHERE userId = :user")
    fun queueLength(user: String): Flow<Int>
    @Query("SELECT COUNT(*) FROM upload_queue WHERE userId = :user AND state = 'FAILED'")
    fun failedCount(user: String): Flow<Int>
    @Query("SELECT COUNT(*) FROM quarantine WHERE userId = :user")
    fun quarantineCount(user: String): Flow<Int>
    @Query("SELECT recordType, MAX(startTimeUtc) AS latest, COUNT(*) AS count FROM raw_health_records WHERE userId = :user AND deleted = 0 GROUP BY recordType")
    fun summaries(user: String): Flow<List<TypeSummary>>
    @Query("SELECT COUNT(*) FROM raw_health_records WHERE userId = :user AND recordType = 'sleep' AND deleted = 0 AND payloadJson LIKE '%\"stages\":[{%' ")
    fun sleepStageCount(user: String): Flow<Int>
}
