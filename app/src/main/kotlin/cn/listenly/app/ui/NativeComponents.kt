package cn.listenly.app.ui

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import top.yukonga.miuix.kmp.basic.*
import top.yukonga.miuix.kmp.icon.MiuixIcons
import top.yukonga.miuix.kmp.icon.extended.*
import top.yukonga.miuix.kmp.theme.MiuixTheme
import top.yukonga.miuix.kmp.utils.PressFeedbackType
import java.time.LocalDate
import java.time.temporal.ChronoUnit
import kotlinx.coroutines.CancellationException
import kotlin.math.abs
import kotlin.math.floor

internal val CorrectGreen = Color(0xFF24834E)
internal val WrongRed = Color(0xFFC9453F)
@Composable internal fun accent(): Color = MiuixTheme.colorScheme.onBackground
@Composable internal fun muted(): Color = MiuixTheme.colorScheme.onSurfaceVariantSummary

@Composable internal fun MiuixGlassCard(modifier: Modifier = Modifier, selected: Boolean = false, color: Color? = null, onClick: (() -> Unit)? = null, content: @Composable ColumnScope.() -> Unit) {
    GlassPanel(modifier, selected = selected, color = color) {
        Card(
            modifier = Modifier.fillMaxWidth().then(if (onClick != null) Modifier.nativeBounce() else Modifier),
            colors = CardDefaults.defaultColors(Color.Transparent, accent()),
            cornerRadius = 24.dp,
            pressFeedbackType = PressFeedbackType.Sink,
            onClick = onClick,
            content = content,
        )
    }
}

@Composable internal fun NativeIcon(icon: ImageVector, label: String, modifier: Modifier = Modifier, enabled: Boolean = true, emphasized: Boolean = false, onClick: () -> Unit) {
    IconButton(onClick, modifier.nativeBounce(), enabled = enabled, holdDownState = emphasized, backgroundColor = Color.Transparent, cornerRadius = 17.dp, minWidth = 44.dp, minHeight = 44.dp) {
        Icon(icon, contentDescription = label, tint = if (enabled) accent() else muted().copy(alpha = .45f), modifier = Modifier.size(24.dp))
    }
}

/** Real TabRow hit targets and labels, with one native spring-driven glass lens. */
@Composable internal fun NativeSegments(tabs: List<String>, index: Int, modifier: Modifier = Modifier, onSelect: (Int) -> Unit) {
    val position = remember { Animatable(index.toFloat()) }
    LaunchedEffect(index) {
        val trace = NativeMotionTrace.begin(tabs.joinToString("|"), position.value, index.toFloat())
        var cancelled = true
        try {
            position.animateTo(index.toFloat(), spring(dampingRatio = .68f, stiffness = 430f)) { NativeMotionTrace.frame(trace, value, velocity) }
            cancelled = false
        } finally { NativeMotionTrace.end(trace, cancelled) }
    }
    GlassPanel(modifier.height(42.dp), radius = 23.dp) {
        BoxWithConstraints(Modifier.fillMaxSize().padding(3.dp)) {
            val width = maxWidth / tabs.size
            val density = LocalDensity.current
            GlassPanel(
                Modifier.width(width).fillMaxHeight().graphicsLayer {
                    translationX = with(density) { width.toPx() } * position.value
                    val viscosity = (abs(position.velocity) * .012f).coerceAtMost(.09f)
                    scaleX = 1f + viscosity; scaleY = 1f - viscosity * .45f
                }.clearAndSetSemantics {}, selected = true, radius = 20.dp,
            ) { }
            TabRow(
                tabs, index, onSelect, Modifier.fillMaxWidth().nativeBounce(),
                colors = TabRowDefaults.tabRowColors(backgroundColor = Color.Transparent, contentColor = muted(), selectedBackgroundColor = Color.Transparent, selectedContentColor = accent()),
                minWidth = width, maxWidth = width, itemSpacing = 0.dp, height = 36.dp,
            )
        }
    }
}

@Composable internal fun NativeNavigation(store: NativeUiStore) {
    val routes = listOf("home", "library", "profile")
    val labels = listOf("听力", "资料库", "我的")
    val icons = listOf(MiuixIcons.Music, MiuixIcons.Folder, MiuixIcons.Contacts)
    val index = routes.indexOf(store.state.route).coerceAtLeast(0)
    val position = remember { Animatable(index.toFloat()) }
    LaunchedEffect(index) {
        val trace = NativeMotionTrace.begin("听力|资料库|我的", position.value, index.toFloat())
        var cancelled = true
        try {
            position.animateTo(index.toFloat(), spring(dampingRatio = .7f, stiffness = 390f)) { NativeMotionTrace.frame(trace, value, velocity) }
            cancelled = false
        } finally { NativeMotionTrace.end(trace, cancelled) }
    }
    Box(Modifier.navigationBarsPadding().padding(horizontal = 16.dp, vertical = 8.dp)) {
        GlassPanel(Modifier.fillMaxWidth(), radius = 29.dp) {
            BoxWithConstraints(Modifier.fillMaxWidth()) {
                val itemWidth = (maxWidth - 8.dp) / 3
                val density = LocalDensity.current
                GlassPanel(Modifier.padding(4.dp).width(itemWidth).height(60.dp).graphicsLayer {
                    translationX = with(density) { itemWidth.toPx() } * position.value
                    val viscosity = (abs(position.velocity) * .011f).coerceAtMost(.12f)
                    scaleX = 1f + viscosity; scaleY = 1f - viscosity * .5f
                }.clearAndSetSemantics {}, selected = true, radius = 25.dp) { }
                NavigationBar(color = Color.Transparent, showDivider = false, defaultWindowInsetsPadding = false) {
                    routes.forEachIndexed { i, route ->
                        NavigationBarItem(selected = index == i, onClick = { store.action("nav", "route" to route) }, icon = icons[i], label = labels[i], modifier = Modifier.nativeBounce())
                    }
                }
            }
        }
    }
}

internal fun clock(value: Double): String {
    val seconds = floor(value.coerceAtLeast(0.0)).toInt()
    return "%02d:%02d".format(seconds / 60, seconds % 60)
}

@Composable internal fun NativeTransport(store: NativeUiStore, reference: UiRef, modifier: Modifier = Modifier) {
    val state = store.state
    val progress = store.progress.value
    val paper = store.catalog.paper(reference.paper)
    val article = store.catalog.article(reference.paper, reference.article)
    val same = state.active.paper == reference.paper
    // Home progress also carries the selected paper's saved clock before its
    // decoder becomes active. Reading it must not imply that paper is playing.
    val matchingProgress = progress.paper == reference.paper
    val duration = (if (matchingProgress && progress.duration > 0) progress.duration else paper?.duration ?: 0.0).coerceAtLeast(0.0)
    val observedTime = if (matchingProgress) progress.time else article?.start ?: 0.0
    val time = store.scrubTime.value ?: observedTime
    val playing = same && matchingProgress && progress.playing
    Column(modifier.padding(horizontal = 14.dp, vertical = 9.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(9.dp)) {
            Text(clock(time), fontSize = 11.sp, color = muted(), modifier = Modifier.width(38.dp))
            Slider(
                value = time.toFloat().coerceIn(0f, duration.toFloat().coerceAtLeast(1f)),
                onValueChange = { value ->
                    if (store.scrubTime.value == null) store.action("scrub-start")
                    store.scrubTime.value = value.toDouble()
                },
                onValueChangeFinished = {
                    val target = store.scrubTime.value ?: time
                    store.commitScrub(target)
                },
                valueRange = 0f..duration.toFloat().coerceAtLeast(1f),
                enabled = duration > 0 && paper?.audioAvailable == true,
                height = 24.dp, modifier = Modifier.weight(1f),
            )
            Text(clock(duration), fontSize = 11.sp, color = muted(), modifier = Modifier.width(38.dp))
        }
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
            GlassPanel(Modifier.width(68.dp).height(40.dp), radius = 18.dp) {
                Button(onClick = { store.action("speed") }, modifier = Modifier.fillMaxSize().nativeBounce(), minWidth = 0.dp, minHeight = 40.dp, colors = ButtonDefaults.buttonColors(color = Color.Transparent)) {
                    Text("${state.speed.toString().removeSuffix(".0")}×", fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
                }
            }
            NativeIcon(MiuixIcons.Undo, "后退5秒", enabled = duration > 0) { store.action("seek-relative", "seconds" to -5) }
            GlassPanel(Modifier.size(width = 62.dp, height = 48.dp), selected = playing, radius = 19.dp) {
                NativeIcon(if (playing) MiuixIcons.Pause else MiuixIcons.Play, if (playing) "暂停" else "播放", Modifier.fillMaxSize(), enabled = paper?.audioAvailable != false, emphasized = playing) {
                    if (!same || state.active.article != reference.article) store.action("home-play", "paper" to reference.paper, "article" to reference.article)
                    else store.action(if (playing) "pause" else "play")
                }
            }
            NativeIcon(MiuixIcons.Redo, "前进5秒", enabled = duration > 0) { store.action("seek-relative", "seconds" to 5) }
            val mode = state.playbackMode
            val icon = when { mode.contains("shuffle") || mode.contains("random") -> MiuixIcons.Replace; mode.contains("repeat") || mode == "article" -> MiuixIcons.Refresh; else -> MiuixIcons.Playlist }
            val modeLabel = when (icon) { MiuixIcons.Replace -> "随机播放"; MiuixIcons.Refresh -> "单篇循环"; else -> "顺序播放" }
            GlassPanel(Modifier.width(68.dp).height(40.dp), radius = 18.dp) {
                NativeIcon(icon, modeLabel, Modifier.fillMaxSize()) { store.action("playback-mode") }
            }
        }
    }
}

@Composable internal fun ActivityCalendar(activity: List<UiActivity>, modifier: Modifier = Modifier) {
    val today = remember { LocalDate.now() }
    val start = remember(today) { today.minusDays(364L + (today.dayOfWeek.value % 7)) }
    val counts = remember(activity) { activity.associate { it.date to it.count } }
    val dark = LocalNativeDark.current
    val active = if (dark) Color(0xFFE8A078) else CorrectGreen
    val empty = if (dark) Color.White.copy(alpha = .1f) else Color.Black.copy(alpha = .08f)
    Canvas(modifier.fillMaxWidth().height(81.dp).clearAndSetSemantics { contentDescription = "学习活跃日历" }) {
        val columns = (ChronoUnit.DAYS.between(start, today).toInt() / 7) + 1
        val gap = 2.dp.toPx()
        val cell = ((size.width - (columns - 1) * gap) / columns).coerceAtLeast(1f)
        for (column in 0 until columns) for (row in 0..6) {
            val date = start.plusDays((column * 7 + row).toLong())
            if (date > today) continue
            val count = counts[date.toString()] ?: 0
            val intensity = when { count >= 8 -> 1f; count >= 4 -> .78f; count >= 2 -> .56f; count > 0 -> .32f; else -> 0f }
            drawRoundRect(if (count > 0) active.copy(alpha = intensity) else empty, Offset(column * (cell + gap), row * (cell + gap)), Size(cell, cell), CornerRadius(1.4.dp.toPx()))
        }
    }
}
