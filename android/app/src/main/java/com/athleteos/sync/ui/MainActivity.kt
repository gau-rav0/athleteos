package com.athleteos.sync.ui

import android.app.Activity
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.health.connect.client.PermissionController
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import com.athleteos.sync.BuildConfig
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent { MaterialTheme { Surface(Modifier.fillMaxSize()) { AthleteScreen() } } }
    }
}

@Composable
private fun AthleteScreen(model: SyncViewModel = viewModel()) {
    val state by model.state.collectAsStateWithLifecycle()
    val context = LocalContext.current
    var screen by remember { mutableStateOf("Home") }
    val permissionLauncher = rememberLauncherForActivityResult(PermissionController.createRequestPermissionResultContract()) { model.runDiagnostics() }
    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceEvenly) {
            listOf("Home", "Data", "Diagnostics").forEach { name -> TextButton(onClick = { screen = name }) { Text(name) } }
        }
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("AthleteOS · $screen", style = MaterialTheme.typography.headlineSmall)
            if (state.busy) LinearProgressIndicator(Modifier.fillMaxWidth())
            if (state.message.isNotEmpty()) Text(state.message)
            when (screen) {
                "Home" -> {
                    Text("Samsung Health: ${state.samsung}")
                    Text("Health Connect: ${state.healthConnect}")
                    Text("Server: ${state.server}")
                    Text("Last successful sync: ${state.lastSuccess ?: "None"}")
                    Text("Pending records: ${state.pending}")
                    Text("Last sync result: ${state.lastRun?.status ?: "None"}")
                    Button(onClick = { model.sync() }, enabled = state.signedIn && !state.busy) { Text("Sync Now") }
                    Button(onClick = { model.requestPermissions { permissionLauncher.launch(it) } }, enabled = !state.busy) { Text("Grant Health Connect read permissions") }
                    Button(onClick = { (context as? Activity)?.let(model::requestSamsungPermissions) }, enabled = !state.busy && context is Activity) { Text("Grant Samsung Health read permissions") }
                    TextButton(onClick = {
                        runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=com.google.android.apps.healthdata"))) }
                            .onFailure { runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://play.google.com/store/apps/details?id=com.google.android.apps.healthdata"))) } }
                    }) { Text("Install / update Health Connect") }
                    Text("Read-only health access. Records remain in this app's private store and upload to your authenticated Supabase account. You can revoke access in Android health permissions. No scores or fabricated HRV.")
                    Text("Background sync targets every 3 hours; Android may delay it. Without background permission, use Sync Now while this screen is open.")
                    if (!state.signedIn) LoginForm(state.busy, model::login) else TextButton(onClick = model::logout, enabled = !state.busy) { Text("Sign out") }
                }
                "Data" -> state.rows.forEach { row ->
                    Card(Modifier.fillMaxWidth()) { Column(Modifier.padding(12.dp)) {
                        Text(row.name, style = MaterialTheme.typography.titleMedium)
                        Text(row.status.name)
                        if (row.name.startsWith("HRV") && row.status == com.athleteos.sync.domain.model.DataStatus.MISSING) Text("HRV unavailable: no real RMSSD record")
                        Text("Latest: ${row.latest ?: "No record"}")
                    } }
                }
                else -> {
                    Text("App version: ${BuildConfig.VERSION_NAME}")
                    Text("Device identifier: ${model.deviceUid}")
                    Text("Samsung availability / permission: ${state.samsung}")
                    Text("Health Connect: ${state.healthConnect}")
                    Text("Permissions: ${state.permissions.joinToString("\n").ifEmpty { "None" }}")
                    Text("Last sync: ${state.lastRun?.startedAt ?: "None"}")
                    Text("Last success: ${state.lastSuccess ?: "None"}")
                    Text("Queue: ${state.pending}; failed: ${state.failed}; quarantined: ${state.quarantined}")
                    Text("Last server result: ${state.server}")
                    Text("Last failure code: ${state.lastRun?.errorCode ?: "None"}")
                    state.lastRun?.sourceResultsJson?.let { codes ->
                        Json.parseToJsonElement(codes).jsonObject.forEach { (source, result) -> Text("$source: ${result.jsonPrimitive.content}") }
                    }
                    Button(onClick = model::runDiagnostics, enabled = !state.busy) { Text("Run diagnostics") }
                    Button(onClick = model::retry, enabled = state.signedIn && !state.busy) { Text("Retry failed uploads") }
                    Button(onClick = { model.sync(true) }, enabled = state.signedIn && !state.busy) { Text("Reconcile last 7 days") }
                    Button(onClick = {
                        (context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager).setPrimaryClip(ClipData.newPlainText("AthleteOS redacted diagnostics", model.redactedDiagnostics()))
                    }) { Text("Copy REDACTED diagnostics") }
                }
            }
        }
    }
}

@Composable
private fun LoginForm(busy: Boolean, submit: (String, String, String, String) -> Unit) {
    // remember, never rememberSaveable: no credentials in saved state or persisted UI state.
    var url by remember { mutableStateOf("") }
    var key by remember { mutableStateOf("") }
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    Text("Supabase sign-in", style = MaterialTheme.typography.titleLarge)
    OutlinedTextField(url, { url = it }, label = { Text("Project HTTPS URL") }, modifier = Modifier.fillMaxWidth(), singleLine = true)
    OutlinedTextField(key, { key = it }, label = { Text("Publishable / anon public key") }, modifier = Modifier.fillMaxWidth(), singleLine = true)
    OutlinedTextField(email, { email = it }, label = { Text("Email") }, modifier = Modifier.fillMaxWidth(), singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email))
    OutlinedTextField(password, { password = it }, label = { Text("Password") }, modifier = Modifier.fillMaxWidth(), singleLine = true, visualTransformation = PasswordVisualTransformation(), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password))
    Button(onClick = { submit(url, key, email, password); password = "" }, enabled = !busy && url.isNotBlank() && key.isNotBlank() && email.isNotBlank() && password.isNotBlank()) { Text("Sign in") }
    Text("Create your account in Supabase first. Use only a publishable or anon key here.")
}
