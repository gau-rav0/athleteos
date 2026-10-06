package com.athleteos.sync.data.local

import androidx.room.Database
import androidx.room.RoomDatabase

@Database(entities = [RawHealthRecordEntity::class, UploadQueueEntity::class, SyncCheckpointEntity::class, SyncRunEntity::class, DeviceEntity::class, QuarantineEntity::class], version = 1, exportSchema = true)
abstract class HealthDatabase : RoomDatabase() {
    abstract fun dao(): HealthDao
}
