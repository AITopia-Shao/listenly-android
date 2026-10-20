package cn.listenly.app.ui

import org.json.JSONArray
import org.json.JSONObject

internal data class UiCollection(val id: String, val title: String)
internal data class UiOption(val id: String, val key: String, val text: String, val selected: Boolean = false, val correct: Boolean = false, val wrong: Boolean = false)
internal data class UiQuestion(val id: String, val number: Int, val options: List<UiOption>, val choice: String = "", val submitted: Boolean = false)
internal data class UiSentence(val en: String, val zh: String, val start: Double, val end: Double, val timed: Boolean)
internal data class UiArticle(val id: String, val title: String, val section: String, val start: Double, val end: Double, val duration: Double, val transcript: List<UiSentence>, val questions: List<UiQuestion>, val hasMarker: Boolean = false) {
    val label: String get() = title.replace(Regex("[·・｜|—–-]?\\s*\\d+\\s*[-–—~～至]\\s*\\d+\\s*题.*$"), "").trim()
}
internal data class UiPaper(val id: String, val title: String, val year: String, val collection: String, val collectionTitle: String, val duration: Double, val audioAvailable: Boolean, val articles: List<UiArticle>)
internal data class UiCatalog(val collections: List<UiCollection> = emptyList(), val papers: List<UiPaper> = emptyList()) {
    fun paper(id: String): UiPaper? = papers.firstOrNull { it.id == id }
    fun article(paperId: String, articleId: String): UiArticle? = paper(paperId)?.articles?.firstOrNull { it.id == articleId }
}
internal data class UiRef(val paper: String = "", val article: String = "")
internal data class UiActivity(val date: String, val count: Int)
internal data class UiRecent(val paper: String, val article: String, val paperTitle: String, val articleTitle: String)
internal data class UiProfile(val todayMinutes: Double = 0.0, val todayArticles: Int = 0, val totalHours: Double = 0.0, val activity: List<UiActivity> = emptyList(), val recent: List<UiRecent> = emptyList())
internal data class UiState(
    val ready: Boolean = false, val route: String = "home", val theme: String = "light",
    val mode: String = "intensive", val display: String = "hidden", val selectedPaper: String = "",
    val active: UiRef = UiRef(), val homeFocus: UiRef = UiRef(), val bookmarked: Boolean = false,
    val bookmarks: Set<String> = emptySet(),
    val questions: List<UiQuestion> = emptyList(), val canSubmit: Boolean = false,
    val complete: Boolean = false, val resultVisible: Boolean = false,
    val profile: UiProfile = UiProfile(), val notice: String = "", val busy: Boolean = false,
    val playing: Boolean = false, val loading: Boolean = false, val playerError: String = "",
    val sourceAvailable: Boolean = false, val speed: Double = 1.0, val playbackMode: String = "sequence",
)
internal data class UiProgress(val time: Double = 0.0, val duration: Double = 0.0, val playing: Boolean = false, val speed: Double = 1.0, val playbackMode: String = "sequence", val activeSentence: Int = -1, val paper: String = "", val article: String = "")

internal object NativeUiParser {
    private fun JSONObject.s(key: String, fallback: String = ""): String = if (isNull(key)) fallback else optString(key, fallback)
    private fun JSONObject.d(key: String, fallback: Double = 0.0): Double = optDouble(key, fallback).takeIf { it.isFinite() } ?: fallback
    private fun JSONArray?.objects(): List<JSONObject> = if (this == null) emptyList() else (0 until length()).mapNotNull { optJSONObject(it) }
    private fun ref(value: JSONObject?): UiRef = value?.let { UiRef(it.s("paper", it.s("paperId")), it.s("article", it.s("articleId"))) } ?: UiRef()
    private fun options(value: JSONArray?): List<UiOption> = value.objects().mapIndexed { index, option ->
        UiOption(option.s("id", option.s("key", ('A' + index).toString())), option.s("key", ('A' + index).toString()), option.s("text"), option.optBoolean("isSelected"), option.optBoolean("isCorrect"), option.optBoolean("isWrong"))
    }
    private fun questions(value: JSONArray?): List<UiQuestion> = value.objects().mapIndexed { index, question ->
        UiQuestion(question.s("id", index.toString()), question.optInt("number", index + 1), options(question.optJSONArray("options")), question.s("choice"), question.optBoolean("submitted"))
    }
    fun catalog(json: String): UiCatalog {
        val root = JSONObject(json)
        val collections = root.optJSONArray("collections").objects().map { UiCollection(it.s("id"), it.s("title")) }
        val papers = root.optJSONArray("papers").objects().map { paper ->
            val collection = paper.optJSONObject("collection")
            UiPaper(paper.s("id"), paper.s("title"), paper.s("year"), collection?.s("id") ?: paper.s("collection"), collection?.s("title") ?: "其他资料", paper.d("duration"), paper.optBoolean("audioAvailable", true), paper.optJSONArray("articles").objects().map { article ->
                UiArticle(article.s("id"), article.s("title"), article.s("section"), article.d("start"), article.d("end"), article.d("duration"), article.optJSONArray("transcript").objects().map { sentence ->
                    UiSentence(sentence.s("en", sentence.s("text")), sentence.s("zh", sentence.s("translation")), sentence.d("start"), sentence.d("end"), sentence.optBoolean("timed", true) && !sentence.isNull("start") && sentence.optDouble("start").isFinite())
                }, questions(article.optJSONArray("questions")), !article.isNull("start") && !article.isNull("end") && article.optDouble("start").isFinite() && article.optDouble("end").isFinite() && article.optDouble("start") >= 0 && article.optDouble("end") > article.optDouble("start"))
            })
        }
        return UiCatalog(collections.ifEmpty { papers.distinctBy { it.collection }.map { UiCollection(it.collection, it.collectionTitle) } }, papers)
    }
    fun state(json: String): UiState {
        val root = JSONObject(json)
        val player = root.optJSONObject("player") ?: JSONObject()
        val profile = root.optJSONObject("profile") ?: JSONObject()
        val active = ref(root.optJSONObject("active"))
        return UiState(
            ready = root.optBoolean("ready", true), route = root.s("route", "home"), theme = root.s("theme", "light"),
            mode = root.s("mode", "intensive"), display = root.s("display", "hidden"), selectedPaper = root.s("selectedPaper"),
            active = active, homeFocus = ref(root.optJSONObject("homeFocus")).let { if (it.paper.isEmpty()) active else it },
            bookmarked = root.optBoolean("bookmarked"), questions = questions(root.optJSONArray("questions")),
            bookmarks = root.optJSONArray("bookmarks")?.let { array -> (0 until array.length()).map { array.optString(it) }.toSet() } ?: emptySet(),
            canSubmit = root.optBoolean("canSubmit"), complete = root.optBoolean("complete"), resultVisible = root.optBoolean("resultVisible"),
            profile = UiProfile(profile.d("todayMinutes"), profile.optInt("todayArticles"), profile.d("totalHours"), profile.optJSONArray("activity").objects().map { UiActivity(it.s("date"), it.optInt("count")) }, profile.optJSONArray("recent").objects().map { UiRecent(it.s("paper"), it.s("article"), it.s("paperTitle"), it.s("articleTitle")) }),
            notice = root.s("notice"), busy = root.optBoolean("busy"), playing = player.optBoolean("playing"), loading = player.optBoolean("loading"), playerError = player.s("error"), sourceAvailable = player.optBoolean("sourceAvailable"), speed = root.d("speed", 1.0), playbackMode = root.s("playbackMode", "sequence"),
        )
    }
    fun progress(json: String): UiProgress {
        val root = JSONObject(json)
        return UiProgress(root.d("time"), root.d("duration"), root.optBoolean("playing"), root.d("speed", 1.0), root.s("playbackMode", "sequence"), root.optInt("activeSentence", -1), root.s("paper"), root.s("article"))
    }
}
