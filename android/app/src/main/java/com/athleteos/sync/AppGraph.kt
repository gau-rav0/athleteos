package com.athleteos.sync

import android.content.Context
import android.os.Build
import androidx.room.Room
import com.athleteos.sync.data.local.*
import com.athleteos.sync.data.remote.*
import com.athleteos.sync.data.source.healthconnect.HealthConnectSource
import com.athleteos.sync.data.source.samsung.SamsungHealthSource
import com.athleteos.sync.sync.SyncEngine
import java.util.UUID
import java.util.concurrent.TimeUnit
import okhttp3.OkHttpClient

class AppGraph(context: Context) {
    private val preferences = context.getSharedPreferences("installation", Context.MODE_PRIVATE)
    val deviceUid: String = preferences.getString("device_uid", null) ?: UUID.randomUUID().toString().also {
        check(preferences.edit().putString("device_uid", it).commit())
    }
    val db = Room.databaseBuilder(context, HealthDatabase::class.java, "athleteos.db").build()
    val store = RoomSyncStore(db)
    private val http = OkHttpClient.Builder().connectTimeout(15, TimeUnit.SECONDS).readTimeout(45, TimeUnit.SECONDS)
        .callTimeout(60, TimeUnit.SECONDS).followRedirects(false).followSslRedirects(false).build()
    val auth = SupabaseAuth(SessionVault(context), http)
    val healthConnect = HealthConnectSource(context)
    val samsung = SamsungHealthSource()
    val upload = SupabaseUploadClient(context, auth, http, deviceUid)
    val engine = SyncEngine(listOf(healthConnect, samsung), store, upload)
    suspend fun registerDevice(user: String) = db.dao().putDevice(DeviceEntity(user, deviceUid, "android", Build.MODEL, BuildConfig.VERSION_NAME))
}
