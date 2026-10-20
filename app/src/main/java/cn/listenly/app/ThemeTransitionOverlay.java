package cn.listenly.app;

import android.animation.Animator;
import android.animation.AnimatorListenerAdapter;
import android.app.Activity;
import android.graphics.Bitmap;
import android.graphics.Rect;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.view.Gravity;
import android.view.PixelCopy;
import android.view.View;
import android.view.animation.PathInterpolator;
import android.webkit.WebView;
import android.widget.FrameLayout;
import android.widget.ImageView;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayDeque;
import java.util.concurrent.atomic.AtomicBoolean;

/** One bounded old-frame texture above the existing, continuously alive WebView. */
public final class ThemeTransitionOverlay {
    private static final long MAX_PIXELS = 2_000_000L;
    private static final long DURATION_MS = 260L;
    private static final long CAPTURE_TIMEOUT_MS = 900L;
    private static final long VISUAL_TIMEOUT_MS = 500L;
    private static final int MAX_RECORDS = 32;
    private static final PathInterpolator EASING = new PathInterpolator(.4f, 0f, .2f, 1f);
    private final Activity activity;
    private final FrameLayout host;
    private final WebView webView;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final ArrayDeque<JSONObject> records = new ArrayDeque<>();
    private final AtomicBoolean diagnosticRefreshQueued = new AtomicBoolean();
    private volatile String cachedDiagnostics = "{\"active\":false}";
    private Session current;
    private JSONObject lastSession = new JSONObject();
    private long generation;
    private long nativeAnimationCount;

    private static final class Session {
        final long id, generation, captureStart;
        long visualRequest, animationRequest;
        String phase = "capture";
        Bitmap bitmap;
        ImageView image;
        Runnable captureTimeout, visualTimeout;
        boolean capturePending, ready, displayed, animateQueued, queuedOriginal, firstVisualReady;
        int width, height, sourceWidth, sourceHeight, copyResult = -1, animations;
        long captureMs;
        float targetAlpha = 1f;
        Session(long id, long generation) {
            this.id = id;
            this.generation = generation;
            this.captureStart = SystemClock.uptimeMillis();
        }
    }

    public ThemeTransitionOverlay(Activity activity, FrameLayout host, WebView webView) {
        requireUiThread();
        this.activity = activity;
        this.host = host;
        this.webView = webView;
        note("constructed", null, null);
    }

    /** Called before the JS endpoint palette is changed. */
    public void begin(long id) {
        requireUiThread();
        if (current != null && current.id == id) {
            note("duplicate-begin", current, null);
            if (current.ready) notifyReady(current, true);
            return;
        }
        clearCurrent("superseded");
        final Session session = new Session(id, ++generation);
        current = session;
        if (activity.isFinishing() || activity.isDestroyed() || !webView.isAttachedToWindow()
                || !host.isAttachedToWindow() || webView.getWidth() <= 0 || webView.getHeight() <= 0) {
            failCapture(session, PixelCopy.ERROR_SOURCE_NO_DATA, "window-not-ready");
            return;
        }
        int[] location = new int[2];
        webView.getLocationInWindow(location);
        session.sourceWidth = webView.getWidth();
        session.sourceHeight = webView.getHeight();
        double scale = Math.min(1d, Math.sqrt((double) MAX_PIXELS /
                ((double) session.sourceWidth * session.sourceHeight)));
        session.width = Math.max(1, (int) Math.floor(session.sourceWidth * scale));
        session.height = Math.max(1, (int) Math.floor(session.sourceHeight * scale));
        if ((long) session.width * session.height > MAX_PIXELS)
            session.height = Math.max(1, (int) (MAX_PIXELS / session.width));
        Rect crop = new Rect(location[0], location[1], location[0] + session.sourceWidth,
                location[1] + session.sourceHeight);
        try {
            final Bitmap captured = Bitmap.createBitmap(session.width, session.height, Bitmap.Config.ARGB_8888);
            session.bitmap = captured;
            session.capturePending = true;
            session.captureTimeout = () -> {
                if (isCurrent(session) && session.capturePending)
                    failCapture(session, PixelCopy.ERROR_TIMEOUT, "pixel-copy-deadline");
            };
            main.postDelayed(session.captureTimeout, CAPTURE_TIMEOUT_MS);
            note("pixel-copy-request", session, null);
            PixelCopy.request(activity.getWindow(), crop, captured, result -> {
                session.capturePending = false;
                cancelCaptureTimeout(session);
                session.copyResult = result;
                session.captureMs = SystemClock.uptimeMillis() - session.captureStart;
                if (!isCurrent(session)) {
                    recycleNeverDisplayed(session);
                    return;
                }
                if (result != PixelCopy.SUCCESS || !webView.isAttachedToWindow() || !host.isAttachedToWindow()) {
                    failCapture(session, result, "pixel-copy-unavailable");
                    return;
                }
                try {
                    int[] hostLocation = new int[2], viewLocation = new int[2];
                    host.getLocationInWindow(hostLocation);
                    webView.getLocationInWindow(viewLocation);
                    if (webView.getWidth() != session.sourceWidth || webView.getHeight() != session.sourceHeight
                            || viewLocation[0] != crop.left || viewLocation[1] != crop.top) {
                        failCapture(session, PixelCopy.ERROR_SOURCE_INVALID, "geometry-changed");
                        return;
                    }
                    ImageView image = new ImageView(activity);
                    image.setScaleType(ImageView.ScaleType.FIT_XY);
                    image.setClickable(false);
                    image.setLongClickable(false);
                    image.setFocusable(false);
                    image.setFocusableInTouchMode(false);
                    image.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
                    image.setContentDescription(null);
                    image.setAlpha(1f);
                    image.setImageBitmap(captured);
                    FrameLayout.LayoutParams layout = new FrameLayout.LayoutParams(session.sourceWidth, session.sourceHeight);
                    layout.gravity = Gravity.TOP | Gravity.LEFT;
                    layout.leftMargin = viewLocation[0] - hostLocation[0];
                    layout.topMargin = viewLocation[1] - hostLocation[1];
                    session.image = image;
                    host.addView(image, layout);
                    session.displayed = true;
                    session.ready = true;
                    session.phase = "ready";
                    note("pixel-copy-ready", session, null);
                    notifyReady(session, true);
                    if (session.animateQueued) animate(session.id, session.queuedOriginal);
                } catch (RuntimeException | LinkageError | OutOfMemoryError failure) {
                    failCapture(session, PixelCopy.ERROR_DESTINATION_INVALID, failure.getClass().getSimpleName());
                }
            }, main);
        } catch (RuntimeException | LinkageError | OutOfMemoryError failure) {
            session.capturePending = false;
            failCapture(session, PixelCopy.ERROR_DESTINATION_INVALID, failure.getClass().getSimpleName());
        }
    }

    /** Keep one capture; reversing changes only its native alpha destination. */
    public void animate(long id, boolean toOriginal) {
        requireUiThread();
        Session session = current;
        if (session == null || session.id != id) return;
        if (!session.ready) {
            session.animateQueued = true;
            session.queuedOriginal = toOriginal;
            note("animation-queued", session, null);
            return;
        }
        session.animateQueued = false;
        stopAnimation(session);
        session.targetAlpha = toOriginal ? 1f : 0f;
        if (session.firstVisualReady) {
            // The live page still holds the same already-drawn endpoint. A
            // reversal changes only this one texture's alpha, so do not pause
            // the fade behind another renderer round trip.
            ++session.visualRequest;
            cancelVisualTimeout(session);
            startAnimation(session, toOriginal);
            return;
        }
        if ("visual-ready-wait".equals(session.phase)) {
            // Keep the first visual barrier and its original deadline, but
            // let its callback consume the most recent requested direction.
            note("visual-target-updated", session, null);
            return;
        }
        final long visual = ++session.visualRequest;
        session.phase = "visual-ready-wait";
        note("visual-state-request", session, null);
        armVisualTimeout(session, visual, () -> abortForVisualFailure(session, "visual-state-deadline"));
        try {
            webView.postVisualStateCallback(visual, new WebView.VisualStateCallback() {
                @Override public void onComplete(long requestId) {
                    if (!isCurrent(session) || session.visualRequest != visual) return;
                    webView.postOnAnimation(() -> {
                        if (isCurrent(session) && session.visualRequest == visual) {
                            cancelVisualTimeout(session);
                            session.firstVisualReady = true;
                            startAnimation(session, session.targetAlpha > .5f);
                        }
                    });
                }
            });
        } catch (RuntimeException | LinkageError failure) {
            abortForVisualFailure(session, "visual-state-" + failure.getClass().getSimpleName());
        }
    }

    /** JS has committed the correct endpoint DOM; release only after it is drawable. */
    public void finish(long id) {
        requireUiThread();
        final Session session = current;
        if (session == null || session.id != id) return;
        stopAnimation(session);
        final long visual = ++session.visualRequest;
        session.phase = "finish-ready-wait";
        note("finish-request", session, null);
        // Renderer/lifecycle failures must never leave a captured frame above
        // the live page indefinitely. A visual callback is preferred, but
        // release is bounded even when Chromium stops answering callbacks.
        armVisualTimeout(session, visual, () -> clearCurrent("finish-ready-deadline"));
        try {
            webView.postVisualStateCallback(visual, new WebView.VisualStateCallback() {
                @Override public void onComplete(long requestId) {
                    if (!isCurrent(session) || session.visualRequest != visual) return;
                    webView.postOnAnimation(() -> {
                        if (isCurrent(session) && session.visualRequest == visual) {
                            cancelVisualTimeout(session);
                            clearCurrent("finished");
                        }
                    });
                }
            });
        } catch (RuntimeException | LinkageError failure) {
            clearCurrent("finish-unavailable");
        }
    }

    public void cancel() {
        requireUiThread();
        clearCurrent("cancelled");
        ++generation;
    }

    /** Background bridge callers get a labelled last-UI sample and queue a refresh. */
    public String diagnostics() {
        if (Looper.myLooper() == Looper.getMainLooper()) {
            refreshDiagnostics();
        } else if (diagnosticRefreshQueued.compareAndSet(false, true)) {
            main.post(() -> {
                diagnosticRefreshQueued.set(false);
                refreshDiagnostics();
            });
        }
        return cachedDiagnostics;
    }

    private void startAnimation(Session session, boolean toOriginal) {
        if (!isCurrent(session) || session.image == null) return;
        final long animation = ++session.animationRequest;
        final float target = toOriginal ? 1f : 0f;
        session.targetAlpha = target;
        session.phase = "animating";
        note("animation-start", session, null);
        if (Math.abs(session.image.getAlpha() - target) < .0001f) {
            session.image.setAlpha(target);
            session.phase = "endpoint";
            note("animation-already-endpoint", session, null);
            notifyEnd(session, toOriginal);
            return;
        }
        ++session.animations;
        ++nativeAnimationCount;
        // A static ImageView texture is alpha-composited by the native view
        // pipeline. withLayer requests a hardware layer; it is not a promise
        // that every vendor drives the animation timeline on RenderThread.
        session.image.animate().alpha(target).setDuration(DURATION_MS).setInterpolator(EASING)
                .withLayer().setListener(new AnimatorListenerAdapter() {
                    private boolean cancelled;
                    @Override public void onAnimationCancel(Animator animator) { cancelled = true; }
                    @Override public void onAnimationEnd(Animator animator) {
                        if (cancelled || !isCurrent(session) || session.animationRequest != animation) return;
                        session.image.setAlpha(target);
                        session.phase = "endpoint";
                        note("animation-end", session, null);
                        notifyEnd(session, toOriginal);
                    }
                }).start();
        refreshDiagnostics();
    }

    private void stopAnimation(Session session) {
        ++session.animationRequest;
        if (session.image == null) return;
        float alpha = session.image.getAlpha();
        session.image.animate().setListener(null);
        session.image.animate().cancel();
        session.image.setAlpha(alpha);
    }

    private void armVisualTimeout(Session session, long visual, Runnable action) {
        cancelVisualTimeout(session);
        session.visualTimeout = () -> {
            session.visualTimeout = null;
            if (isCurrent(session) && session.visualRequest == visual) action.run();
        };
        main.postDelayed(session.visualTimeout, VISUAL_TIMEOUT_MS);
    }

    private void cancelVisualTimeout(Session session) {
        if (session.visualTimeout != null) {
            main.removeCallbacks(session.visualTimeout);
            session.visualTimeout = null;
        }
    }

    private void cancelCaptureTimeout(Session session) {
        if (session.captureTimeout != null) {
            main.removeCallbacks(session.captureTimeout);
            session.captureTimeout = null;
        }
    }

    private void failCapture(Session session, int result, String reason) {
        if (!isCurrent(session)) { recycleNeverDisplayed(session); return; }
        session.copyResult = result;
        session.captureMs = SystemClock.uptimeMillis() - session.captureStart;
        session.phase = "capture-failed";
        note("capture-failed", session, reason);
        notifyReady(session, false);
        clearCurrent("capture-released");
    }

    private void abortForVisualFailure(Session session, String reason) {
        if (!isCurrent(session)) return;
        note("visual-state-failed", session, reason);
        notifyReady(session, false);
        clearCurrent("visual-state-released");
    }

    private void clearCurrent(String phase) {
        Session session = current;
        if (session == null) { refreshDiagnostics(); return; }
        cancelCaptureTimeout(session);
        cancelVisualTimeout(session);
        ++session.visualRequest;
        stopAnimation(session);
        session.phase = phase;
        note("release", session, null);
        current = null;
        if (session.image != null) {
            host.removeView(session.image);
            session.image.setImageDrawable(null);
            session.image.setLayerType(View.LAYER_TYPE_NONE, null);
            session.image = null;
        }
        // A displayed bitmap can still be referenced by a RenderThread
        // display list. Detach it and let normal reference lifetime free it;
        // only never-displayed, completed copies are safe to recycle here.
        recycleNeverDisplayed(session);
        if (session.displayed) session.bitmap = null;
        refreshDiagnostics();
    }

    private void recycleNeverDisplayed(Session session) {
        if (!session.displayed && !session.capturePending && session.bitmap != null) {
            if (!session.bitmap.isRecycled()) session.bitmap.recycle();
            session.bitmap = null;
        }
    }

    private boolean isCurrent(Session session) {
        return current == session && session.generation == generation;
    }

    private void notifyReady(Session session, boolean success) {
        callJs("listenlyThemeNativeReady", session.id, success);
    }

    private void notifyEnd(Session session, boolean original) {
        callJs("listenlyThemeNativeEnd", session.id, original);
    }

    private void callJs(String method, long id, boolean value) {
        try {
            if (webView.isAttachedToWindow()) webView.evaluateJavascript(
                    "if(typeof window." + method + "==='function')window." + method + "(" + id + "," + value + ");", null);
        } catch (RuntimeException | LinkageError failure) {
            note("callback-unavailable", current, failure.getClass().getSimpleName());
        }
    }

    private JSONObject sample(Session session) {
        if (session == null) return new JSONObject();
        return json("id", session.id, "generation", session.generation, "phase", session.phase,
                "ready", session.ready, "capturePending", session.capturePending,
                "firstVisualReady", session.firstVisualReady,
                "pixelCopyResult", session.copyResult, "captureMs", session.captureMs,
                "width", session.width, "height", session.height, "pixels", (long) session.width * session.height,
                "sourceWidth", session.sourceWidth, "sourceHeight", session.sourceHeight,
                "alpha", session.image == null ? JSONObject.NULL : session.image.getAlpha(),
                "targetAlpha", session.targetAlpha, "nativeAnimationCount", session.animations);
    }

    private void note(String event, Session session, String detail) {
        JSONObject row = sample(session);
        try {
            row.put("event", event);
            row.put("atUptimeMs", SystemClock.uptimeMillis());
            if (detail != null) row.put("detail", detail.length() > 160 ? detail.substring(0, 160) : detail);
        } catch (JSONException ignored) { }
        records.addLast(row);
        while (records.size() > MAX_RECORDS) records.removeFirst();
        if (session != null) lastSession = sample(session);
        refreshDiagnostics();
    }

    private void refreshDiagnostics() {
        JSONArray history = new JSONArray();
        for (JSONObject row : records) history.put(row);
        cachedDiagnostics = json("active", current != null, "current", sample(current), "last", lastSession,
                "nativeAnimationCount", nativeAnimationCount, "maxPixels", MAX_PIXELS,
                "captureTimeoutMs", CAPTURE_TIMEOUT_MS, "visualTimeoutMs", VISUAL_TIMEOUT_MS,
                "alphaSampleAtUptimeMs", SystemClock.uptimeMillis(),
                "alphaSampleKind", "View property sampled on UI thread; off-UI callers receive the latest cached sample",
                "hardwareAccelerated", webView.isHardwareAccelerated(),
                "animationBackend", "Native ViewPropertyAnimator with hardware-layer request; actual thread requires a system trace",
                "records", history).toString();
    }

    private static JSONObject json(Object... pairs) {
        JSONObject value = new JSONObject();
        for (int index = 0; index + 1 < pairs.length; index += 2) {
            try { value.put((String) pairs[index], pairs[index + 1]); }
            catch (JSONException ignored) { }
        }
        return value;
    }

    private static void requireUiThread() {
        if (Looper.myLooper() != Looper.getMainLooper()) throw new IllegalStateException("Theme overlay mutations require the UI thread");
    }
}
