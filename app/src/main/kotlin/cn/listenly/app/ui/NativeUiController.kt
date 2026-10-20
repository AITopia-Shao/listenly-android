package cn.listenly.app.ui

import android.os.Looper
import android.os.Handler
import android.view.View
import androidx.activity.ComponentActivity
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.ComposeView
import androidx.compose.ui.platform.ViewCompositionStrategy
import org.json.JSONObject
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicInteger

fun interface NativeUiCallbacks {
    fun onAction(action: String, payload: String)
}

internal class NativeUiStore(private val callbacks: NativeUiCallbacks) {
    private val main = Handler(Looper.getMainLooper())
    var catalog by mutableStateOf(UiCatalog())
    var state by mutableStateOf(UiState())
    val progress = mutableStateOf(UiProgress())
    val scrubTime = mutableStateOf<Double?>(null)
    var pendingSeek: Double? = null
    var optimisticTheme by mutableStateOf<String?>(null)
    var importDialog by mutableStateOf(false)
    var filterYear by mutableStateOf("")
    var filterMaterial by mutableStateOf("all")
    val expandedCollections = mutableStateMapOf<String, Boolean>()
    val expandedPapers = mutableStateMapOf<String, Boolean>()
    val expandedQuestions = mutableStateMapOf<String, Boolean>()
    var notice by mutableStateOf("")
    fun action(name: String, vararg values: Pair<String, Any?>) {
        val payload = JSONObject()
        values.forEach { (key, value) -> payload.put(key, value ?: JSONObject.NULL) }
        callbacks.onAction(name, payload.toString())
    }
    fun theme(value: String) {
        optimisticTheme = value
        action("theme", "value" to value)
    }
    fun commitScrub(target: Double) {
        pendingSeek = target
        action("seek", "time" to target)
        action("scrub-end")
        main.postDelayed({ if (pendingSeek == target) { pendingSeek = null; scrubTime.value = null } }, 1200)
    }
}

/** The visible native UI. The attached WebView remains the one business/audio engine. */
class NativeUiController(private val activity: ComponentActivity, callbacks: NativeUiCallbacks, initialDarkTheme: Boolean) {
    private val store = NativeUiStore(callbacks).apply { state = UiState(theme = if (initialDarkTheme) "dark" else "light") }
    private val parser = Executors.newSingleThreadExecutor()
    private val catalogSequence = AtomicInteger()
    private val stateSequence = AtomicInteger()
    @Volatile private var destroyed = false
    private val composeView = ComposeView(activity).apply {
        setViewCompositionStrategy(ViewCompositionStrategy.DisposeOnViewTreeLifecycleDestroyed)
        setContent { NativeListeningApp(store) }
    }
    init {
        check(Looper.myLooper() == Looper.getMainLooper()) { "Native UI must be constructed on the main thread" }
        NativeMotionTrace.enabled = activity.applicationInfo.flags and android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE != 0
    }
    fun getView(): View = composeView
    fun onCatalog(json: String) {
        if (destroyed) return
        val sequence = catalogSequence.incrementAndGet()
        parser.execute {
            try {
                val value = NativeUiParser.catalog(json)
                activity.runOnUiThread { if (!destroyed && catalogSequence.get() == sequence) store.catalog = value }
            } catch (_: Exception) { reportInvalid("资料读取失败") }
        }
    }
    fun onState(json: String) {
        if (destroyed) return
        val sequence = stateSequence.incrementAndGet()
        parser.execute {
            try {
                val value = NativeUiParser.state(json)
                activity.runOnUiThread {
                    if (!destroyed && stateSequence.get() == sequence) {
                        if (!store.state.complete && value.complete) value.questions.forEach { question ->
                            store.expandedQuestions["${value.active.paper}/${value.active.article}/${question.id}"] = true
                        }
                        if (store.state.active != value.active) { store.scrubTime.value = null; store.pendingSeek = null }
                        if (value.notice.isNotBlank() && value.notice != store.state.notice) store.notice = value.notice
                        store.state = value
                        if (store.optimisticTheme == value.theme) store.optimisticTheme = null
                    }
                }
            } catch (_: Exception) { reportInvalid("学习状态读取失败") }
        }
    }
    fun onProgress(json: String) {
        if (destroyed) return
        try {
            val value = NativeUiParser.progress(json)
            activity.runOnUiThread {
                if (!destroyed) {
                    if (store.progress.value != value) store.progress.value = value
                    store.pendingSeek?.let { target ->
                        if (kotlin.math.abs(target - value.time) < .6) { store.pendingSeek = null; store.scrubTime.value = null }
                    }
                }
            }
        } catch (_: Exception) { }
    }
    private fun reportInvalid(message: String) = activity.runOnUiThread { if (!destroyed) store.notice = message }
    fun showToast(message: String) = activity.runOnUiThread { if (!destroyed) store.notice = message }
    fun getMotionDiagnostics(): String = NativeMotionTrace.json()
    fun handleBack(): Boolean {
        if (store.importDialog) { store.importDialog = false; return true }
        if (store.state.route == "library") {
            store.expandedPapers.entries.lastOrNull { it.value && store.catalog.paper(it.key)?.let { paper -> store.expandedCollections[paper.collection] == true } == true }?.let { store.expandedPapers[it.key] = false; return true }
            store.expandedCollections.entries.lastOrNull { it.value }?.let { store.expandedCollections[it.key] = false; return true }
        }
        if (store.state.route != "home") { store.action("back"); return true }
        return false
    }
    fun destroy() {
        if (destroyed) return
        destroyed = true
        parser.shutdownNow()
        composeView.disposeComposition()
    }
}
