package cn.listenly.app;

import java.io.IOException;
import java.io.InputStream;

/**
 * Aligns an already sliced body with WebView's extra seek for an explicit Range.
 * Chromium currently skips the request offset even when the embedder has
 * returned a 206 response. The offset below exists only for skip(), so either
 * a seeking reader or a reader that consumes the body directly gets its first
 * byte at Content-Range's start. Suffix ranges do not use this adapter.
 * See components/embedder_support/android/util/input_stream_reader.cc.
 */
final class WebViewRangeInputStream extends InputStream {
    private final InputStream body;
    private long prefixRemaining;

    WebViewRangeInputStream(InputStream body, long rangeStart) {
        if (body == null) throw new NullPointerException("body");
        if (rangeStart < 0) throw new IllegalArgumentException("rangeStart must be nonnegative");
        this.body = body;
        prefixRemaining = rangeStart;
    }

    @Override public int read() throws IOException {
        return body.read();
    }

    @Override public int read(byte[] buffer, int offset, int count) throws IOException {
        return body.read(buffer, offset, count);
    }

    @Override public long skip(long count) throws IOException {
        if (count <= 0) return 0;
        // Chromium's Java stream bridge represents each skip result as an int.
        long request = Math.min(count, Integer.MAX_VALUE);
        if (prefixRemaining > 0) {
            long consumed = Math.min(request, prefixRemaining);
            prefixRemaining -= consumed;
            return consumed;
        }
        return body.skip(request);
    }

    @Override public int available() throws IOException {
        int bodyBytes = body.available();
        // Imported files are capped at 512 MiB. Avoid an overflowing Int32 if
        // this adapter is ever used with larger files; zero means unknown size.
        if (prefixRemaining > Integer.MAX_VALUE - (long) bodyBytes) return 0;
        return (int) (prefixRemaining + bodyBytes);
    }

    @Override public void close() throws IOException {
        body.close();
    }
}
