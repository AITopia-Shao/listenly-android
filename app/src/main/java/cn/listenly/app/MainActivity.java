package cn.listenly.app;

import android.app.Activity;
import android.content.Intent;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageInfo;
import android.content.res.Configuration;
import android.database.Cursor;
import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.DocumentsContract;
import android.view.View;
import android.view.Display;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;
import android.widget.FrameLayout;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.PrintWriter;
import java.io.StringWriter;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Offline, single-origin Android host. User-selected folders are copied into app-private storage. */
public final class MainActivity extends Activity {
    private static final String HOST = "listenly.local";
    private static final String START = "https://" + HOST + "/assets/index.html";
    private static final int IMPORT_REQUEST = 401;
    private static final int EXPORT_REQUEST = 402;
    private static final long MAX_FILE_BYTES = 512L * 1024 * 1024;
    private static final long MAX_IMPORT_BYTES = 2L * 1024 * 1024 * 1024;
    private static final int MAX_TEXT_BYTES = 1024 * 1024;
    private static final int MAX_INLINE_BYTES = 16 * 1024 * 1024;
    private static final int MAX_FILES = 25000;
    private WebView webView;
    private volatile ThemeTransitionOverlay themeTransition;
    private File importsRoot;
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private volatile boolean importing;
    private String pendingMode;
    private String pendingExport;
    private Object backCallback;
    private final StringBuilder startupWarnings = new StringBuilder();
    private float insetTop, insetBottom, insetLeft, insetRight;
    private float sentInsetTop, sentInsetBottom, sentInsetLeft, sentInsetRight;
    private boolean insetsSent;
    private boolean darkTheme;
    private boolean windowThemeApplied, appliedDarkTheme;
    private WebView themedWebView, frameRateView;
    private boolean webViewDarkTheme;
    private float requestedViewFrameRate, requestedWindowFrameRate;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        if (state != null) pendingMode = state.getString("pending-import-mode");
        darkTheme = "dark".equals(getSharedPreferences("listenly.preferences", MODE_PRIVATE).getString("theme", "light"));
        importsRoot = new File(getFilesDir(), "imports");
        if (!importsRoot.exists()) importsRoot.mkdirs();
        configureWindowSafely();
        if (Build.VERSION.SDK_INT >= 33) {
            try { backCallback = ModernBack.register(this); }
            catch (RuntimeException | LinkageError failure) { noteCompatibilityFailure("预测返回初始化", failure); }
        }
        initializeWebView();
    }

    private void initializeWebView() {
        disposeWebView(webView);
        webView = null;
        try {
        webView = new WebView(this);
        insetsSent = false;
        webView.setVerticalScrollBarEnabled(false);
        webView.setHorizontalScrollBarEnabled(false);
        webView.setBackgroundColor(darkTheme ? Color.BLACK : Color.rgb(250, 250, 250));
        themedWebView = webView;
        webViewDarkTheme = darkTheme;
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setSupportMultipleWindows(false);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setTextZoom(100);
        webView.addJavascriptInterface(new AndroidBridge(), "Android");
        WebView.setWebContentsDebuggingEnabled(
                (getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0);
        webView.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return !trustedPage(request.getUrl());
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return !trustedPage(Uri.parse(url));
            }
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return serve(request.getUrl(), request.getRequestHeaders(), request.getMethod());
            }
            @Override public void onPageStarted(WebView view, String url, android.graphics.Bitmap icon) {
                if (themeTransition != null) themeTransition.cancel();
            }
            @Override public void onPageFinished(WebView view, String url) { pushInsets(true); }
            @Override public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                boolean current = view == webView;
                if (current) webView = null;
                disposeWebView(view);
                if (current) {
                    showNativeFailure("页面运行进程已停止", new IllegalStateException(
                            "WebView renderer gone: didCrash=" + detail.didCrash() +
                            ", priorityAtExit=" + detail.rendererPriorityAtExit()));
                }
                // A failed renderer cannot be reused. Keep the Activity alive and
                // create a fresh WebView only when the user requests retry.
                return true;
            }
        });
        webView.setOnApplyWindowInsetsListener((view, insets) -> {
            try {
            float scale = getResources().getDisplayMetrics().density;
            if (Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets safe = insets.getInsets(
                        WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                insetTop = safe.top / scale; insetBottom = safe.bottom / scale;
                insetLeft = safe.left / scale; insetRight = safe.right / scale;
            } else {
                insetTop = insets.getSystemWindowInsetTop() / scale;
                insetBottom = insets.getSystemWindowInsetBottom() / scale;
                insetLeft = insets.getSystemWindowInsetLeft() / scale;
                insetRight = insets.getSystemWindowInsetRight() / scale;
                if (Build.VERSION.SDK_INT >= 28 && insets.getDisplayCutout() != null) {
                    insetTop = Math.max(insetTop, insets.getDisplayCutout().getSafeInsetTop() / scale);
                    insetBottom = Math.max(insetBottom, insets.getDisplayCutout().getSafeInsetBottom() / scale);
                    insetLeft = Math.max(insetLeft, insets.getDisplayCutout().getSafeInsetLeft() / scale);
                    insetRight = Math.max(insetRight, insets.getDisplayCutout().getSafeInsetRight() / scale);
                }
            }
            pushInsets();
            } catch (RuntimeException | LinkageError failure) {
                noteCompatibilityFailure("安全区域计算", failure);
                insetTop = insetBottom = insetLeft = insetRight = 0;
                pushInsets();
            }
            return insets;
        });
        FrameLayout webHost = new FrameLayout(this);
        webHost.addView(webView, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        themeTransition = new ThemeTransitionOverlay(this, webHost, webView);
        setContentView(webHost);
        webView.requestApplyInsets();
        requestHighRefreshRateSafely();
        webView.loadUrl(START);
        } catch (RuntimeException | LinkageError failure) {
            showNativeFailure("系统网页组件未能启动", failure);
        }
    }

    private void configureWindowSafely() {
        try { configureWindow(); }
        catch (RuntimeException | LinkageError failure) {
            noteCompatibilityFailure("系统栏初始化", failure);
            try {
                getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LAYOUT_STABLE |
                        View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION |
                        (darkTheme ? 0 : View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR));
            } catch (RuntimeException | LinkageError fallbackFailure) {
                noteCompatibilityFailure("兼容系统栏初始化", fallbackFailure);
            }
        }
    }

    private static String stackTrace(Throwable failure) {
        StringWriter text = new StringWriter();
        failure.printStackTrace(new PrintWriter(text));
        return text.toString();
    }

    private void noteCompatibilityFailure(String stage, Throwable failure) {
        Log.e("Listenly", stage, failure);
        startupWarnings.append("\n").append(stage).append("\n").append(stackTrace(failure));
    }

    private void disposeWebView(WebView view) {
        if (view == null) return;
        if (themeTransition != null) { themeTransition.cancel(); themeTransition = null; }
        if (themedWebView == view) themedWebView = null;
        if (frameRateView == view) { frameRateView = null; requestedViewFrameRate = 0; }
        try {
            if (view.getParent() instanceof ViewGroup) ((ViewGroup) view.getParent()).removeView(view);
            view.removeJavascriptInterface("Android");
            view.destroy();
        } catch (RuntimeException | LinkageError failure) {
            noteCompatibilityFailure("网页组件释放", failure);
        }
    }

    private void showNativeFailure(String stage, Throwable failure) {
        Log.e("Listenly", stage, failure);
        WebView failed = webView;
        webView = null;
        disposeWebView(failed);
        StringBuilder diagnostic = new StringBuilder("拾听启动诊断\n");
        boolean providerUnavailable = false;
        int causeDepth = 0;
        for (Throwable cause = failure; cause != null && causeDepth++ < 32; cause = cause.getCause()) {
            if (cause.getClass().getName().contains("MissingWebViewPackageException")) {
                providerUnavailable = true;
                break;
            }
            if (cause.getCause() == cause) break;
        }
        diagnostic.append("设备: ").append(Build.MANUFACTURER).append(" ").append(Build.MODEL)
                .append("\nAndroid: ").append(Build.VERSION.RELEASE).append(" (API ")
                .append(Build.VERSION.SDK_INT).append(")\n目标 API: ").append(getApplicationInfo().targetSdkVersion);
        try {
            PackageInfo app = getPackageManager().getPackageInfo(getPackageName(), 0);
            diagnostic.append("\n应用: ").append(app.versionName).append(" (").append(app.versionCode).append(")");
        } catch (Exception unavailable) { diagnostic.append("\n应用版本: 无法读取"); }
        try {
            PackageInfo provider = WebView.getCurrentWebViewPackage();
            if (provider == null) providerUnavailable = true;
            diagnostic.append("\nWebView: ").append(provider == null ? "未找到提供程序" :
                    provider.packageName + " " + provider.versionName);
        } catch (RuntimeException | LinkageError unavailable) {
            diagnostic.append("\nWebView 查询失败:\n").append(stackTrace(unavailable));
        }
        diagnostic.append("\n阶段: ").append(stage).append("\n").append(stackTrace(failure)).append(startupWarnings);
        final String details = diagnostic.toString();
        int padding = (int) (24 * getResources().getDisplayMetrics().density + .5f);
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setPadding(padding, padding, padding, padding);
        layout.setFitsSystemWindows(true);
        layout.setBackgroundColor(Color.rgb(247, 248, 245));
        TextView heading = new TextView(this);
        heading.setText("拾听 · 启动遇到问题"); heading.setTextSize(23); heading.setTextColor(Color.rgb(25, 61, 55));
        layout.addView(heading);
        TextView explanation = new TextView(this);
        explanation.setText(stage + "。可以重试，或复制诊断信息帮助排查。导入材料和学习记录会保留。" +
                (providerUnavailable ? "可在系统设置中启用或更新网页组件后重试。" : ""));
        explanation.setTextSize(15); explanation.setPadding(0, padding / 2, 0, padding / 2);
        layout.addView(explanation);
        Button retry = new Button(this); retry.setText("重试打开");
        retry.setOnClickListener(view -> { configureWindowSafely(); initializeWebView(); });
        layout.addView(retry);
        Button copy = new Button(this); copy.setText("复制诊断信息");
        copy.setOnClickListener(view -> {
            ClipboardManager clipboard = (ClipboardManager) getSystemService(CLIPBOARD_SERVICE);
            if (clipboard != null) {
                clipboard.setPrimaryClip(ClipData.newPlainText("拾听启动诊断", details));
                Toast.makeText(this, "诊断信息已复制", Toast.LENGTH_SHORT).show();
            }
        });
        layout.addView(copy);
        ScrollView scroll = new ScrollView(this);
        TextView technical = new TextView(this); technical.setText(details); technical.setTextSize(12);
        technical.setTextIsSelectable(true); technical.setTypeface(android.graphics.Typeface.MONOSPACE);
        technical.setPadding(0, padding / 2, 0, 0); scroll.addView(technical);
        layout.addView(scroll, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1));
        setContentView(layout);
    }

    @SuppressWarnings("deprecation") private void configureWindow() {
        getWindow().setStatusBarColor(Color.TRANSPARENT);
        getWindow().setNavigationBarColor(Color.TRANSPARENT);
        if (Build.VERSION.SDK_INT >= 29) getWindow().setNavigationBarContrastEnforced(false);
        if (Build.VERSION.SDK_INT >= 28) {
            getWindow().getAttributes().layoutInDisplayCutoutMode =
                    WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
        }
        if (Build.VERSION.SDK_INT >= 30) {
            getWindow().setDecorFitsSystemWindows(false);
            // PhoneWindow.getInsetsController() dereferences mDecor on API 30.
            // onCreate runs before setContentView, so create the decor first.
            getWindow().getDecorView();
        } else {
            getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LAYOUT_STABLE |
                    View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
        }
        windowThemeApplied = false;
        applyNativeThemeSafely();
    }

    /** Theme changes never reapply edge-to-edge, cutout or window geometry. */
    @SuppressWarnings("deprecation") private void applyNativeThemeSafely() {
        try {
            if (!windowThemeApplied || appliedDarkTheme != darkTheme) {
                View decor = getWindow().getDecorView();
                boolean appearanceReady = true;
                if (Build.VERSION.SDK_INT >= 30) {
                    WindowInsetsController controller = getWindow().getInsetsController();
                    if (controller != null) {
                        int mask = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS |
                                WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS;
                        int appearance = darkTheme ? 0 : mask;
                        if ((controller.getSystemBarsAppearance() & mask) != appearance)
                            controller.setSystemBarsAppearance(appearance, mask);
                    } else appearanceReady = false;
                } else {
                    int mask = View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
                    int current = decor.getSystemUiVisibility();
                    int appearance = (current & ~mask) | (darkTheme ? 0 : mask);
                    if (current != appearance) decor.setSystemUiVisibility(appearance);
                }
                int color = darkTheme ? Color.BLACK : Color.rgb(250, 250, 250);
                if (!(decor.getBackground() instanceof ColorDrawable) ||
                        ((ColorDrawable) decor.getBackground()).getColor() != color)
                    decor.setBackgroundColor(color);
                appliedDarkTheme = darkTheme;
                windowThemeApplied = appearanceReady;
            }
            if (webView != null && (themedWebView != webView || webViewDarkTheme != darkTheme)) {
                webView.setBackgroundColor(darkTheme ? Color.BLACK : Color.rgb(250, 250, 250));
                themedWebView = webView;
                webViewDarkTheme = darkTheme;
            }
        } catch (RuntimeException | LinkageError failure) {
            windowThemeApplied = false;
            noteCompatibilityFailure("系统栏外观更新", failure);
        }
    }

    /** Supported, same-resolution hints only; the OS still owns presentation. */
    @SuppressWarnings("deprecation") private void requestHighRefreshRateSafely() {
        try {
            Display display = webView == null ? null : webView.getDisplay();
            if (display == null) display = getWindowManager().getDefaultDisplay();
            if (display == null) return;
            Display.Mode current = display.getMode();
            Display.Mode[] supported = display.getSupportedModes();
            int[] widths = new int[supported.length], heights = new int[supported.length];
            float[] rates = new float[supported.length];
            for (int i = 0; i < supported.length; i++) {
                widths[i] = supported[i].getPhysicalWidth();
                heights[i] = supported[i].getPhysicalHeight();
                rates[i] = supported[i].getRefreshRate();
            }
            float rate = RefreshRatePolicy.choose(current.getPhysicalWidth(), current.getPhysicalHeight(), widths, heights, rates);
            WindowManager.LayoutParams attributes = getWindow().getAttributes();
            if (rate <= 0) {
                // A resumed or resized Activity may now be on a 60 Hz-only
                // display. Clear only hints installed by this host.
                if (requestedWindowFrameRate > 0) {
                    if (attributes.preferredDisplayModeId == 0 &&
                            Math.abs(attributes.preferredRefreshRate - requestedWindowFrameRate) < .01f) {
                        attributes.preferredRefreshRate = 0;
                        getWindow().setAttributes(attributes);
                    }
                    requestedWindowFrameRate = 0;
                }
                if (Build.VERSION.SDK_INT >= 35 && frameRateView == webView && requestedViewFrameRate > 0) {
                    ModernFrameRate.clear(webView);
                    frameRateView = null;
                    requestedViewFrameRate = 0;
                }
                return;
            }
            // A rate preference avoids selecting a mode ID that can change
            // resolution or force a non-seamless switch on modern Android.
            if (attributes.preferredDisplayModeId == 0 && Math.abs(attributes.preferredRefreshRate - rate) > .01f) {
                attributes.preferredRefreshRate = rate;
                getWindow().setAttributes(attributes);
                requestedWindowFrameRate = rate;
            }
            if (Build.VERSION.SDK_INT >= 35 && webView != null &&
                    (frameRateView != webView || Math.abs(requestedViewFrameRate - rate) > .01f)) {
                ModernFrameRate.request(webView, rate);
                frameRateView = webView;
                requestedViewFrameRate = rate;
            }
        } catch (RuntimeException | LinkageError failure) {
            noteCompatibilityFailure("高刷新率偏好", failure);
        }
    }

    /** Pure policy kept independent of Android objects for host-JVM tests. */
    static final class RefreshRatePolicy {
        static float choose(int width, int height, int[] widths, int[] heights, float[] rates) {
            if (width <= 0 || height <= 0 || widths == null || heights == null || rates == null) return 0;
            float best = 0, distance = Float.MAX_VALUE;
            int count = Math.min(rates.length, Math.min(widths.length, heights.length));
            for (int i = 0; i < count; i++) {
                float rate = rates[i];
                if (widths[i] != width || heights[i] != height || !Float.isFinite(rate) || rate <= 60.5f) continue;
                float next = Math.abs(rate - 120);
                if (next < distance || (next == distance && rate > best)) {
                    best = rate;
                    distance = next;
                }
            }
            return best;
        }
    }

    /** Isolate the API 35 method from verification on older Android releases. */
    private static final class ModernFrameRate {
        static void request(View view, float rate) { view.setRequestedFrameRate(rate); }
        static void clear(View view) { view.setRequestedFrameRate(View.REQUESTED_FRAME_RATE_CATEGORY_DEFAULT); }
    }

    @Override protected void onResume() {
        super.onResume();
        requestHighRefreshRateSafely();
    }

    @Override protected void onPause() {
        if (themeTransition != null) themeTransition.cancel();
        super.onPause();
    }

    @Override public void onConfigurationChanged(Configuration configuration) {
        super.onConfigurationChanged(configuration);
        if (themeTransition != null) themeTransition.cancel();
        requestHighRefreshRateSafely();
    }

    private void pushInsets() { pushInsets(false); }

    private void pushInsets(boolean force) {
        if (webView == null) return;
        if (!force && insetsSent && insetTop == sentInsetTop && insetBottom == sentInsetBottom &&
                insetLeft == sentInsetLeft && insetRight == sentInsetRight) return;
        String[] names = {"top", "bottom", "left", "right"};
        float[] values = {insetTop, insetBottom, insetLeft, insetRight};
        JSONObject detail = new JSONObject();
        StringBuilder js = new StringBuilder("(function(){if(!document.documentElement)return;var s=document.documentElement.style;");
        try {
            for (int i = 0; i < names.length; i++) {
                detail.put(names[i], values[i]);
                js.append("s.setProperty('--safe-").append(names[i]).append("','")
                        .append(values[i]).append("px');");
            }
            js.append("window.dispatchEvent(new CustomEvent('listenly-insets',{detail:")
                    .append(detail).append("}));})();");
            webView.evaluateJavascript(js.toString(), null);
            insetsSent = true;
            sentInsetTop = insetTop; sentInsetBottom = insetBottom;
            sentInsetLeft = insetLeft; sentInsetRight = insetRight;
        } catch (JSONException ignored) { }
        catch (RuntimeException | LinkageError failure) { noteCompatibilityFailure("安全区域同步", failure); }
    }

    private static boolean trusted(Uri uri) {
        return "https".equals(uri.getScheme()) && HOST.equals(uri.getHost()) &&
                uri.getPort() == -1 && uri.getUserInfo() == null;
    }

    private static boolean trustedPage(Uri uri) {
        return trusted(uri) && "/assets/index.html".equals(uri.getPath());
    }

    private final class AndroidBridge {
        @JavascriptInterface public boolean beginThemeTransition(long id) {
            if (id <= 0 || id > Integer.MAX_VALUE || themeTransition == null) return false;
            runOnUiThread(() -> { if (themeTransition != null) themeTransition.begin(id); });
            return true;
        }

        @JavascriptInterface public void animateThemeTransition(long id, boolean toOriginal) {
            runOnUiThread(() -> { if (themeTransition != null) themeTransition.animate(id, toOriginal); });
        }

        @JavascriptInterface public void finishThemeTransition(long id) {
            runOnUiThread(() -> { if (themeTransition != null) themeTransition.finish(id); });
        }

        @JavascriptInterface public String getThemeTransitionDiagnostics() {
            ThemeTransitionOverlay transition = themeTransition;
            return transition == null ? "{}" : transition.diagnostics();
        }

        @JavascriptInterface public void setTheme(String theme) {
            if (!"light".equals(theme) && !"dark".equals(theme)) return;
            runOnUiThread(() -> {
                boolean requestedDark = "dark".equals(theme);
                if (darkTheme != requestedDark) {
                    darkTheme = requestedDark;
                    getSharedPreferences("listenly.preferences", MODE_PRIVATE).edit().putString("theme", theme).apply();
                }
                applyNativeThemeSafely();
            });
        }

        @JavascriptInterface public void importFolder(String mode) {
            if (!"intensive".equals(mode) && !"exam".equals(mode)) return;
            runOnUiThread(() -> {
                if (importing || pendingMode != null) {
                    emitError("正在导入，请稍候。"); return;
                }
                pendingMode = mode;
                Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
                intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION |
                        Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
                try { startActivityForResult(intent, IMPORT_REQUEST); }
                catch (Exception error) { pendingMode = null; emitError("此设备没有可用的文件夹选择器。"); }
            });
        }

        @JavascriptInterface public String getImports() {
            JSONArray all = new JSONArray();
            File[] folders = importsRoot.listFiles(File::isDirectory);
            if (folders == null) return "[]";
            Arrays.sort(folders, (a, b) -> Long.compare(a.lastModified(), b.lastModified()));
            for (File folder : folders) {
                String data = readManifest(folder.getName());
                if (!"null".equals(data)) try { all.put(new JSONObject(data)); } catch (JSONException ignored) { }
            }
            return all.toString();
        }

        @JavascriptInterface public String getImport(String id) { return readManifest(id); }

        @JavascriptInterface public void exportText(String name, String text) {
            if (text == null || text.getBytes(StandardCharsets.UTF_8).length > 4 * 1024 * 1024) {
                emitExportError("导出的文本过大。"); return;
            }
            runOnUiThread(() -> {
                if (pendingExport != null) return;
                pendingExport = text;
                String safeName = name == null ? "listenly.json" : name.replaceAll("[\\\\/:*?\"<>|]", "_");
                Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType(safeName.endsWith(".json") ? "application/json" : "text/plain");
                intent.putExtra(Intent.EXTRA_TITLE, safeName);
                try { startActivityForResult(intent, EXPORT_REQUEST); }
                catch (Exception error) { pendingExport = null; emitExportError("此设备没有可用的文件保存器。"); }
            });
        }
    }

    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request == IMPORT_REQUEST) {
            String mode = pendingMode;
            pendingMode = null;
            if (result != RESULT_OK || data == null || data.getData() == null || mode == null) {
                emit("listenly-import-cancel", "{}"); return;
            }
            Uri tree = data.getData();
            importing = true;
            worker.execute(() -> importTree(tree, mode));
        } else if (request == EXPORT_REQUEST) {
            String body = pendingExport;
            pendingExport = null;
            if (result != RESULT_OK || data == null || data.getData() == null || body == null) return;
            Uri destination = data.getData();
            worker.execute(() -> {
                try (OutputStream stream = getContentResolver().openOutputStream(destination, "wt")) {
                    if (stream == null) throw new IOException("无法打开保存位置");
                    stream.write(body.getBytes(StandardCharsets.UTF_8));
                    emit("listenly-export", "{\"success\":true}");
                } catch (Exception error) { emitExportError("保存失败：" + error.getMessage()); }
            });
        }
    }

    @Override protected void onSaveInstanceState(Bundle state) {
        state.putString("pending-import-mode", pendingMode);
        super.onSaveInstanceState(state);
    }

    private static final class CopyState {
        final JSONArray files = new JSONArray();
        long bytes;
        int count;
        int inlineBytes;
    }

    private void importTree(Uri tree, String mode) {
        String id = UUID.randomUUID().toString();
        File destination = new File(importsRoot, id);
        try {
            emit("listenly-import-progress", "{\"message\":\"正在复制材料到本机…\",\"files\":0,\"bytes\":0}");
            if (!destination.mkdir()) throw new IOException("无法创建导入目录");
            String rootId = DocumentsContract.getTreeDocumentId(tree);
            Uri rootUri = DocumentsContract.buildDocumentUriUsingTree(tree, rootId);
            String name = "导入的文件夹";
            try (Cursor cursor = getContentResolver().query(rootUri,
                    new String[]{DocumentsContract.Document.COLUMN_DISPLAY_NAME}, null, null, null)) {
                if (cursor != null && cursor.moveToFirst()) name = cursor.getString(0);
            }
            CopyState state = new CopyState();
            copyChildren(tree, rootId, "", destination, id, state, 0);
            if (state.count == 0) throw new IOException("所选文件夹没有可读取的文件");
            JSONObject manifest = new JSONObject().put("id", id).put("mode", mode).put("name", name).put("intensiveStandard", 2)
                    .put("importedAt", System.currentTimeMillis()).put("files", state.files);
            File manifests = new File(getFilesDir(), "import-manifests");
            if (!manifests.exists() && !manifests.mkdirs()) throw new IOException("无法创建导入记录目录");
            File temp = new File(manifests, id + ".tmp");
            try (OutputStream out = new FileOutputStream(temp)) {
                out.write(manifest.toString().getBytes(StandardCharsets.UTF_8));
            }
            if (!temp.renameTo(new File(manifests, id + ".json"))) throw new IOException("无法保存导入记录");
            // Keep the JavaScript invocation small even for a large question library.
            runOnUiThread(() -> {
                if (webView != null) webView.evaluateJavascript(
                        "window.dispatchEvent(new CustomEvent('listenly-import',{detail:JSON.parse(Android.getImport(" +
                                JSONObject.quote(id) + "))}));", null);
            });
        } catch (Exception error) {
            deletePartial(destination);
            emitError("导入失败：" + (error.getMessage() == null ? "无法读取所选文件夹" : error.getMessage()));
        } finally { importing = false; }
    }

    private void copyChildren(Uri tree, String parentId, String relative, File root, String importId,
                              CopyState state, int depth) throws IOException, JSONException {
        if (depth > 32) throw new IOException("文件夹层级过深");
        Uri children = DocumentsContract.buildChildDocumentsUriUsingTree(tree, parentId);
        String[] columns = {DocumentsContract.Document.COLUMN_DOCUMENT_ID,
                DocumentsContract.Document.COLUMN_DISPLAY_NAME, DocumentsContract.Document.COLUMN_MIME_TYPE,
                DocumentsContract.Document.COLUMN_SIZE};
        try (Cursor cursor = getContentResolver().query(children, columns, null, null, null)) {
            if (cursor == null) throw new IOException("无法读取文件夹");
            while (cursor.moveToNext()) {
                if (Thread.currentThread().isInterrupted()) throw new IOException("导入已中断");
                String docId = cursor.getString(0), name = cursor.getString(1), type = cursor.getString(2);
                if (!safeSegment(name)) throw new IOException("无效的文件名");
                String path = relative.isEmpty() ? name : relative + "/" + name;
                File file = inside(root, path);
                if (DocumentsContract.Document.MIME_TYPE_DIR.equals(type)) {
                    if (!file.exists() && !file.mkdirs()) throw new IOException("无法创建子文件夹");
                    copyChildren(tree, docId, path, root, importId, state, depth + 1);
                    continue;
                }
                if (++state.count > MAX_FILES) throw new IOException("单次导入文件数量超过 25000，请按年份分批导入");
                if (!cursor.isNull(3) && cursor.getLong(3) > MAX_FILE_BYTES) throw new IOException("单个文件超过 512 MB");
                if (!file.getParentFile().exists() && !file.getParentFile().mkdirs()) throw new IOException("无法创建保存路径");
                Uri document = DocumentsContract.buildDocumentUriUsingTree(tree, docId);
                long fileBytes = 0;
                try (InputStream input = getContentResolver().openInputStream(document);
                     OutputStream output = new FileOutputStream(file)) {
                    if (input == null) throw new IOException("无法读取 " + name);
                    byte[] buffer = new byte[64 * 1024];
                    int count;
                    while ((count = input.read(buffer)) != -1) {
                        fileBytes += count; state.bytes += count;
                        if (fileBytes > MAX_FILE_BYTES || state.bytes > MAX_IMPORT_BYTES)
                            throw new IOException("单次导入超过 2 GB，或单个文件超过 512 MB");
                        output.write(buffer, 0, count);
                    }
                }
                JSONObject entry = new JSONObject().put("path", path).put("size", fileBytes)
                        .put("url", "https://" + HOST + "/imports/" + importId + "/" + encodePath(path));
                if (isText(path) && fileBytes <= MAX_TEXT_BYTES && state.inlineBytes + fileBytes <= MAX_INLINE_BYTES) {
                    entry.put("text", readUtf8(file, MAX_TEXT_BYTES));
                    state.inlineBytes += (int) fileBytes;
                }
                state.files.put(entry);
                if (state.count % 25 == 0) emit("listenly-import-progress",
                        new JSONObject().put("files", state.count).put("bytes", state.bytes).toString());
            }
        }
    }

    private static String encodePath(String path) {
        String[] parts = path.split("/");
        StringBuilder result = new StringBuilder();
        for (String part : parts) {
            if (result.length() > 0) result.append('/');
            result.append(Uri.encode(part));
        }
        return result.toString();
    }

    private static boolean safeSegment(String name) {
        return name != null && !name.isEmpty() && !".".equals(name) && !"..".equals(name) &&
                name.indexOf('/') < 0 && name.indexOf('\\') < 0 && name.indexOf('\0') < 0;
    }

    private static File inside(File root, String path) throws IOException {
        File file = new File(root, path).getCanonicalFile();
        if (!file.getPath().startsWith(root.getCanonicalPath() + File.separator)) throw new IOException("路径超出导入目录");
        return file;
    }

    private static boolean isText(String path) {
        String lower = path.toLowerCase(Locale.ROOT);
        return lower.endsWith(".json") || lower.endsWith(".txt") || lower.endsWith(".srt") ||
                lower.endsWith(".vtt") || lower.endsWith(".lrc") || lower.endsWith(".md") || lower.endsWith(".csv");
    }

    private static String readUtf8(File file, int limit) throws IOException {
        if (file.length() > limit) throw new IOException("文本超出大小限制");
        try (InputStream stream = new FileInputStream(file); ByteArrayOutputStream bytes = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192]; int count;
            while ((count = stream.read(buffer)) != -1) bytes.write(buffer, 0, count);
            String value = new String(bytes.toByteArray(), StandardCharsets.UTF_8);
            return value.startsWith("\uFEFF") ? value.substring(1) : value;
        }
    }

    private String readManifest(String id) {
        if (id == null || !id.matches("[a-f0-9-]{36}")) return "null";
        try { return readUtf8(inside(new File(getFilesDir(), "import-manifests"), id + ".json"), 24 * 1024 * 1024); }
        catch (Exception ignored) { return "null"; }
    }

    private void deletePartial(File folder) {
        try {
            if (!folder.getCanonicalPath().startsWith(importsRoot.getCanonicalPath() + File.separator)) return;
            File[] children = folder.listFiles();
            if (children != null) for (File child : children) {
                if (child.isDirectory()) deletePartial(child); else child.delete();
            }
            folder.delete();
        } catch (IOException ignored) { }
    }

    private void emit(String event, String detail) {
        runOnUiThread(() -> {
            if (webView != null) webView.evaluateJavascript(
                    "window.dispatchEvent(new CustomEvent(" + JSONObject.quote(event) + ",{detail:" + detail + "}));", null);
        });
    }

    private void emitError(String message) {
        emit("listenly-import-error", "{\"message\":" + JSONObject.quote(message) + "}");
        runOnUiThread(() -> Toast.makeText(this, message, Toast.LENGTH_LONG).show());
    }

    private void emitExportError(String message) {
        emit("listenly-export-error", "{\"message\":" + JSONObject.quote(message) + "}");
        runOnUiThread(() -> Toast.makeText(this, message, Toast.LENGTH_LONG).show());
    }

    private WebResourceResponse serve(Uri uri, Map<String, String> requestHeaders, String method) {
        if (!trusted(uri)) return error(403, "Forbidden", "External resources are disabled.");
        if (!"GET".equals(method) && !"HEAD".equals(method)) return error(405, "Method Not Allowed", "GET only");
        String path = uri.getPath();
        if (path == null || path.indexOf('\\') >= 0 || path.indexOf('\0') >= 0) return error(400, "Bad Request", "Invalid path");
        for (String segment : path.split("/")) if ("..".equals(segment) || ".".equals(segment)) return error(403, "Forbidden", "Invalid path");
        InputStream stream = null;
        try {
            long length;
            if (path.startsWith("/assets/")) {
                String asset = "web/" + path.substring(8);
                stream = getAssets().open(asset);
                length = stream.available(); // AssetInputStream returns the remaining asset length.
            } else if (path.startsWith("/imports/")) {
                File file = inside(importsRoot, path.substring(9));
                if (!file.isFile()) return error(404, "Not Found", "File not found");
                stream = new FileInputStream(file);
                length = file.length();
            } else return error(404, "Not Found", "File not found");
            Map<String, String> headers = new HashMap<>();
            headers.put("Accept-Ranges", "bytes");
            headers.put("X-Content-Type-Options", "nosniff");
            headers.put("Cache-Control", "no-store");
            headers.put("Content-Security-Policy", "frame-src 'none'; object-src 'none'; base-uri 'self'");
            String range = null;
            for (Map.Entry<String, String> h : requestHeaders.entrySet()) {
                if ("Range".equalsIgnoreCase(h.getKey())) range = h.getValue();
            }
            int status = 200; String reason = "OK"; long start = 0, end = length - 1;
            boolean explicitRangeStart = false;
            if (range != null) {
                try {
                    if (!range.startsWith("bytes=") || range.contains(",") || length <= 0) throw new IllegalArgumentException();
                    String[] limits = range.substring(6).split("-", -1);
                    if (limits.length != 2) throw new IllegalArgumentException();
                    if (limits[0].isEmpty()) {
                        long suffix = Long.parseLong(limits[1]);
                        if (suffix <= 0) throw new IllegalArgumentException();
                        start = Math.max(0, length - suffix);
                    } else {
                        start = Long.parseLong(limits[0]);
                        explicitRangeStart = true;
                        if (!limits[1].isEmpty()) end = Math.min(Long.parseLong(limits[1]), length - 1);
                    }
                    if (start < 0 || start >= length || end < start) throw new IllegalArgumentException();
                } catch (IllegalArgumentException invalid) {
                    stream.close();
                    headers.put("Content-Range", "bytes */" + length);
                    return new WebResourceResponse("text/plain", "UTF-8", 416, "Range Not Satisfiable", headers,
                            new ByteArrayInputStream(new byte[0]));
                }
                status = 206; reason = "Partial Content";
                headers.put("Content-Range", "bytes " + start + "-" + end + "/" + length);
            }
            long responseLength = length == 0 ? 0 : end - start + 1;
            headers.put("Content-Length", Long.toString(responseLength));
            skipFully(stream, start);
            InputStream body = new LimitedStream(stream, responseLength);
            if (status == 206 && explicitRangeStart) {
                body = new WebViewRangeInputStream(body, start);
            }
            if ("HEAD".equals(method)) { body.close(); body = new ByteArrayInputStream(new byte[0]); }
            String mime = mime(path);
            // Imported files are data: they must never become a page or a script
            // with access to the Android JavaScript bridge.
            if (path.startsWith("/imports/") && ("text/html".equals(mime) ||
                    "text/javascript".equals(mime) || "image/svg+xml".equals(mime))) mime = "text/plain";
            return new WebResourceResponse(mime, isText(path) || mime.startsWith("text/") ? "UTF-8" : null,
                    status, reason, headers, body);
        } catch (Exception failure) {
            if (stream != null) try { stream.close(); } catch (IOException ignored) { }
            return error(404, "Not Found", "File not found");
        }
    }

    private static void skipFully(InputStream stream, long bytes) throws IOException {
        long remaining = bytes;
        while (remaining > 0) {
            long skipped = stream.skip(remaining);
            if (skipped == 0) { if (stream.read() == -1) throw new IOException("Unexpected end of file"); skipped = 1; }
            remaining -= skipped;
        }
    }

    private static String mime(String path) {
        String extension = path.substring(path.lastIndexOf('.') + 1).toLowerCase(Locale.ROOT);
        switch (extension) {
            case "html": return "text/html";
            case "js": case "mjs": return "text/javascript";
            case "css": return "text/css";
            case "json": return "application/json";
            case "svg": return "image/svg+xml";
            case "png": return "image/png";
            case "jpg": case "jpeg": return "image/jpeg";
            case "webp": return "image/webp";
            case "mp3": return "audio/mpeg";
            case "aac": return "audio/aac";
            case "m4a": case "mp4": return "audio/mp4";
            case "ogg": case "opus": return "audio/ogg";
            case "wav": return "audio/wav";
            case "flac": return "audio/flac";
            case "vtt": return "text/vtt";
            case "woff2": return "font/woff2";
            case "woff": return "font/woff";
            case "txt": case "srt": case "lrc": case "md": case "csv": return "text/plain";
            default: return "application/octet-stream";
        }
    }

    private static WebResourceResponse error(int code, String reason, String message) {
        return new WebResourceResponse("text/plain", "UTF-8", code, reason, new HashMap<>(),
                new ByteArrayInputStream(message.getBytes(StandardCharsets.UTF_8)));
    }

    @Override public void onBackPressed() {
        handleBack();
    }

    private void handleBack() {
        if (webView == null) { finish(); return; }
        webView.evaluateJavascript(
                "typeof window.listenlyBack === 'function' ? Boolean(window.listenlyBack()) : false",
                handled -> {
                    if ("true".equals(handled)) return;
                    if (webView != null && webView.canGoBack()) webView.goBack(); else finish();
                });
    }

    /** Isolate API 33 classes so the host still loads on Android 8. */
    private static final class ModernBack {
        static Object register(MainActivity activity) {
            android.window.OnBackInvokedCallback callback = activity::handleBack;
            activity.getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
                    android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT, callback);
            return callback;
        }
        static void unregister(MainActivity activity, Object callback) {
            activity.getOnBackInvokedDispatcher().unregisterOnBackInvokedCallback(
                    (android.window.OnBackInvokedCallback) callback);
        }
    }

    @Override protected void onDestroy() {
        if (Build.VERSION.SDK_INT >= 33 && backCallback != null) {
            try { ModernBack.unregister(this, backCallback); }
            catch (RuntimeException | LinkageError failure) { noteCompatibilityFailure("预测返回释放", failure); }
        }
        worker.shutdownNow();
        disposeWebView(webView);
        webView = null;
        super.onDestroy();
    }
}
