package cn.listenly.app.ui

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.testTagsAsResourceId
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import top.yukonga.miuix.kmp.basic.*
import top.yukonga.miuix.kmp.icon.MiuixIcons
import top.yukonga.miuix.kmp.icon.extended.*
import top.yukonga.miuix.kmp.menu.OverlayDropdownMenu
import top.yukonga.miuix.kmp.overlay.OverlayDialog
import top.yukonga.miuix.kmp.theme.MiuixTheme
import top.yukonga.miuix.kmp.theme.darkColorScheme
import top.yukonga.miuix.kmp.theme.lightColorScheme
import top.yukonga.miuix.kmp.utils.PressFeedbackType
import org.json.JSONArray

@Composable internal fun NativeListeningApp(store: NativeUiStore) {
    val state = store.state
    val dark = (store.optimisticTheme ?: state.theme) == "dark"
    val orange = Color(0xFFE7A17D)
    val foreground = if (dark) orange else Color(0xFF161719)
    // A single stable composition: theme changes never key/recreate the
    // Scaffold, TabRow, navigation items or audio engine.
    val colors = if (dark) darkColorScheme(
        primary = orange, onPrimary = Color.Black, onBackground = orange,
        background = Color.Black, surface = Color.Transparent, onSurface = orange,
        surfaceContainer = Color(0xD9161413), onSurfaceContainer = orange,
        onSurfaceVariantSummary = Color(0xFFBDA799), onSurfaceVariantActions = orange.copy(alpha = .7f),
        secondaryVariant = Color(0x55262320), onSecondaryVariant = orange,
    ) else lightColorScheme(
        primary = foreground, onPrimary = Color.White, onBackground = foreground,
        background = Color(0xFFF7F7F7), surface = Color.Transparent, onSurface = foreground,
        surfaceContainer = Color(0xDAFFFFFF), onSurfaceContainer = foreground,
        onSurfaceVariantSummary = Color(0xFF555B60), onSurfaceVariantActions = Color(0xFF555B60),
        secondaryVariant = Color(0x55FFFFFF), onSecondaryVariant = foreground,
    )
    MiuixTheme(colors = colors) {
        ProvideNativeGlass(dark) {
            Box(Modifier.fillMaxSize().semantics { testTagsAsResourceId = true }) {
                WallpaperScene(dark)
                val snackbar = remember { SnackbarHostState() }
                LaunchedEffect(store.notice) {
                    val notice = store.notice
                    if (notice.isNotBlank()) { snackbar.showSnackbar(notice); if (store.notice == notice) store.notice = "" }
                }
                val practice = state.route == "practice" || state.route == "reader"
                Scaffold(
                    containerColor = Color.Transparent,
                    topBar = { if (practice) ReaderHeader(store) },
                    bottomBar = {
                        if (practice) Box(Modifier.navigationBarsPadding().padding(horizontal = 12.dp, vertical = 5.dp)) {
                            MiuixGlassCard { NativeTransport(store, state.active) }
                        } else NativeNavigation(store)
                    },
                    snackbarHost = { SnackbarHost(snackbar) },
                ) { padding ->
                    Box(Modifier.fillMaxSize().padding(padding).consumeWindowInsets(padding)) {
                        if (!state.ready && store.catalog.papers.isEmpty()) {
                            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
                        } else when {
                            practice -> ReaderBody(store)
                            state.route == "library" -> LibraryPage(store)
                            state.route == "profile" -> ProfilePage(store)
                            else -> HomePage(store)
                        }
                    }
                    ImportDialog(store)
                }
            }
        }
    }
}

@Composable private fun HomePage(store: NativeUiStore) {
    val state = store.state
    val paper = store.catalog.paper(state.selectedPaper) ?: store.catalog.paper(state.homeFocus.paper) ?: store.catalog.papers.firstOrNull()
    val focusPaper = store.catalog.paper(state.homeFocus.paper) ?: paper
    val focus = focusPaper?.articles?.firstOrNull { it.id == state.homeFocus.article } ?: focusPaper?.articles?.firstOrNull()
    LazyColumn(contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 12.dp, bottom = 16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        if (focusPaper != null && focus != null) item(key = "focus") {
            MiuixGlassCard {
                Column(Modifier.padding(start = 18.dp, end = 18.dp, top = 16.dp, bottom = 2.dp)) {
                    Button(onClick = { store.action("open", "paper" to focusPaper.id, "article" to focus.id) }, modifier = Modifier.fillMaxWidth().nativeBounce().semantics { contentDescription = "阅读当前文章" }, insideMargin = PaddingValues(0.dp), colors = ButtonDefaults.buttonColors(color = Color.Transparent, contentColor = accent())) {
                        Text(focusPaper.title, Modifier.fillMaxWidth(), fontSize = 22.sp, fontWeight = FontWeight.SemiBold, maxLines = 2, overflow = TextOverflow.Ellipsis)
                    }
                }
                NativeTransport(store, UiRef(focusPaper.id, focus.id))
            }
        }
        if (paper != null) {
            item(key = "paper-title") { Text(paper.title, modifier = Modifier.padding(horizontal = 5.dp, vertical = 5.dp), color = muted(), fontSize = 13.sp) }
            items(paper.articles, key = { "home-${paper.id}-${it.id}" }) { article ->
                val selected = state.homeFocus.paper == paper.id && state.homeFocus.article == article.id
                ArticleRow(store, paper, article, selected, home = true)
            }
        } else item { EmptyText("暂无资料") }
    }
}

@Composable private fun ArticleRow(store: NativeUiStore, paper: UiPaper, article: UiArticle, selected: Boolean, indent: Boolean = false, home: Boolean = false) {
    val emphasis by animateFloatAsState(if (selected) 1.015f else 1f, spring(dampingRatio = .75f), label = "articleEmphasis")
    val body: @Composable () -> Unit = {
        Card(
            modifier = Modifier.fillMaxWidth().nativeBounce(), cornerRadius = 20.dp,
            colors = CardDefaults.defaultColors(Color.Transparent, accent()), pressFeedbackType = PressFeedbackType.Sink,
            onClick = if (home && !article.hasMarker) null else ({ store.action(if (home) "mark-paper" else "open", "paper" to paper.id, "article" to article.id) }),
        ) {
            Row(Modifier.fillMaxWidth().padding(start = if (indent) 14.dp else 12.dp, end = 3.dp, top = 8.dp, bottom = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(article.label, Modifier.weight(1f).graphicsLayer { scaleX = emphasis; scaleY = emphasis }, fontSize = 15.sp, fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal, maxLines = 2, overflow = TextOverflow.Ellipsis)
                NativeIcon(MiuixIcons.Play, "播放${article.label}", enabled = paper.audioAvailable && article.hasMarker) { store.action("material-play", "paper" to paper.id, "article" to article.id) }
                if (home) NativeIcon(MiuixIcons.ChevronForward, "阅读${article.label}") { store.action("open", "paper" to paper.id, "article" to article.id) }
            }
        }
    }
    if (selected) GlassPanel(Modifier.fillMaxWidth(), selected = true, radius = 21.dp) { body() } else body()
    HorizontalDivider(color = accent().copy(alpha = .12f), modifier = Modifier.padding(horizontal = 12.dp))
}

@Composable private fun LibraryPage(store: NativeUiStore) {
    val catalog = store.catalog
    val years = remember(catalog) { catalog.papers.map { it.year }.filter { it.isNotBlank() && it != "0" }.distinct().sortedDescending() }
    val papers = catalog.papers.filter { (store.filterYear.isBlank() || it.year == store.filterYear) && when (store.filterMaterial) {
        "saved" -> it.articles.any { article -> JSONArray(listOf(it.id, article.id)).toString() in store.state.bookmarks }
        "real" -> it.collection == "cet6"
        else -> true
    } }
    LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
        item(key = "filters") {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(bottom = 8.dp)) {
                GlassPanel(Modifier.weight(1f), radius = 18.dp) {
                    OverlayDropdownMenu(
                        title = store.filterYear.ifEmpty { "全部年份" },
                        entry = DropdownEntry(items = (listOf("") + years).map { year -> DropdownItem(text = year.ifEmpty { "全部年份" }, selected = store.filterYear == year, onClick = { store.filterYear = year }) }),
                        insideMargin = PaddingValues(horizontal = 12.dp, vertical = 11.dp), maxHeight = 360.dp,
                    )
                }
                GlassPanel(Modifier.weight(1f), radius = 18.dp) {
                    val types = listOf("all" to "全部材料", "saved" to "收藏", "real" to "六级真题")
                    OverlayDropdownMenu(
                        title = types.firstOrNull { it.first == store.filterMaterial }?.second ?: "全部材料",
                        entry = DropdownEntry(items = types.map { (id, title) -> DropdownItem(text = title, selected = store.filterMaterial == id, onClick = { store.filterMaterial = id }) }),
                        insideMargin = PaddingValues(horizontal = 12.dp, vertical = 11.dp), maxHeight = 360.dp,
                    )
                }
            }
        }
        items(catalog.collections, key = { "collection-${it.id}" }) { collection ->
            val members = papers.filter { it.collection == collection.id }
            if (members.isNotEmpty()) {
                val expanded = store.expandedCollections[collection.id] == true
                DisclosureRow(collection.title, expanded) { store.expandedCollections[collection.id] = !expanded }
                AnimatedVisibility(expanded, enter = expandVertically(spring(dampingRatio = .82f, stiffness = 400f)) + fadeIn(), exit = shrinkVertically(spring(dampingRatio = .9f, stiffness = 450f)) + fadeOut()) {
                    Column(Modifier.fillMaxWidth().then(if (!expanded) Modifier.clearAndSetSemantics {} else Modifier)) {
                        members.forEach { paper ->
                            val open = store.expandedPapers[paper.id] == true
                            val selected = store.state.selectedPaper == paper.id
                            val row: @Composable () -> Unit = {
                                Row(Modifier.fillMaxWidth().padding(start = 10.dp, end = 3.dp, top = 2.dp, bottom = 2.dp), verticalAlignment = Alignment.CenterVertically) {
                                    Button(onClick = { store.action("select-paper", "paper" to paper.id) }, modifier = Modifier.weight(1f).nativeBounce(), insideMargin = PaddingValues(horizontal = 5.dp, vertical = 10.dp), colors = ButtonDefaults.buttonColors(color = Color.Transparent, contentColor = accent())) {
                                        Text(paper.title, Modifier.weight(1f), fontSize = 15.sp, fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal)
                                    }
                                    RotatingDisclosure(open, "预览${paper.title}") { store.expandedPapers[paper.id] = !open }
                                }
                            }
                            if (selected) GlassPanel(Modifier.fillMaxWidth(), selected = true, radius = 20.dp) { row() } else row()
                            HorizontalDivider(color = accent().copy(alpha = .12f), modifier = Modifier.padding(horizontal = 14.dp))
                            AnimatedVisibility(open, enter = expandVertically(spring(dampingRatio = .85f, stiffness = 420f)) + fadeIn(), exit = shrinkVertically(spring(dampingRatio = .9f, stiffness = 450f)) + fadeOut()) {
                                Column(Modifier.fillMaxWidth().padding(start = 11.dp).then(if (!open) Modifier.clearAndSetSemantics {} else Modifier)) {
                                    paper.articles.filter { store.filterMaterial != "saved" || JSONArray(listOf(paper.id, it.id)).toString() in store.state.bookmarks }.forEach { article -> ArticleRow(store, paper, article, store.state.active == UiRef(paper.id, article.id), indent = true) }
                                }
                            }
                        }
                    }
                }
            }
        }
        if (papers.isEmpty()) item { EmptyText("暂无资料") }
    }
}

@Composable private fun RotatingDisclosure(expanded: Boolean, label: String, onClick: () -> Unit) {
    val rotation = animateFloatAsState(if (expanded) 90f else 0f, spring(dampingRatio = .8f, stiffness = 450f), label = "disclosure")
    NativeIcon(MiuixIcons.ChevronForward, label, Modifier.graphicsLayer { rotationZ = rotation.value }, onClick = onClick)
}

@Composable private fun DisclosureRow(title: String, expanded: Boolean, onClick: () -> Unit) {
    Card(Modifier.fillMaxWidth().nativeBounce(), colors = CardDefaults.defaultColors(Color.Transparent, accent()), onClick = onClick) {
        Row(Modifier.fillMaxWidth().padding(start = 6.dp, top = 6.dp, bottom = 6.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(title, Modifier.weight(1f), fontSize = 18.sp, fontWeight = FontWeight.SemiBold)
            RotatingDisclosure(expanded, if (expanded) "收起$title" else "展开$title", onClick)
        }
    }
}

@Composable private fun ProfilePage(store: NativeUiStore) {
    val state = store.state
    val profile = state.profile
    val dark = (store.optimisticTheme ?: state.theme) == "dark"
    LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        item(key = "appearance") {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
                NativeSegments(listOf("日间", "夜间"), if (dark) 1 else 0, Modifier.width(176.dp)) { store.theme(if (it == 1) "dark" else "light") }
                GlassPanel(Modifier.size(44.dp), radius = 18.dp) { NativeIcon(MiuixIcons.Add, "导入资料") { store.importDialog = true } }
            }
        }
        item(key = "stats") {
            MiuixGlassCard {
                Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 21.dp)) {
                    Statistic(if (profile.todayMinutes % 1.0 == 0.0) profile.todayMinutes.toInt().toString() else "%.1f".format(profile.todayMinutes), "今日听力 · 分钟", Modifier.weight(1f))
                    Statistic(profile.todayArticles.toString(), "今日完成 · 篇", Modifier.weight(1f))
                    Statistic("%.1f".format(profile.totalHours), "总学习时长 · 小时", Modifier.weight(1f))
                }
            }
        }
        item(key = "calendar") { MiuixGlassCard { ActivityCalendar(profile.activity, Modifier.padding(horizontal = 16.dp, vertical = 20.dp)) } }
        item(key = "export") {
            MiuixGlassCard {
                Row(Modifier.fillMaxWidth().padding(start = 17.dp, end = 7.dp, top = 2.dp, bottom = 2.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text("学习记录", Modifier.weight(1f), fontSize = 15.sp)
                    NativeIcon(MiuixIcons.Download, "导出学习记录") { store.action("export") }
                }
            }
        }
        item(key = "recent") {
            MiuixGlassCard {
                Column(Modifier.padding(16.dp)) {
                    Text("最近练习", fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
                    if (profile.recent.isEmpty()) Text("暂无记录", Modifier.padding(top = 16.dp), color = muted(), fontSize = 14.sp)
                    profile.recent.forEach { recent ->
                        Card(Modifier.fillMaxWidth().nativeBounce(), colors = CardDefaults.defaultColors(Color.Transparent, accent()), onClick = { store.action("open", "paper" to recent.paper, "article" to recent.article) }) {
                            Column(Modifier.fillMaxWidth().padding(vertical = 12.dp)) {
                                Text(recent.paperTitle, fontSize = 14.sp, fontWeight = FontWeight.Medium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                Text(recent.articleTitle.replace(Regex("\\s*\\d+[-–—]\\d+题.*$"), ""), fontSize = 13.sp, color = muted(), modifier = Modifier.padding(top = 4.dp), maxLines = 1, overflow = TextOverflow.Ellipsis)
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable private fun Statistic(value: String, title: String, modifier: Modifier) {
    Column(modifier, horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(7.dp)) {
        Text(value, fontSize = 25.sp, fontWeight = FontWeight.Medium, maxLines = 1)
        Text(title, fontSize = 10.sp, color = muted(), maxLines = 1)
    }
}

@Composable private fun ReaderHeader(store: NativeUiStore) {
    val state = store.state
    val article = store.catalog.article(state.active.paper, state.active.article)
    Column(Modifier.statusBarsPadding().padding(horizontal = 12.dp)) {
        Row(Modifier.fillMaxWidth().height(49.dp), verticalAlignment = Alignment.CenterVertically) {
            NativeIcon(MiuixIcons.Back, "返回") { store.action("back") }
            Text(article?.label ?: "", Modifier.weight(1f).padding(horizontal = 6.dp), fontSize = 17.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
            NativeIcon(if (state.bookmarked) MiuixIcons.FavoritesFill else MiuixIcons.Favorites, if (state.bookmarked) "取消收藏" else "收藏", emphasized = state.bookmarked) { store.action("bookmark") }
        }
        Row(Modifier.fillMaxWidth().padding(top = 3.dp, bottom = 9.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            NativeSegments(listOf("精听", "做题"), if (state.mode == "exam") 1 else 0, Modifier.weight(1f)) { store.action("mode", "value" to if (it == 1) "exam" else "intensive") }
            if (state.mode != "exam") NativeSegments(listOf("隐藏", "原文", "双语"), listOf("hidden", "original", "bilingual").indexOf(state.display).coerceAtLeast(0), Modifier.weight(1.35f)) { store.action("display", "value" to listOf("hidden", "original", "bilingual")[it]) }
            else Spacer(Modifier.weight(1.35f))
        }
    }
}

@Composable private fun ReaderBody(store: NativeUiStore) {
    GlassPanel(Modifier.fillMaxSize().padding(horizontal = 8.dp), radius = 24.dp) { ReaderContents(store) }
}

@Composable private fun ReaderContents(store: NativeUiStore) {
    val state = store.state
    val article = store.catalog.article(state.active.paper, state.active.article)
    if (article == null) { EmptyText("暂无正文"); return }
    if (state.mode == "exam") { QuestionPage(store, article); return }
    if (state.display == "hidden") {
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { Icon(MiuixIcons.Music, null, tint = muted().copy(alpha = .5f), modifier = Modifier.size(42.dp)) }
        return
    }
    val list = remember(article.id, state.active.paper) { LazyListState() }
    val active by remember(article, state.active.paper) { derivedStateOf {
        val scrub = store.scrubTime.value
        if (scrub == null) store.progress.value.activeSentence
        else article.transcript.indexOfLast { it.timed && it.start <= scrub }
    } }
    LaunchedEffect(active) { if (active in article.transcript.indices && !list.isScrollInProgress) list.animateScrollToItem(active, -6) }
    LazyColumn(state = list, contentPadding = PaddingValues(start = 14.dp, end = 14.dp, top = 5.dp, bottom = 20.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        itemsIndexed(article.transcript, key = { index, _ -> "${article.id}:$index" }) { index, sentence ->
            val selected = active == index
            val row: @Composable () -> Unit = {
                Card(Modifier.fillMaxWidth().nativeBounce().testTag("sentence-$index").semantics { contentDescription = "第${index + 1}句" }, colors = CardDefaults.defaultColors(Color.Transparent, accent()), onClick = if (sentence.timed) ({ store.action("sentence", "index" to index) }) else null) {
                    Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 12.dp), verticalAlignment = Alignment.Top) {
                        Column(Modifier.weight(1f)) {
                            Text(sentence.en, fontSize = 20.sp, lineHeight = 31.sp, fontWeight = if (selected) FontWeight.Medium else FontWeight.Normal)
                            if (state.display == "bilingual" && sentence.zh.isNotBlank()) Text(sentence.zh, Modifier.padding(top = 9.dp), fontSize = 14.sp, lineHeight = 22.sp, color = muted())
                        }
                        if (sentence.timed) Text(clock(sentence.start - article.start), Modifier.padding(start = 9.dp, top = 5.dp), color = muted(), fontSize = 10.sp)
                    }
                }
            }
            if (selected) GlassPanel(Modifier.fillMaxWidth(), selected = true, radius = 23.dp) { row() } else row()
        }
        if (article.transcript.isEmpty()) item { EmptyText("暂无原文") }
    }
}

@Composable private fun QuestionPage(store: NativeUiStore, article: UiArticle) {
    val state = store.state
    val questions = state.questions.ifEmpty { article.questions }
    val dark = LocalNativeDark.current
    val correctColor = if (dark) Color(0xFF79DCA8) else Color(0xFF176B40)
    val wrongColor = if (dark) Color(0xFFFF9990) else Color(0xFFAA2D28)
    LazyColumn(contentPadding = PaddingValues(horizontal = 14.dp, vertical = 5.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        itemsIndexed(questions, key = { _, question -> "${state.active.paper}/${article.id}/${question.id}" }) { index, question ->
            val key = "${state.active.paper}/${article.id}/${question.id}"
            val expanded = store.expandedQuestions[key] != false
            Column {
                Card(Modifier.fillMaxWidth().nativeBounce(), colors = CardDefaults.defaultColors(Color.Transparent, accent()), onClick = { store.expandedQuestions[key] = !expanded; store.action("toggle-question", "index" to index) }) {
                    Row(Modifier.fillMaxWidth().heightIn(min = 32.dp).padding(start = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text(question.number.toString(), Modifier.weight(1f), fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
                        if (!expanded && question.choice.isNotBlank()) Text(question.choice, fontSize = 13.sp, color = muted())
                        RotatingDisclosure(expanded, if (expanded) "收起第${question.number}题选项" else "展开第${question.number}题选项") { store.expandedQuestions[key] = !expanded; store.action("toggle-question", "index" to index) }
                    }
                }
                AnimatedVisibility(expanded, enter = expandVertically(spring(dampingRatio = .85f, stiffness = 450f)) + fadeIn(), exit = shrinkVertically(spring(dampingRatio = .9f, stiffness = 450f)) + fadeOut()) {
                    Column(Modifier.fillMaxWidth().then(if (!expanded) Modifier.clearAndSetSemantics {} else Modifier), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                        question.options.forEach { option ->
                            val tintTarget = when {
                                option.wrong -> if (dark) Color(0xD9442321) else Color(0xD9FFE5E1)
                                option.correct -> if (dark) Color(0xD9123425) else Color(0xD9E3F5EB)
                                option.selected -> if (dark) Color(0x805A382A) else Color.White.copy(alpha = .62f)
                                else -> Color.Transparent
                            }
                            val tint by animateColorAsState(tintTarget, label = "answerFeedback")
                            val selected = option.selected || option.correct || option.wrong
                            val row: @Composable () -> Unit = {
                                Card(Modifier.fillMaxWidth().nativeBounce().testTag("answer-${question.id}-${option.id}").semantics { contentDescription = "第${question.number}题选项${option.key}" }, colors = CardDefaults.defaultColors(Color.Transparent, accent()), onClick = if (!question.submitted) ({ store.action("answer", "index" to index, "optionId" to option.id, "choice" to option.key) }) else null) {
                                    Row(Modifier.fillMaxWidth().heightIn(min = 35.dp).padding(horizontal = 10.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                                        val textColor = when { option.wrong -> wrongColor; option.correct -> correctColor; else -> accent() }
                                        Text(option.key, Modifier.width(25.dp), fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = textColor)
                                        Text(option.text, Modifier.weight(1f), fontSize = 13.sp, lineHeight = 18.sp, fontWeight = if (option.selected) FontWeight.Medium else FontWeight.Normal, color = textColor)
                                        if (option.correct || option.wrong) Icon(if (option.correct) MiuixIcons.Ok else MiuixIcons.Close, null, modifier = Modifier.padding(start = 5.dp).size(15.dp), tint = textColor)
                                    }
                                }
                            }
                            if (selected) GlassPanel(Modifier.fillMaxWidth(), selected = true, radius = 16.dp, color = tint) { row() } else row()
                        }
                    }
                }
            }
        }
        if (questions.isEmpty()) item { EmptyText("暂无题目") }
        else item(key = "submit") {
            GlassPanel(Modifier.fillMaxWidth().padding(top = 8.dp, bottom = 14.dp), selected = state.canSubmit, radius = 20.dp) {
                TextButton(
                    text = if (state.complete) "重新作答" else "提交", onClick = { store.action(if (state.complete) "restart-quiz" else "submit-article") },
                    modifier = Modifier.fillMaxWidth().nativeBounce(), enabled = state.canSubmit || state.complete,
                    colors = ButtonDefaults.textButtonColors(color = Color.Transparent, contentColor = accent()),
                )
            }
        }
    }
}

@Composable private fun ImportDialog(store: NativeUiStore) {
    OverlayDialog(show = store.importDialog, onDismissRequest = { store.importDialog = false }, backgroundColor = Color.Transparent, insideMargin = androidx.compose.ui.unit.DpSize(0.dp, 0.dp)) {
        MiuixGlassCard {
            Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text("导入资料", fontSize = 18.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(bottom = 5.dp))
                listOf("intensive" to "精听文件夹", "exam" to "整套试卷").forEach { (mode, title) ->
                    Button(onClick = { store.importDialog = false; store.action("choose-folder", "mode" to mode) }, Modifier.fillMaxWidth().nativeBounce(), colors = ButtonDefaults.buttonColors(color = Color.Transparent, contentColor = accent())) {
                        Icon(MiuixIcons.AddFolder, null, Modifier.size(22.dp))
                        Spacer(Modifier.width(9.dp)); Text(title, fontSize = 15.sp)
                    }
                }
            }
        }
    }
}

@Composable private fun EmptyText(text: String) { Box(Modifier.fillMaxWidth().padding(28.dp), contentAlignment = Alignment.Center) { Text(text, color = muted(), fontSize = 14.sp) } }
