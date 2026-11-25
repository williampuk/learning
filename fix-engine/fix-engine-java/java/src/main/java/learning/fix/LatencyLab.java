package learning.fix;

import java.nio.file.Files;
import java.util.Arrays;
import java.util.List;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.locks.LockSupport;

import static learning.fix.LabPeer.*;

/** Fixed-rate order-to-ack measurement. The offered schedule never waits for an acknowledgement. */
public final class LatencyLab {
    public static void main(String[] args) throws Exception {
        int rate = args.length > 0 ? Integer.parseInt(args[0]) : 1000;
        int count = args.length > 1 ? Integer.parseInt(args[1]) : 2000;
        String store = args.length > 2 ? args[2] : "file";
        String logging = args.length > 3 ? args[3] : "log";
        check(rate > 0 && count >= 100 && count <= 8000 && (double) count / rate <= 20,
                "Use 100–8000 samples and at most 20 seconds of offered traffic");
        check(List.of("file", "memory").contains(store) && List.of("log", "no-log").contains(logging),
                "Choose file or memory, then log or no-log");
        boolean persistent = store.equals("file");
        boolean wireLog = logging.equals("log");
        var directory = Files.createTempDirectory("fix-paced-");
        int port = loopbackPort();
        try (var venue = new LabPeer(settings(directory.resolve("venue"), port, true, FIX44,
                List.of(CLIENT), ""), true, persistent, wireLog, false, null);
             var client = new LabPeer(settings(directory.resolve("client"), port, false, FIX44,
                List.of(CLIENT), ""), false, persistent, wireLog, false, null)) {
            venue.start();
            client.start();
            client.awaitLogon();
            for (int i = 0; i < 100; i++) {
                String id = "WARM-" + i;
                client.send(order(id, SYMBOL, '1', 1, "25.00"));
                venue.send(SessionLab.acknowledgement(id, venue.expect("D"), "8"));
                client.expect("8");
            }

            long[] latency = new long[count];
            long[] lateness = new long[count];
            long begin = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(50);
            var workers = Executors.newFixedThreadPool(2);
            var completed = new AtomicInteger();
            int sent = 0;
            try {
                var responder = workers.submit(() -> {
                    for (int i = 0; i < count; i++) {
                        var request = venue.expect("D");
                        String id = "LOAD-" + i;
                        field(request, 11, id);
                        venue.send(SessionLab.acknowledgement(id, request, "8"));
                    }
                    return null;
                });
                var receiver = workers.submit(() -> {
                    for (int i = 0; i < count; i++) {
                        var report = client.expect("8");
                        latency[i] = System.nanoTime() - scheduled(begin, i, rate);
                        field(report, 11, "LOAD-" + i);
                        completed.incrementAndGet();
                    }
                    return System.nanoTime();
                });
                for (int i = 0; i < count; i++) {
                    long due = scheduled(begin, i, rate);
                    while (due - System.nanoTime() > 0) {
                        LockSupport.parkNanos(due - System.nanoTime());
                    }
                    lateness[i] = System.nanoTime() - due;
                    client.send(order("LOAD-" + i, SYMBOL, '1', 1, "25.00"));
                    sent++;
                }
                responder.get(12, TimeUnit.SECONDS);
                long finish = receiver.get(12, TimeUnit.SECONDS);
                double elapsed = (finish - begin) / 1e9;
                Arrays.sort(latency);
                Arrays.sort(lateness);
                System.out.printf(java.util.Locale.ROOT,
                        "PASS paced loopback: offered %d msg/s, completed %d/%d (%.0f msg/s), errors 0; "
                                + "%s/%s%n", rate, count, count, count / elapsed, store, logging);
                System.out.printf(java.util.Locale.ROOT,
                        "Scheduled send-to-ack p50 %.3f ms, p99 %.3f ms, p99.9 %.3f ms; "
                                + "generator lateness p99 %.3f ms%n",
                        percentile(latency, .5), percentile(latency, .99), percentile(latency, .999),
                        percentile(lateness, .99));
                System.out.println("Run artifacts: " + directory);
            } catch (Exception failure) {
                System.err.printf("FAIL paced loopback: planned %d, sent %d, verified %d; %s%n",
                        count, sent, completed.get(), failure.getMessage());
                throw failure;
            } finally {
                workers.shutdownNow();
            }
        }
    }

    private static long scheduled(long begin, int index, int rate) {
        return begin + index * 1_000_000_000L / rate;
    }

    private static double percentile(long[] sorted, double fraction) {
        return sorted[(int) Math.ceil(fraction * sorted.length) - 1] / 1_000_000.0;
    }
}
