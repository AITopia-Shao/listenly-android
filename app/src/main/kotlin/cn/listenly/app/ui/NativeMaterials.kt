package cn.listenly.app.ui

import android.graphics.BitmapFactory
import android.os.Build
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.waitForUpOrCancellation
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.composed
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject

/** No high-API shader/backdrop types cross this interface or the API26 path. */
internal interface NativeGlassRuntime {
    @Composable fun Capture(modifier: Modifier, content: @Composable BoxScope.() -> Unit)
    @Composable fun Surface(modifier: Modifier, radius: Dp, selected: Boolean, tint: Color, content: @Composable BoxScope.() -> Unit)
}
private object CompatibleGlassRuntime : NativeGlassRuntime {
    @Composable override fun Capture(modifier: Modifier, content: @Composable BoxScope.() -> Unit) { Box(modifier, content = content) }
    @Composable override fun Surface(modifier: Modifier, radius: Dp, selected: Boolean, tint: Color, content: @Composable BoxScope.() -> Unit) {
        val shape = RoundedCornerShape(radius)
        Box(modifier.clip(shape).background(Brush.verticalGradient(listOf(tint.copy(alpha = (tint.alpha + .12f).coerceAtMost(.9f)), tint))).border(.7.dp, Color.White.copy(alpha = if (selected) .32f else .18f), shape), content = content)
    }
}
internal val LocalNativeGlass = staticCompositionLocalOf<NativeGlassRuntime> { CompatibleGlassRuntime }
internal val LocalNativeDark = staticCompositionLocalOf { false }

@Composable internal fun ProvideNativeGlass(dark: Boolean, content: @Composable () -> Unit) {
    val runtime = if (Build.VERSION.SDK_INT >= 33) Api33NativeGlass.rememberRuntime() else CompatibleGlassRuntime
    CompositionLocalProvider(LocalNativeGlass provides runtime, LocalNativeDark provides dark, content = content)
}

/** Observe gestures without consuming or replacing the real Miuix click. */
internal fun Modifier.nativeBounce(): Modifier = composed {
    var pressed by remember { mutableStateOf(false) }
    val scale = animateFloatAsState(if (pressed) .955f else 1f, spring(dampingRatio = .62f, stiffness = 620f), label = "miuixPress")
    graphicsLayer { scaleX = scale.value; scaleY = scale.value }
        .pointerInput(Unit) {
            awaitEachGesture {
                awaitFirstDown(requireUnconsumed = false, pass = PointerEventPass.Initial)
                pressed = true
                try { waitForUpOrCancellation(pass = PointerEventPass.Final) } finally { pressed = false }
            }
        }
}

@Composable internal fun GlassPanel(modifier: Modifier = Modifier, selected: Boolean = false, radius: Dp = 24.dp, color: Color? = null, content: @Composable BoxScope.() -> Unit) {
    val dark = LocalNativeDark.current
    val tint = color ?: if (dark) Color(0xFF070707).copy(alpha = if (selected) .57f else .66f) else Color.White.copy(alpha = if (selected) .47f else .67f)
    LocalNativeGlass.current.Surface(modifier, radius, selected, tint, content)
}

@Composable internal fun WallpaperScene(dark: Boolean) {
    val context = LocalContext.current
    val images by produceState<Pair<android.graphics.Bitmap?, android.graphics.Bitmap?>>(null to null, context) {
        value = withContext(Dispatchers.IO) {
            try {
                val manifest = JSONObject(context.assets.open("web/wallpapers.json").bufferedReader().use { it.readText() })
                fun decode(key: String): android.graphics.Bitmap? {
                    val path = manifest.optString(key)
                    if (!path.matches(Regex("wallpapers/[A-Za-z0-9_.-]+\\.(png|jpg|jpeg|webp)"))) return null
                    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
                    context.assets.open("web/$path").use { BitmapFactory.decodeStream(it, null, bounds) }
                    var sample = 1
                    while (bounds.outWidth.toLong() * bounds.outHeight / sample / sample > 3_000_000) sample *= 2
                    val options = BitmapFactory.Options().apply { inSampleSize = sample; inPreferredConfig = android.graphics.Bitmap.Config.ARGB_8888 }
                    return context.assets.open("web/$path").use { BitmapFactory.decodeStream(it, null, options) }
                }
                decode("day") to decode("night")
            } catch (_: Exception) { null to null }
        }
    }
    val alpha = animateFloatAsState(if (dark) 1f else 0f, tween(420), label = "wallpaperAppearance")
    LocalNativeGlass.current.Capture(Modifier.fillMaxSize()) {
        val day = images.first
        val night = images.second
        if (day != null) Image(day.asImageBitmap(), null, Modifier.fillMaxSize(), contentScale = ContentScale.Crop)
        else Box(Modifier.fillMaxSize().background(Brush.linearGradient(listOf(Color(0xFFD1DDEA), Color(0xFFE4C8AE), Color(0xFFB2C6D5)))))
        Box(Modifier.fillMaxSize().graphicsLayer { this.alpha = alpha.value }) {
            if (night != null) Image(night.asImageBitmap(), null, Modifier.fillMaxSize(), contentScale = ContentScale.Crop)
            else Box(Modifier.fillMaxSize().background(Brush.linearGradient(listOf(Color(0xFF121827), Color(0xFF20202B), Color(0xFF0D1019)))))
        }
        Box(Modifier.fillMaxSize().background(if (dark) Color.Black.copy(alpha = .18f) else Color.White.copy(alpha = .12f)))
    }
}
