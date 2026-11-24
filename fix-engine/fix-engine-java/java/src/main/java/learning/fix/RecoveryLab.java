package learning.fix;

import java.io.BufferedInputStream;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.util.HashSet;
import java.util.Set;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

import quickfix.ApplicationAdapter;
import quickfix.DefaultMessageFactory;
import quickfix.FieldNotFound;
import quickfix.FileLogFactory;
import quickfix.FileStoreFactory;
import quickfix.Message;
import quickfix.Session;
import quickfix.SessionID;
import quickfix.SessionNotFound;
import quickfix.SessionSettings;
import quickfix.SocketAcceptor;
import quickfix.SocketInitiator;
import quickfix.fix44.ExecutionReport;
import quickfix.fix44.NewOrderSingle;

/** A local initiator, fake venue and one-shot link failure, with QuickFIX/J on both sides. */
public final class RecoveryLab {
    private static final String HOST = "127.0.0.1";
    private static final String SOH = "\u0001";

    public static void main(String[] args) throws Exception {
        int port = args.length == 0 ? 19876 : Integer.parseInt(args[0]);
        Path evidence = Files.createTempDirectory("fix-recovery-");
        System.out.println("Session stores and wire logs: " + evidence);

        try (ServerSocket link = new ServerSocket()) {
            link.bind(new InetSocketAddress(HOST, 0));
            SessionSettings venue = settings(evidence.resolve("venue"), """
                    ConnectionType=acceptor
                    SocketAcceptAddress=127.0.0.1
                    SocketAcceptPort=%d
                    """.formatted(port), "VENUE", "BROKER");
            SessionSettings broker = settings(evidence.resolve("broker"), """
                    ConnectionType=initiator
                    SocketConnectHost=127.0.0.1
                    SocketConnectPort=%d
                    ReconnectInterval=1
                    HeartBtInt=30
                    """.formatted(link.getLocalPort()), "BROKER", "VENUE");

            CompletableFuture<Integer> result = new CompletableFuture<>();
            AtomicBoolean cut = new AtomicBoolean();
            SocketAcceptor acceptor = new SocketAcceptor(new Venue(), new FileStoreFactory(venue),
                    venue, new FileLogFactory(venue), new DefaultMessageFactory());
            SocketInitiator initiator = new SocketInitiator(new Broker(result), new FileStoreFactory(broker),
                    broker, new FileLogFactory(broker), new DefaultMessageFactory());
            acceptor.start();
            try {
                startDaemon("local-fault-link", () -> relayConnections(link, port, cut, result));
                initiator.start();
                int filled = result.get(25, TimeUnit.SECONDS);
                if (!cut.get() || filled != 100) {
                    throw new IllegalStateException("Expected a dropped fill and recovery of 100 shares");
                }
                System.out.println("PASS: replayed E2 applied once. Filled 100, leaves 0.");
            } finally {
                initiator.stop();
                acceptor.stop();
            }
        }
    }

    private static SessionSettings settings(Path directory, String connection, String sender, String target)
            throws Exception {
        String config = """
                [DEFAULT]
                NonStopSession=Y
                UseDataDictionary=Y
                DataDictionary=FIX44.xml
                PersistMessages=Y
                ResetOnLogon=N
                ResetOnLogout=N
                ResetOnDisconnect=N
                FileStorePath=%s
                FileLogPath=%s
                %s
                [SESSION]
                BeginString=FIX.4.4
                SenderCompID=%s
                TargetCompID=%s
                """.formatted(directory.resolve("store"), directory.resolve("log"), connection, sender, target);
        return new SessionSettings(new ByteArrayInputStream(config.getBytes(StandardCharsets.UTF_8)));
    }

    private static final class Broker extends ApplicationAdapter {
        private final CompletableFuture<Integer> result;
        private final AtomicBoolean submitted = new AtomicBoolean();
        // The lab has one session with serial application callbacks. A real ledger commits durably.
        private final Set<String> appliedExecutions = new HashSet<>();
        private boolean accepted;
        private int filled;

        Broker(CompletableFuture<Integer> result) {
            this.result = result;
        }

        @Override
        public void onLogon(SessionID session) {
            if (!submitted.compareAndSet(false, true)) {
                return; // Reconnect never submits a fresh order.
            }
            NewOrderSingle order = new NewOrderSingle();
            order.setString(11, "C42");
            order.setString(55, "DEMO");
            order.setChar(54, '1'); // Buy
            order.setUtcTimeStamp(60, LocalDateTime.now(ZoneOffset.UTC));
            order.setChar(40, '2'); // Limit
            order.setInt(38, 100);
            order.setString(44, "25.00");
            try {
                send(order, session);
            } catch (RuntimeException failure) {
                result.completeExceptionally(failure);
            }
        }

        @Override
        public void fromApp(Message message, SessionID session) throws FieldNotFound {
            if (!(message instanceof ExecutionReport) || !"C42".equals(message.getString(11))
                    || !"V900".equals(message.getString(37))) {
                result.completeExceptionally(new IllegalStateException("Unexpected execution report identity"));
                return;
            }
            char eventType = message.getChar(150);
            if (eventType == '0') {
                accepted = message.getInt(151) == 100;
                return;
            }
            if (eventType != 'F') {
                return;
            }
            String executionId = message.getString(17);
            if (!accepted || !"E2".equals(executionId) || message.getChar(39) != '2'
                    || message.getInt(14) != 100 || message.getInt(151) != 0) {
                result.completeExceptionally(new IllegalStateException("Expected E2 to fill the accepted order"));
                return;
            }
            if (!message.getHeader().isSetField(43) || !message.getHeader().getBoolean(43)
                    || !message.getHeader().isSetField(122) || message.getHeader().getInt(34) != 3) {
                result.completeExceptionally(new IllegalStateException("Expected FIX retransmission headers"));
                return;
            }
            int lastQuantity = message.getInt(32);
            if (appliedExecutions.add(executionId)) {
                filled += lastQuantity;
                result.complete(filled);
            }
        }
    }

    private static final class Venue extends ApplicationAdapter {
        @Override
        public void fromApp(Message order, SessionID session) throws FieldNotFound {
            send(report(order, "E1", false), session);
            send(report(order, "E2", true), session);
        }

        private ExecutionReport report(Message order, String execId, boolean fill) throws FieldNotFound {
            ExecutionReport report = new ExecutionReport();
            report.setString(37, "V900");
            report.setString(17, execId);
            report.setString(11, order.getString(11));
            report.setString(55, order.getString(55));
            report.setChar(54, order.getChar(54));
            report.setChar(150, fill ? 'F' : '0');
            report.setChar(39, fill ? '2' : '0');
            report.setInt(151, fill ? 0 : 100);
            report.setInt(14, fill ? 100 : 0);
            report.setString(6, fill ? "25.00" : "0");
            if (fill) {
                report.setString(31, "25.00");
                report.setInt(32, 100);
            }
            return report;
        }
    }

    private static void send(Message message, SessionID session) {
        try {
            if (!Session.sendToTarget(message, session)) {
                throw new IllegalStateException("QuickFIX/J declined the lab send");
            }
        } catch (SessionNotFound failure) {
            throw new IllegalStateException(failure);
        }
    }

    private static void relayConnections(ServerSocket link, int venuePort, AtomicBoolean cut,
                                         CompletableFuture<Integer> result) {
        while (!link.isClosed()) {
            try (Socket broker = link.accept(); Socket venue = new Socket(HOST, venuePort)) {
                startDaemon("broker-to-venue", () -> relayBroker(broker, venue));
                var input = new BufferedInputStream(venue.getInputStream());
                byte[] frame;
                while ((frame = TagValueFrame.read(input)) != null) {
                    String wire = new String(frame, StandardCharsets.US_ASCII);
                    // The lab has only generated ASCII messages with no binary data fields.
                    if (wire.contains(SOH + "35=8" + SOH) && wire.contains(SOH + "17=E2" + SOH)
                            && cut.compareAndSet(false, true)) {
                        System.out.println("Link dropped the original fill: " + wire.replace(SOH, "|"));
                        break; // Both sockets close. The two engines keep their session stores.
                    }
                    broker.getOutputStream().write(frame);
                }
            } catch (IOException failure) {
                if (!link.isClosed()) {
                    result.completeExceptionally(failure);
                }
                return;
            }
        }
    }

    private static void startDaemon(String name, Runnable task) {
        Thread thread = new Thread(task, name);
        thread.setDaemon(true);
        thread.start();
    }

    private static void relayBroker(Socket broker, Socket venue) {
        try {
            broker.getInputStream().transferTo(venue.getOutputStream());
        } catch (IOException ignored) {
            // The other relay may have intentionally closed both sockets.
        } finally {
            try {
                venue.shutdownOutput();
            } catch (IOException ignored) {
                // The venue socket can already be closed.
            }
        }
    }
}
