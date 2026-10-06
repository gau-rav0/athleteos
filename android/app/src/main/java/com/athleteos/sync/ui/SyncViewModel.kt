package com.athleteos.sync.ui

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.athleteos.sync.AthleteApplication
import com.athleteos.sync.BuildConfig
import com.athleteos.sync.data.local.SyncRunEntity
import com.athleteos.sync.data.local.TypeSummary
import com.athleteos.sync.domain.model.DataStatus
import com.athleteos.sync.domain.repository.SourceAvailability
import com.athleteos.sync.sync.SyncScheduler
import java.time.Duration
import java.time.Instant
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch

data class DataRow(val name: String, val status: DataStatus, val latest: String?)
data class UiState(
    val signedIn: Boolean = false, val busy: Boolean = false, val message: String = "",
    val pending: Int = 0, val failed: Int = 0, val quarantined: Int = 0,
    val lastRun: SyncRunEntity? = null, val lastSuccess: String? = null,
    val samsung: String = "NOT_CHECKED", val healthConnect: String = "NOT_CHECKED",
    val permissions: List<String> = emptyList(), val rows: List<DataRow> = emptyList(),
    val server: String = "NOT_CONTACTED",
)
private data class LocalStats(val pending: Int, val failed: Int, val quarantined: Int, val lastRun: SyncRunEntity?, val lastSuccess: String?)

class SyncViewModel(application: Application) : AndroidViewModel(application) {
    private val graph = (application as AthleteApplication).graph
    val state = MutableStateFlow(UiState())
    private var summaries: List<TypeSummary> = emptyList()
    private var stages = 0
    private var availability: Map<String, SourceAvailability> = emptyMap()
    private val labels = linkedMapOf("steps" to "Steps", "sleep" to "Sleep", "sleep_stages" to "Sleep stages",
        "heart_rate" to "Heart rate", "hrv_rmssd" to "HRV (real RMSSD only)", "exercise" to "Exercise",
        "weight" to "Weight", "body_composition" to "Body composition", "skin_temperature" to "Skin temperature",
        "blood_oxygen" to "Blood oxygen", "energy_score" to "Energy Score", "floors" to "Floors")

    init {
        viewModelScope.launch {
            graph.auth.user.collectLatest { user ->
                summaries = emptyList(); stages = 0
                state.update { it.copy(signedIn = user != null, pending = 0, failed = 0, quarantined = 0, lastRun = null, lastSuccess = null) }
                diagnostics()
                if (user == null) return@collectLatest
                val dao = graph.db.dao()
                combine(
                    combine(dao.queueLength(user), dao.failedCount(user), dao.quarantineCount(user), dao.latestRun(user), dao.lastSuccess(user)) { a, b, c, d, e -> LocalStats(a, b, c, d, e) },
                    dao.summaries(user), dao.sleepStageCount(user),
                ) { stats, records, stageCount -> Triple(stats, records, stageCount) }.collect { (stats, records, stageCount) ->
                    summaries = records; stages = stageCount
                    state.update { it.copy(pending = stats.pending, failed = stats.failed, quarantined = stats.quarantined, lastRun = stats.lastRun, lastSuccess = stats.lastSuccess) }
                    updateRows()
                }
            }
        }
        viewModelScope.launch { graph.upload.lastServerResult.collect { value -> state.update { it.copy(server = value) } } }
    }

    fun login(url: String, key: String, email: String, password: String) = action {
        graph.auth.signIn(url, key, email, password)
        state.update { it.copy(message = "Signed in") }
    }
    fun logout() = action { graph.auth.signOut(); state.update { it.copy(message = "Signed out") } }
    fun sync(sevenDays: Boolean = false) = action {
        val user = graph.auth.user.value ?: error("LOGIN_REQUIRED")
        graph.registerDevice(user)
        val result = graph.engine.run(user, background = false, sevenDays = sevenDays)
        state.update { it.copy(message = result.status) }
        if (result.retryable) SyncScheduler.retryUploads(getApplication())
        diagnostics()
    }
    fun retry() = action {
        val user = graph.auth.user.value ?: error("LOGIN_REQUIRED")
        graph.store.retryFailed(user)
        SyncScheduler.retryUploads(getApplication())
        state.update { it.copy(message = "Retry scheduled when connected") }
    }
    fun runDiagnostics() = action { diagnostics() }
    fun requestPermissions(launch: (Set<String>) -> Unit) = action {
        val permissions = graph.healthConnect.permissionsToRequest()
        if (permissions.isEmpty()) state.update { it.copy(message = "Health Connect unavailable — install or update it first") }
        else launch(permissions)
    }
    private fun action(block: suspend () -> Unit) {
        if (state.value.busy) return
        viewModelScope.launch {
            state.update { it.copy(busy = true, message = "") }
            try { block() } catch (cancelled: CancellationException) { throw cancelled }
            catch (_: Exception) { state.update { it.copy(message = "ACTION_FAILED — check configuration and permissions") } }
            finally { state.update { it.copy(busy = false) } }
        }
    }
    private suspend fun diagnostics() {
        val hc = graph.healthConnect
        val permissions = hc.grantedPermissions().sorted()
        availability = graph.healthConnect.recordTypes.associateWith { hc.availability(it, false) } +
            graph.samsung.recordTypes.filterNot { it in graph.healthConnect.recordTypes }.associateWith { graph.samsung.availability(it, false) }
        state.update { it.copy(samsung = graph.samsung.availability("steps", false).name,
            healthConnect = "SDK_${hc.sdkStatus()}; ${permissions.count { name -> name.contains("READ_") }} read permissions granted",
            permissions = permissions) }
        updateRows()
    }
    private fun updateRows() {
        val rows = labels.map { (type, label) ->
            val metric = when (type) { "sleep_stages" -> "sleep"; "body_composition" -> "body_fat"; else -> type }
            val record = summaries.find { it.recordType == metric } ?: if (type == "body_composition") summaries.find { it.recordType == type } else null
            val latest = record?.latest
            val accessible = availability[metric] ?: SourceAvailability.UNSUPPORTED
            val status = when {
                accessible == SourceAvailability.PERMISSION_REQUIRED -> DataStatus.PERMISSION_REQUIRED
                latest != null && (type != "sleep_stages" || stages > 0) -> if (Duration.between(Instant.parse(latest), Instant.now()) > Duration.ofHours(72)) DataStatus.STALE else DataStatus.AVAILABLE
                accessible != SourceAvailability.AVAILABLE -> DataStatus.UNSUPPORTED
                else -> DataStatus.MISSING
            }
            DataRow(label, status, if (type == "sleep_stages" && stages == 0) null else latest)
        }
        state.update { it.copy(rows = rows) }
    }
    /** Allowlist only. No IDs, account details, source timestamps, payloads or exception messages. */
    fun redactedDiagnostics(): String = state.value.let {
        "AthleteOS ${BuildConfig.VERSION_NAME}\ninstallation=REDACTED\nSamsung=${it.samsung}\nHealthConnect=${it.healthConnect}\n" +
            "pending=${it.pending}\nfailed=${it.failed}\nquarantined=${it.quarantined}\nlast_result=${it.lastRun?.status ?: "NONE"}\nserver=${it.server}\n" +
            "permissions=${it.permissions.joinToString(",")}\n"
    }
    val deviceUid: String get() = graph.deviceUid
}
