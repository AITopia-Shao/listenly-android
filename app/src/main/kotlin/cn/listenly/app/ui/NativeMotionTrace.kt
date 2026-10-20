package cn.listenly.app.ui

import org.json.JSONArray
import org.json.JSONObject

/** Debug-only animation observations. Values are not measured presentation FPS. */
internal object NativeMotionTrace {
    private data class Frame(val at: Long, val position: Float, val velocity: Float)
    private data class Segment(val id: Long, val label: String, val from: Float, val to: Float, val start: Long, val frames: MutableList<Frame> = ArrayList(), var end: Long = 0, var cancelled: Boolean = false)
    @Volatile var enabled = false
    private var sequence = 0L
    private val segments = ArrayList<Segment>()
    @Synchronized fun begin(label: String, from: Float, to: Float): Long {
        if (!enabled) return -1
        val id = ++sequence
        segments.add(Segment(id, label, from, to, System.nanoTime()))
        while (segments.size > 4) segments.removeAt(0)
        return id
    }
    @Synchronized fun frame(id: Long, position: Float, velocity: Float) {
        if (!enabled || id < 0) return
        val segment = segments.firstOrNull { it.id == id } ?: return
        if (segment.frames.size < 180) segment.frames.add(Frame(System.nanoTime(), position, velocity))
    }
    @Synchronized fun end(id: Long, cancelled: Boolean) {
        segments.firstOrNull { it.id == id }?.let { it.end = System.nanoTime(); it.cancelled = cancelled }
    }
    fun json(): String {
        val snapshot = synchronized(this) { segments.map { it.copy(frames = ArrayList(it.frames)) } }
        val rows = JSONArray()
        snapshot.forEach { segment ->
            val frames = JSONArray()
            segment.frames.forEach { frames.put(JSONObject().put("atNanos", it.at).put("position", it.position.toDouble()).put("velocity", it.velocity.toDouble())) }
            rows.put(JSONObject().put("id", segment.id).put("label", segment.label).put("from", segment.from.toDouble()).put("to", segment.to.toDouble()).put("startedNanos", segment.start).put("endedNanos", segment.end).put("cancelled", segment.cancelled).put("frames", frames))
        }
        return JSONObject().put("enabled", enabled).put("segments", rows).put("scope", "Native Animatable observations, not presented-frame or 120Hz measurements").toString()
    }
}
