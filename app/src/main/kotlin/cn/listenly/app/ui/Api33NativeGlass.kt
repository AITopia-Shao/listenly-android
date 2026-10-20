package cn.listenly.app.ui

import androidx.annotation.RequiresApi
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import top.yukonga.miuix.kmp.blur.LayerBackdrop
import top.yukonga.miuix.kmp.blur.blur
import top.yukonga.miuix.kmp.blur.drawBackdrop
import top.yukonga.miuix.kmp.blur.layerBackdrop
import top.yukonga.miuix.kmp.blur.rememberLayerBackdrop

/** Loaded only through the SDK33 branch. No RuntimeShader type leaks into the API26 host. */
@RequiresApi(33)
internal object Api33NativeGlass {
    @Composable fun rememberRuntime(): NativeGlassRuntime {
        val backdrop = rememberLayerBackdrop()
        return remember(backdrop) { Runtime(backdrop) }
    }
    private class Runtime(private val backdrop: LayerBackdrop) : NativeGlassRuntime {
        @Composable override fun Capture(modifier: Modifier, content: @Composable BoxScope.() -> Unit) {
            Box(modifier.layerBackdrop(backdrop), content = content)
        }
        @Composable override fun Surface(modifier: Modifier, radius: Dp, selected: Boolean, tint: Color, content: @Composable BoxScope.() -> Unit) {
            Box(modifier.drawBackdrop(
                backdrop = backdrop,
                shape = { RoundedCornerShape(radius) },
                effects = {
                    blur(if (selected) 9.dp.toPx() else 17.dp.toPx())
                    if (selected) lens(refractionHeight = 12.dp.toPx(), refractionAmount = 10.dp.toPx())
                },
                onDrawSurface = { drawRect(tint) },
            ), content = content)
        }
    }
}
