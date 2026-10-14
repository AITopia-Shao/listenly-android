package cn.listenly.app;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.Arrays;

/** Exercises the actual production streams without an Android runtime. */
public final class WebViewRangeInputStreamTest {
    private static int checks;
    private static final byte[] FILE = new byte[128];

    static {
        for (int i = 0; i < FILE.length; i++) FILE[i] = (byte) (i * 17 + 11);
    }

    public static void main(String[] args) throws Exception {
        oldResponseLosesData();
        oldResponseFailsNearEnd();
        correctExplicitRanges();
        suffixAndFullResponses();
        streamContracts();
        largeOffsetContracts();
        System.out.println("Range stream contracts passed: " + checks);
    }

    private static void oldResponseLosesData() throws Exception {
        // The pre-fix response was already positioned at byte 23, then WebView
        // skipped the same request offset again. Compare actual bytes, not a
        // playback boolean, so an apparently successful response still fails.
        InputStream old = sliced(23, FILE.length - 1);
        byte[] received = readLikeWebView(old, 23, Long.MAX_VALUE);
        require(!Arrays.equals(expected(23, FILE.length - 1), received), "old response must demonstrate byte corruption");
        equal(expected(46, FILE.length - 1), received, "old double skip begins at the wrong file offset");
        old.close();
    }

    private static void oldResponseFailsNearEnd() throws Exception {
        InputStream old = sliced(96, FILE.length - 1);
        boolean failed = false;
        try {
            readLikeWebView(old, 96, Long.MAX_VALUE);
        } catch (IOException expected) {
            failed = true;
        } finally {
            old.close();
        }
        require(failed, "old response must fail when request start exceeds the slice length");
    }

    private static void correctExplicitRanges() throws Exception {
        int[][] ranges = {{0, 127}, {23, 127}, {96, 127}, {23, 31}, {127, 127}, {0, 12}};
        for (int[] range : ranges) {
            for (int request = 0; request < 2; request++) {
                try (InputStream body = explicit(range[0], range[1])) {
                    equal(expected(range[0], range[1]), readLikeWebView(body, range[0], range[1]),
                            "explicit range survives WebView seek on independent request " + request);
                }
            }
            try (InputStream body = explicit(range[0], range[1])) {
                equal(expected(range[0], range[1]), readAll(body),
                        "future reader that does not apply Range again receives exact body bytes");
            }
        }
        try (InputStream body = explicit(96, 127)) {
            equal(expected(96, 127), readLikeWebView(body, 96, Long.MAX_VALUE), "open-ended request preserves all remaining bytes");
        }
    }

    private static void suffixAndFullResponses() throws Exception {
        for (int count : new int[]{1, 7, 128}) {
            // serve() already returns the suffix. Chromium computes the suffix
            // against this stream's available bytes, which gives an offset of 0.
            try (InputStream body = sliced(FILE.length - count, FILE.length - 1)) {
                int suffixStart = Math.max(0, body.available() - count);
                equal(expected(FILE.length - count, FILE.length - 1), readLikeWebView(body, suffixStart, Long.MAX_VALUE),
                        "suffix response is not given an explicit-offset adapter");
            }
        }
        try (InputStream body = new LimitedStream(new ByteArrayInputStream(FILE), FILE.length)) {
            equal(FILE, readLikeWebView(body, 0, Long.MAX_VALUE), "full response is unchanged");
        }
    }

    private static void streamContracts() throws Exception {
        TrackingStream source = new TrackingStream(FILE);
        InputStream bounded = new LimitedStream(source, 5);
        require(bounded.available() == 5, "bounded available respects response length");
        byte[] buffer = new byte[12];
        require(bounded.read(buffer, 3, 10 - 3) == 5, "bulk read cannot cross response end");
        equal(Arrays.copyOfRange(FILE, 0, 5), Arrays.copyOfRange(buffer, 3, 8), "bulk read honors destination offset");
        require(bounded.read() == -1 && bounded.read(buffer) == -1, "EOF is stable after the declared length");
        require(bounded.read(buffer, 0, 0) == 0 && bounded.available() == 0 && bounded.skip(10) == 0,
                "zero-byte reads and skips obey EOF contracts");
        require(source.available() == FILE.length - 5, "bounded body does not consume bytes outside its range");
        bounded.close();
        require(source.closed, "closing the response closes its underlying resource");

        TrackingStream emptySource = new TrackingStream(FILE);
        InputStream empty = new LimitedStream(emptySource, 0);
        require(empty.read() == -1 && empty.available() == 0 && empty.read(buffer, 0, 0) == 0,
                "empty responses expose no file data");
        require(emptySource.available() == FILE.length, "empty response leaves its resource unread");
        empty.close();
        require(emptySource.closed, "empty response can be closed for HEAD requests");

        TrackingStream headSource = new TrackingStream(FILE);
        InputStream head = new WebViewRangeInputStream(new LimitedStream(headSource, 12), 23);
        head.close();
        require(headSource.closed && headSource.available() == FILE.length, "HEAD closes wrapped body without reading audio");

        InputStream shortFile = new LimitedStream(new ByteArrayInputStream(new byte[]{1, 2}), 10);
        require(readAll(shortFile).length == 2 && shortFile.available() == 0 && shortFile.read() == -1,
                "unexpected source EOF does not invent remaining bytes");
        require(shortFile.skip(-1) == 0, "negative skip does not move the stream");

        InputStream forwardOnly = explicit(23, 31);
        require(!forwardOnly.markSupported(), "adapter does not promise unsupported mark/reset");
        boolean resetFailed = false;
        try { forwardOnly.reset(); } catch (IOException expected) { resetFailed = true; }
        require(resetFailed, "forward-only reset reports unsupported operation");
        boolean boundsFailed = false;
        try { forwardOnly.read(buffer, 0, -1); } catch (IndexOutOfBoundsException expected) { boundsFailed = true; }
        require(boundsFailed, "invalid read bounds are rejected");
        forwardOnly.close();

        TrackingStream skipSource = new TrackingStream(FILE);
        LimitedStream skipBody = new LimitedStream(skipSource, 12);
        WebViewRangeInputStream skipAdapter = new WebViewRangeInputStream(skipBody, 40);
        require(skipAdapter.skip(100) == 40 && skipSource.available() == FILE.length,
                "virtual seek consumes no real response bytes");
        require(skipAdapter.available() == 12 && skipAdapter.skip(100) == 12 && skipAdapter.read() == -1,
                "subsequent body skip is still bounded");
        skipAdapter.close();
    }

    private static void largeOffsetContracts() throws Exception {
        TrackingStream source = new TrackingStream(new byte[]{7, 8, 9});
        long start = (long) Integer.MAX_VALUE + 20;
        WebViewRangeInputStream body = new WebViewRangeInputStream(new LimitedStream(source, 3), start);
        require(body.available() == 0, "an unrepresentable available count is unknown rather than overflowed");
        require(body.skip(Long.MAX_VALUE) == Integer.MAX_VALUE, "each skip result fits Chromium's Java bridge");
        require(body.available() == 23 && body.skip(Long.MAX_VALUE) == 20,
                "large offsets can be skipped across multiple calls");
        require(source.available() == 3, "large virtual seeks do not consume body data");
        equal(new byte[]{7, 8, 9}, readAll(body), "body remains exact after a large virtual offset");
        body.close();
    }

    private static InputStream explicit(int start, int end) throws IOException {
        return new WebViewRangeInputStream(sliced(start, end), start);
    }

    private static InputStream sliced(int start, int end) throws IOException {
        ByteArrayInputStream file = new ByteArrayInputStream(FILE);
        require(file.skip(start) == start, "fixture slice starts at requested file offset");
        return new LimitedStream(file, end - start + 1L);
    }

    /** Models Chromium's available() range check followed by its skip loop. */
    private static byte[] readLikeWebView(InputStream body, long start, long end) throws IOException {
        int available = body.available();
        if (available > 0 && (start < 0 || start >= available || Math.min(end, available - 1L) < start)) {
            throw new IOException("Requested range is outside the stream reported by available()");
        }
        long remaining = start;
        while (remaining > 0) {
            long skipped = body.skip(remaining);
            if (skipped <= 0 || skipped > remaining) throw new IOException("Range seek failed");
            remaining -= skipped;
        }
        return readAll(body);
    }

    private static byte[] readAll(InputStream source) throws IOException {
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        byte[] buffer = new byte[17];
        for (int size; (size = source.read(buffer)) != -1;) bytes.write(buffer, 0, size);
        return bytes.toByteArray();
    }

    private static byte[] expected(int start, int end) {
        return Arrays.copyOfRange(FILE, start, end + 1);
    }

    private static void equal(byte[] expected, byte[] actual, String message) {
        require(Arrays.equals(expected, actual), message);
    }

    private static void require(boolean condition, String message) {
        checks++;
        if (!condition) throw new AssertionError(message);
    }

    private static final class TrackingStream extends ByteArrayInputStream {
        boolean closed;
        TrackingStream(byte[] data) { super(data); }
        @Override public void close() throws IOException { closed = true; super.close(); }
    }
}
