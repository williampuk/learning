package learning.fix;

import quickfix.ApplicationAdapter;
import quickfix.ConfigError;
import quickfix.DefaultMessageFactory;
import quickfix.FieldNotFound;
import quickfix.FileLogFactory;
import quickfix.FileStoreFactory;
import quickfix.Group;
import quickfix.Log;
import quickfix.LogFactory;
import quickfix.MemoryStoreFactory;
import quickfix.Message;
import quickfix.RejectLogon;
import quickfix.Session;
import quickfix.SessionID;
import quickfix.SessionSettings;
import quickfix.SocketAcceptor;
import quickfix.SocketInitiator;
import quickfix.field.ApplVerID;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.time.Duration;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;

/** Shared localhost wiring and assertions. Workflows consume messages on the scenario thread. */
final class LabPeer extends ApplicationAdapter implements AutoCloseable {
    static final String FIX44 = "FIX.4.4";
    static final String FIXT11 = "FIXT.1.1";
    static final String HOST = "127.0.0.1";
    static final String VENUE = "VENUE";
    static final String CLIENT = "CLIENT";
    static final String SYMBOL = "ACME";
    private static final DefaultMessageFactory MESSAGES = new DefaultMessageFactory();
    private static final Log NO_LOG = new Log() {
        public void clear() {}
        public void onIncoming(String message) {}
        public void onOutgoing(String message) {}
        public void onEvent(String message) {}
        public void onErrorEvent(String message) {}
    };

    record Arrival(SessionID session, Message message) {}
    record Health(boolean loggedOn, long lastRx, long lastTx, int nextIn, int nextOut) {
        boolean staleAt(long observedAt, Duration limit) {
            return loggedOn && observedAt - lastRx > limit.toNanos();
        }
    }

    private final ArrayBlockingQueue<Arrival> application = new ArrayBlockingQueue<>(8192);
    private final ArrayBlockingQueue<Arrival> admin = new ArrayBlockingQueue<>(256);
    private final Map<SessionID, Long> rx = new ConcurrentHashMap<>();
    private final Map<SessionID, Long> tx = new ConcurrentHashMap<>();
    private final Set<SessionID> loggedOn = ConcurrentHashMap.newKeySet();
    private final SocketInitiator initiator;
    private final SocketAcceptor acceptor;
    private final Set<SessionID> sessions;
    private final boolean trace;
    private final String logonToken;
    private volatile RuntimeException callbackFailure;

    LabPeer(SessionSettings settings, boolean listener, boolean fileStore, boolean wireLog,
            boolean trace, String logonToken) throws ConfigError {
        this.trace = trace;
        this.logonToken = logonToken;
        Set<SessionID> configured = new HashSet<>();
        settings.sectionIterator().forEachRemaining(configured::add);
        sessions = Set.copyOf(configured);
        var storeFactory = fileStore ? new FileStoreFactory(settings) : new MemoryStoreFactory();
        LogFactory logFactory = wireLog ? new FileLogFactory(settings) : id -> NO_LOG;
        acceptor = listener ? new SocketAcceptor(this, storeFactory, settings, logFactory, MESSAGES) : null;
        initiator = listener ? null : new SocketInitiator(this, storeFactory, settings, logFactory, MESSAGES);
    }

    void start() throws ConfigError {
        if (acceptor != null) {
            acceptor.start();
        } else {
            initiator.start();
        }
    }

    Set<SessionID> sessions() {
        return sessions;
    }

    SessionID onlySession() {
        check(sessions.size() == 1, "Expected exactly one configured session");
        return sessions.iterator().next();
    }

    void awaitLogon() throws InterruptedException {
        check(awaitLogon(Duration.ofSeconds(6)), "Logon timed out on " + sessions);
    }

    boolean awaitLogon(Duration timeout) throws InterruptedException {
        long start = System.nanoTime();
        while (!loggedOn.containsAll(sessions) && System.nanoTime() - start < timeout.toNanos()) {
            checkCallbacks();
            Thread.sleep(10);
        }
        return loggedOn.containsAll(sessions);
    }

    @Override
    public void onLogon(SessionID id) {
        loggedOn.add(id);
    }

    @Override
    public void onLogout(SessionID id) {
        loggedOn.remove(id);
    }

    @Override
    public void fromApp(Message message, SessionID id) {
        rx.put(id, System.nanoTime());
        enqueue(application, message, id);
    }

    @Override
    public void toApp(Message message, SessionID id) {
        tx.put(id, System.nanoTime());
    }

    @Override
    public void fromAdmin(Message message, SessionID id) throws FieldNotFound, RejectLogon {
        rx.put(id, System.nanoTime());
        if (acceptor != null && logonToken != null && type(message).equals("A")) {
            if (!message.isSetField(553) || !message.getString(553).equals("loopback")
                    || !message.isSetField(554) || !message.getString(554).equals(logonToken)
                    || !message.isSetField(464) || !message.getBoolean(464)) {
                throw new RejectLogon("Invalid lab credentials or environment");
            }
        }
        enqueue(admin, message, id);
    }

    @Override
    public void toAdmin(Message message, SessionID id) {
        tx.put(id, System.nanoTime());
        if (initiator != null && logonToken != null && "A".equals(type(message))) {
            message.setString(553, "loopback");
            message.setString(554, logonToken);
            message.setBoolean(464, true);
        }
    }

    private void enqueue(ArrayBlockingQueue<Arrival> target, Message message, SessionID id) {
        if (!target.offer(new Arrival(id, message))) {
            callbackFailure = new IllegalStateException("Scenario queue overflow for " + id);
        }
    }

    Health health(SessionID id) {
        Session session = Session.lookupSession(id);
        return new Health(loggedOn.contains(id), rx.getOrDefault(id, 0L), tx.getOrDefault(id, 0L),
                session.getExpectedTargetNum(), session.getExpectedSenderNum());
    }

    Arrival receive(String msgType) throws InterruptedException {
        Arrival next = application.poll(6, TimeUnit.SECONDS);
        checkCallbacks();
        check(next != null, "Timed out expecting " + msgType + " on " + sessions);
        check(msgType.equals(type(next.message())), "Expected " + msgType + " but got " + type(next.message())
                + " on " + next.session() + ": " + printable(next.message()));
        if (trace) {
            System.out.println(next.session() + " RX " + printable(next.message()));
        }
        return next;
    }

    Message expect(String msgType) throws InterruptedException {
        return receive(msgType).message();
    }

    Message expectAdmin(String msgType) throws InterruptedException {
        long start = System.nanoTime();
        while (System.nanoTime() - start < TimeUnit.SECONDS.toNanos(6)) {
            Arrival next = admin.poll(100, TimeUnit.MILLISECONDS);
            checkCallbacks();
            if (next != null && msgType.equals(type(next.message()))) {
                if (trace) {
                    System.out.println(next.session() + " RX admin " + printable(next.message()));
                }
                return next.message();
            }
        }
        throw new IllegalStateException("Timed out expecting admin " + msgType);
    }

    private void checkCallbacks() {
        if (callbackFailure != null) {
            throw callbackFailure;
        }
    }

    static void send(Message message, SessionID session) throws Exception {
        check(Session.sendToTarget(message, session), "Send was declined on " + session);
    }

    void send(Message message) throws Exception {
        send(message, onlySession());
    }

    @Override
    public void close() {
        if (initiator != null) {
            initiator.stop();
        } else {
            acceptor.stop();
        }
    }

    static SessionSettings settings(Path directory, int port, boolean listener, String version,
                                    List<String> clientIds, String extra) throws ConfigError {
        String endpoint = listener
                ? "SocketAcceptAddress=" + HOST + "\nSocketAcceptPort=" + port
                : "SocketConnectHost=" + HOST + "\nSocketConnectPort=" + port + "\nHeartBtInt=30";
        String dictionaries = FIXT11.equals(version)
                ? "DefaultApplVerID=9\nTransportDataDictionary=FIXT11.xml\nAppDataDictionary=FIX50SP2.xml\n"
                : "DataDictionary=FIX44.xml\n";
        StringBuilder config = new StringBuilder("""
                [DEFAULT]
                ConnectionType=%s
                %s
                NonStopSession=Y
                UseDataDictionary=Y
                PersistMessages=Y
                ResetOnLogon=N
                ResetOnLogout=N
                ResetOnDisconnect=N
                ReconnectInterval=1
                FileStorePath=%s
                FileLogPath=%s
                """.formatted(listener ? "acceptor" : "initiator", endpoint,
                directory.resolve("store"), directory.resolve("log")));
        config.append(dictionaries).append(extra).append('\n');
        for (String client : clientIds) {
            config.append("""
                    [SESSION]
                    BeginString=%s
                    SenderCompID=%s
                    TargetCompID=%s
                    """.formatted(version, listener ? VENUE : client, listener ? client : VENUE));
        }
        return new SessionSettings(new ByteArrayInputStream(config.toString().getBytes(StandardCharsets.UTF_8)));
    }

    static int loopbackPort() throws IOException {
        try (var socket = new ServerSocket(0, 1, InetAddress.getByName(HOST))) {
            return socket.getLocalPort();
        }
    }

    static Message message(String msgType) {
        return MESSAGES.create(FIX44, msgType);
    }

    static Message fix50(String msgType) {
        return MESSAGES.create(FIXT11, new ApplVerID("9"), msgType);
    }

    static Group group(String msgType, int countTag) {
        Group group = MESSAGES.create(FIX44, msgType, countTag);
        check(group != null, "Unknown FIX 4.4 group " + msgType + "/" + countTag);
        return group;
    }

    static Message order(String id, String symbol, char side, int qty, String limit) {
        Message order = message("D");
        orderFields(order, id, symbol, side, qty);
        order.setChar(40, '2');
        order.setString(44, limit);
        order.setChar(59, '0');
        return order;
    }

    static void orderFields(Message order, String id, String symbol, char side, int qty) {
        order.setString(11, id);
        order.setString(55, symbol);
        order.setChar(54, side);
        order.setInt(38, qty);
        time(order, 60);
    }

    static void time(quickfix.FieldMap fields, int tag) {
        fields.setUtcTimeStamp(tag, LocalDateTime.now(ZoneOffset.UTC));
    }

    static String type(Message message) {
        try {
            return message.getHeader().getString(35);
        } catch (FieldNotFound e) {
            throw new IllegalStateException("Message lacks 35", e);
        }
    }

    static String printable(Message message) {
        return message.toRawString().replace('\u0001', '|');
    }

    static void field(quickfix.FieldMap message, int tag, String expected) throws FieldNotFound {
        String actual = message.getString(tag);
        check(expected.equals(actual), "Tag " + tag + " expected " + expected + " but got " + actual);
    }

    static void check(boolean pass, String description) {
        if (!pass) {
            throw new IllegalStateException(description);
        }
    }
}
