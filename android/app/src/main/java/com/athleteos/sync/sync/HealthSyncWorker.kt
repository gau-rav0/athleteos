package com.athleteos.sync.sync

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.athleteos.sync.AthleteApplication
import kotlinx.coroutines.CancellationException

class HealthSyncWorker(context: Context, parameters: WorkerParameters) : CoroutineWorker(context, parameters) {
    override suspend fun doWork(): Result {
        val graph = (applicationContext as AthleteApplication).graph
        val user = graph.auth.user.value ?: return Result.success() // Requires login; no cross-account ingestion.
        return try {
            graph.registerDevice(user)
            // A Worker is always background, even if scheduled by a foreground button.
            // Foreground UI calls the engine directly when background reads are unavailable.
            val result = graph.engine.run(user, background = true, sevenDays = inputData.getBoolean("seven_days", false))
            if (result.retryable) Result.retry() else Result.success()
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (_: Exception) { Result.retry() }
    }
}
