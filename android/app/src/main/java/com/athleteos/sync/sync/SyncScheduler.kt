package com.athleteos.sync.sync

import android.content.Context
import androidx.work.*
import java.util.concurrent.TimeUnit

object SyncScheduler {
    private val connected = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()
    fun schedule(context: Context) {
        val periodic = PeriodicWorkRequestBuilder<HealthSyncWorker>(3, TimeUnit.HOURS)
            .setConstraints(connected).setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS).build()
        WorkManager.getInstance(context).enqueueUniquePeriodicWork("athleteos.periodic", ExistingPeriodicWorkPolicy.KEEP, periodic)
    }
    /** Manual collection can run offline: source data must still reach Room while the server is unreachable. */
    fun manual(context: Context, sevenDays: Boolean = false) {
        val work = OneTimeWorkRequestBuilder<HealthSyncWorker>().setInputData(workDataOf("manual" to true, "seven_days" to sevenDays))
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS).build()
        WorkManager.getInstance(context).enqueueUniqueWork("athleteos.manual", ExistingWorkPolicy.KEEP, work)
    }
    fun retryUploads(context: Context) {
        val work = OneTimeWorkRequestBuilder<HealthSyncWorker>().setConstraints(connected)
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS).build()
        WorkManager.getInstance(context).enqueueUniqueWork("athleteos.retry", ExistingWorkPolicy.KEEP, work)
    }
}
