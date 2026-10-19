package cn.listenly.app;

import java.util.Arrays;

/** Host-JVM coverage for the production mode selection; no device is reset. */
public final class RefreshRatePolicyTest {
    private static int checks;

    private static void expect(float expected, float actual, String message) {
        if (!Float.isFinite(actual) || Math.abs(expected - actual) > .001f) throw new AssertionError(message + ": " + actual);
        checks++;
    }

    private static float choose(float... rates) {
        int[] widths = new int[rates.length], heights = new int[rates.length];
        Arrays.fill(widths, 1080); Arrays.fill(heights, 2400);
        return MainActivity.RefreshRatePolicy.choose(1080, 2400, widths, heights, rates);
    }

    public static void main(String[] args) {
        expect(120, choose(60, 90, 120, 144), "120 Hz is preferred to the maximum advertised mode");
        expect(119.88f, choose(60, 119.88f), "fractional supported refresh rates retain their exact value");
        expect(90, choose(60, 90), "90 Hz phones keep a supported high-refresh preference");
        expect(144, choose(60, 90, 144), "the nearest supported high rate is used when 120 is absent");
        expect(0, choose(30, 48, 59.94f, 60), "60 Hz-only displays retain the system default");
        expect(120, choose(Float.NaN, Float.POSITIVE_INFINITY, -90, 0, 120), "invalid vendor rate entries are ignored");
        expect(0, choose(), "an empty mode list grants no preference");
        expect(90, MainActivity.RefreshRatePolicy.choose(1080, 2400,
                new int[] {1440, 1080, 1080}, new int[] {3200, 2400, 2400}, new float[] {120, 60, 90}),
                "a 120 Hz mode at another resolution cannot be selected");
        expect(0, MainActivity.RefreshRatePolicy.choose(0, 2400,
                new int[] {1080}, new int[] {2400}, new float[] {120}), "an invalid current resolution is ignored");
        expect(0, MainActivity.RefreshRatePolicy.choose(1080, 2400, null, new int[0], new float[0]),
                "missing vendor mode arrays are safe");
        expect(90, MainActivity.RefreshRatePolicy.choose(1080, 2400,
                new int[] {1080}, new int[] {2400, 2400}, new float[] {90, 120}),
                "incomplete vendor mode arrays never read beyond their shared bounds");
        System.out.println("PASS " + checks + " same-resolution refresh-rate policy checks (production code, Java 8).");
    }
}
