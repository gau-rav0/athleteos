package com.athleteos.sync.data.remote

import android.app.Application
import android.content.Context
import androidx.test.core.app.ApplicationProvider
import kotlin.test.*
import okhttp3.OkHttpClient
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(application = Application::class, sdk = [33])
class UploadDiagnosticsTest {
    @Test fun failureSurvivesSuccessfulRunUploadAndClientRecreation() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        context.getSharedPreferences("server_diagnostics", Context.MODE_PRIVATE).edit().clear().commit()
        val http = OkHttpClient()
        val auth = SupabaseAuth(SessionVault(context), http)
        val client = SupabaseUploadClient(context, auth, http, "synthetic-installation")
        client.result("NETWORK_TIMEOUT")
        client.result("HTTP_200")
        assertEquals("HTTP_200", client.lastServerResult.value)
        assertEquals("NETWORK_TIMEOUT", client.lastServerFailure.value)
        val reopened = SupabaseUploadClient(context, auth, http, "synthetic-installation")
        assertEquals("NETWORK_TIMEOUT", reopened.lastServerFailure.value)
        reopened.result("HTTP_503")
        reopened.result("HTTP_200")
        assertEquals("HTTP_503", reopened.lastServerFailure.value)
        assertFailsWith<IllegalArgumentException> { reopened.result("private vendor error") }
        assertEquals("HTTP_503", reopened.lastServerFailure.value)
    }
}
