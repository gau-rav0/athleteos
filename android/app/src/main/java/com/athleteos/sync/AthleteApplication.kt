package com.athleteos.sync

import android.app.Application
import com.athleteos.sync.sync.SyncScheduler

class AthleteApplication : Application() {
    val graph: AppGraph by lazy { AppGraph(applicationContext) }
    override fun onCreate() {
        super.onCreate()
        SyncScheduler.schedule(this)
    }
}
