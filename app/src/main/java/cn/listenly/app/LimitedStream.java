package cn.listenly.app;

import java.io.IOException;
import java.io.InputStream;

/** Restricts reads and skips to the declared response body. */
final class LimitedStream extends InputStream {
    private final InputStream source;
    private long remaining;

    LimitedStream(InputStream source, long length) {
        if (source == null) throw new NullPointerException("source");
        if (length < 0) throw new IllegalArgumentException("length must be nonnegative");
        this.source = source;
        remaining = length;
    }

    @Override public int read() throws IOException {
        if (remaining == 0) return -1;
        int next = source.read();
        if (next == -1) remaining = 0;
        else remaining--;
        return next;
    }

    @Override public int read(byte[] buffer, int offset, int count) throws IOException {
        if (buffer == null) throw new NullPointerException("buffer");
        if (offset < 0 || count < 0 || count > buffer.length - offset) throw new IndexOutOfBoundsException();
        if (count == 0) return 0;
        if (remaining == 0) return -1;
        int result = source.read(buffer, offset, (int) Math.min(count, remaining));
        if (result == -1) remaining = 0;
        else if (result > 0) remaining -= result;
        return result;
    }

    @Override public long skip(long count) throws IOException {
        if (count <= 0 || remaining == 0) return 0;
        long skipped = source.skip(Math.min(count, remaining));
        remaining -= skipped;
        return skipped;
    }

    @Override public int available() throws IOException {
        return (int) Math.min(source.available(), remaining);
    }

    @Override public void close() throws IOException {
        source.close();
    }
}
