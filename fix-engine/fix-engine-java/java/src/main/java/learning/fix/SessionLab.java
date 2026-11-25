package learning.fix;

import quickfix.Message;
import quickfix.SessionSettings;
import quickfix.field.ApplVerID;

import javax.xml.XMLConstants;
import javax.xml.parsers.DocumentBuilderFactory;
import javax.xml.transform.TransformerFactory;
import javax.xml.transform.dom.DOMSource;
import javax.xml.transform.stream.StreamResult;
import java.io.BufferedInputStream;
import java.io.InputStream;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.GregorianCalendar;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.TimeUnit;

import static learning.fix.LabPeer.*;

/** Local exercises for first contact, versioning, validation, liveness, restart and secure sessions. */
public final class SessionLab {
    public static void main(String[] args) throws Exception {
        if (args.length == 0) {
            throw new IllegalArgumentException("Choose accept, connect, fix50, dictionary, liveness, restart, reset, failover or tls");
        }
        switch (args[0]) {
            case "accept" -> baseline(true, args[1]);
            case "connect" -> baseline(false, args[1]);
            case "fix50" -> versions();
            case "dictionary" -> dictionary();
            case "liveness" -> liveness();
            case "restart" -> restart(Path.of(args[1]));
            case "reset" -> resets();
            case "failover" -> failover();
            case "tls" -> tls();
            default -> throw new IllegalArgumentException("Unknown exercise " + args[0]);
        }
    }

    private static void baseline(boolean listener, String path) throws Exception {
        try (var peer = new LabPeer(new SessionSettings(path), listener, true, true, true, null)) {
            peer.start();
            if (listener) System.out.println("Listening for one local initiator.");
            check(peer.awaitLogon(Duration.ofSeconds(60)), "Start the other peer within 60 seconds");
            peer.expectAdmin("A");
            if (listener) {
                var order = peer.expect("D");
                peer.send(acknowledgement(order.getString(11), order, "8"));
                peer.expectAdmin("5");
            } else {
                String id = "FIRST-" + peer.health(peer.onlySession()).nextOut();
                peer.send(order(id, SYMBOL, '1', 100, "25.00"));
                Message report = peer.expect("8");
                field(report, 11, id);
                field(report, 39, "0");
            }
        }
    }

    private static void versions() throws Exception {
        Path directory = Files.createTempDirectory("fix-version-");
        int port = loopbackPort();
        String extra = "AppDataDictionary.FIX.4.4=FIX44.xml";
        try (var venue = new LabPeer(settings(directory.resolve("venue"), port, true, FIXT11,
                List.of(CLIENT), extra), true, true, true, true, null);
             var client = new LabPeer(settings(directory.resolve("client"), port, false, FIXT11,
                List.of(CLIENT), extra), false, true, true, true, null)) {
            venue.start();
            client.start();
            client.awaitLogon();
            Message logon = venue.expectAdmin("A");
            field(logon.getHeader(), 8, FIXT11);
            field(logon, 1137, "9");

            Message current = fix50("D");
            orderFields(current, "CURRENT", "FUT-DEMO", '1', 2);
            current.setChar(40, '2');
            current.setString(44, "5000.25");
            current.setString(167, "FUT");
            current.setString(200, "202712");
            current.setString(231, "50");
            client.send(current);
            Message routed = venue.expect("D");
            check(routed instanceof quickfix.fix50sp2.NewOrderSingle, "Expected FIX 5.0 SP2 dictionary");
            field(routed, 167, "FUT");
            venue.send(acknowledgement("CURRENT", routed, "8"));
            client.expect("8");

            Message old = order("OLD", SYMBOL, '1', 100, "25.00");
            old.getHeader().setField(new ApplVerID("6"));
            client.send(old);
            Message override = venue.expect("D");
            field(override.getHeader(), 8, FIXT11);
            field(override.getHeader(), 1128, "6");
            check(override instanceof quickfix.fix44.NewOrderSingle, "Expected FIX 4.4 override");
            System.out.println("PASS FIXT: Logon defaulted to FIX 5.0 SP2; one order used FIX 4.4 on the same session.");
            System.out.println("Wire logs: " + directory);
        }
    }

    private static void dictionary() throws Exception {
        Path directory = Files.createTempDirectory("fix-dictionary-");
        Path custom = directory.resolve("FIX44-local.xml");
        extendDictionary(custom);
        int port = loopbackPort();
        try (var venue = new LabPeer(settings(directory.resolve("venue"), port, true, FIX44,
                List.of(CLIENT), "DataDictionary=" + custom), true, true, true, true, null);
             var client = new LabPeer(settings(directory.resolve("client"), port, false, FIX44,
                List.of(CLIENT), ""), false, true, true, true, null)) {
            venue.start();
            client.start();
            client.awaitLogon();
            client.send(order("MISSING", SYMBOL, '1', 100, "25.00"));
            Message reject = client.expectAdmin("3");
            field(reject, 371, "9001");
            field(reject, 372, "D");

            Message valid = order("ALGO", SYMBOL, '1', 100, "25.00");
            valid.setString(9001, "DEMO_TWAP_V1");
            client.send(valid);
            Message admitted = venue.expect("D");
            field(admitted, 11, "ALGO");
            field(admitted, 9001, "DEMO_TWAP_V1");
            venue.send(acknowledgement("ALGO", admitted, "8"));
            client.expect("8");
            System.out.println("PASS dictionary: missing required custom field rejected before application delivery.");
            System.out.println("Dictionary and wire logs: " + directory);
        }
    }

    private static void extendDictionary(Path output) throws Exception {
        var factory = DocumentBuilderFactory.newInstance();
        factory.setAttribute(XMLConstants.ACCESS_EXTERNAL_DTD, "");
        factory.setAttribute(XMLConstants.ACCESS_EXTERNAL_SCHEMA, "");
        try (var builtin = SessionLab.class.getResourceAsStream("/FIX44.xml")) {
            check(builtin != null, "FIX 4.4 dictionary unavailable");
            var document = factory.newDocumentBuilder().parse(builtin);
            var definitions = document.getElementsByTagName("fields").item(0);
            var definition = document.createElement("field");
            definition.setAttribute("number", "9001");
            definition.setAttribute("name", "LabStrategyID");
            definition.setAttribute("type", "STRING");
            definitions.appendChild(definition);

            var messages = document.getElementsByTagName("message");
            for (int i = 0; i < messages.getLength(); i++) {
                var candidate = (org.w3c.dom.Element) messages.item(i);
                if ("D".equals(candidate.getAttribute("msgtype"))) {
                    var field = document.createElement("field");
                    field.setAttribute("name", "LabStrategyID");
                    field.setAttribute("required", "Y");
                    candidate.appendChild(field);
                    break;
                }
            }
            TransformerFactory.newInstance().newTransformer()
                    .transform(new DOMSource(document), new StreamResult(output.toFile()));
        }
    }

    private static void restart(Path directory) throws Exception {
        directory = directory.toAbsolutePath();
        Files.createDirectories(directory);
        Path evidence = directory.resolve("last-order-sequence");
        int previous = Files.exists(evidence) ? Integer.parseInt(Files.readString(evidence).strip()) : 0;
        int current = oneExchange(directory, loopbackPort(), true, "RESTART-" + previous);
        check(current > previous, "A persisted FIX session must continue from earlier sequence state");
        Files.writeString(evidence, Integer.toString(current));
        System.out.printf("PASS file-store restart: previous order seq %d, current order seq %d, stores %s%n",
                previous, current, directory);
    }

    private static void liveness() throws Exception {
        String stalled = "STALLED";
        int heartbeatSeconds = 2;
        Duration staleAfter = Duration.ofSeconds(heartbeatSeconds * 2L);
        var directory = Files.createTempDirectory("fix-liveness-");
        int port = loopbackPort();
        // Leave a clear window between the monitor's alert and the engine's disconnect.
        try (var venue = new LabPeer(settings(directory.resolve("venue"), port, true, FIX44,
                List.of(CLIENT, stalled), "HeartBeatTimeoutMultiplier=3.0"), true, true, true, true, null);
             var healthy = new LabPeer(settings(directory.resolve("healthy"), port, false, FIX44,
                List.of(CLIENT), ""), false, true, true, true, null)) {
            venue.start();
            healthy.start();
            healthy.awaitLogon();
            try (var socket = new Socket(HOST, port)) {
                socket.setSoTimeout(10_000);
                var incoming = new BufferedInputStream(socket.getInputStream());
                Message logon = message("A");
                logon.setInt(98, 0);
                logon.setInt(108, heartbeatSeconds);
                writeAdmin(socket, logon, stalled, 1);
                field(readAdmin(incoming, "A"), 108, Integer.toString(heartbeatSeconds));
                venue.awaitLogon();
                var stalledSession = venue.sessions().stream()
                        .filter(id -> stalled.equals(id.getTargetCompID())).findFirst().orElseThrow();

                Message probe = readAdmin(incoming, "1");
                Message heartbeat = message("0");
                heartbeat.setString(112, probe.getString(112));
                writeAdmin(socket, heartbeat, stalled, 2);
                field(venue.expectAdmin("0"), 112, probe.getString(112));
                Health lastReply = venue.health(stalledSession);
                check(lastReply.loggedOn() && !lastReply.staleAt(System.nanoTime(), staleAfter),
                        "The matching Heartbeat must refresh liveness");

                // Leave the socket open and stop writing. The next probe will go unanswered.
                readAdmin(incoming, "1");
                long deadline = lastReply.lastRx() + TimeUnit.SECONDS.toNanos(10);
                Health state = venue.health(stalledSession);
                while (state.loggedOn() && !state.staleAt(System.nanoTime(), staleAfter)
                        && System.nanoTime() < deadline) {
                    Thread.sleep(10);
                    state = venue.health(stalledSession);
                }
                check(state.staleAt(System.nanoTime(), staleAfter), "Expected a stale alert before disconnect");
                System.out.printf("STALE %s: inbound silence exceeded %d seconds; next in=%d, next out=%d%n",
                        stalledSession, staleAfter.toSeconds(), state.nextIn(), state.nextOut());

                while (readAdminOrEof(incoming) != null) {
                    check(System.nanoTime() < deadline, "Expected the silent peer's socket to close");
                }
                healthy.send(order("STILL-LIVE", SYMBOL, '1', 5, "25.00"));
                var order = venue.receive("D");
                send(acknowledgement("STILL-LIVE", order.message(), "8"), order.session());
                field(healthy.expect("8"), 11, "STILL-LIVE");
                System.out.println("PASS liveness: matching Heartbeat restored freshness; then silence triggered "
                        + "a stale alert and disconnect while the other session could still trade.");
                System.out.println("Wire logs: " + directory);
            }
        }
    }

    private static void writeAdmin(Socket socket, Message message, String sender, int sequence) throws Exception {
        var header = message.getHeader();
        header.setString(8, FIX44);
        header.setInt(34, sequence);
        header.setString(49, sender);
        header.setString(56, VENUE);
        time(header, 52);
        socket.getOutputStream().write(message.toString().getBytes(StandardCharsets.US_ASCII));
    }

    private static Message readAdmin(InputStream stream, String msgType) throws Exception {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(10);
        Message incoming;
        while (System.nanoTime() < deadline && (incoming = readAdminOrEof(stream)) != null) {
            if (msgType.equals(type(incoming))) return incoming;
        }
        throw new IllegalStateException("Expected " + msgType + " from acceptor");
    }

    private static Message readAdminOrEof(InputStream stream) throws Exception {
        byte[] frame = TagValueFrame.read(stream);
        return frame == null ? null : new Message(new String(frame, StandardCharsets.US_ASCII));
    }

    private static void failover() throws Exception {
        var directory = Files.createTempDirectory("fix-takeover-");
        int primaryPort = loopbackPort();
        int standbyPort;
        do {
            standbyPort = loopbackPort();
        } while (standbyPort == primaryPort);
        int first = oneExchange(directory, primaryPort, true, "PRIMARY");
        int second = oneExchange(directory, standbyPort, true, "STANDBY");
        check(second > first, "Standby started with stale state");
        var memory = Files.createTempDirectory("fix-volatile-");
        int memoryFirst = oneExchange(memory, loopbackPort(), false, "MEMORY-1");
        int memorySecond = oneExchange(memory, loopbackPort(), false, "MEMORY-2");
        check(memoryFirst == 2 && memorySecond == 2, "Memory stores should both start fresh");
        System.out.printf("PASS takeover: port %d retired before %d bound; sequence %d -> %d; "
                + "memory-store control %d -> %d.%n", primaryPort, standbyPort, first, second,
                memoryFirst, memorySecond);
    }

    private static int oneExchange(Path directory, int port, boolean persistent, String id) throws Exception {
        return oneExchange(directory, port, persistent, id, false);
    }

    private static int oneExchange(Path directory, int port, boolean persistent, String id, boolean reset)
            throws Exception {
        String extra = reset ? "ResetOnLogon=Y" : "";
        try (var venue = new LabPeer(settings(directory.resolve("venue"), port, true, FIX44,
                List.of(CLIENT), extra), true, persistent, true, false, null);
             var client = new LabPeer(settings(directory.resolve("client"), port, false, FIX44,
                List.of(CLIENT), extra), false, persistent, true, false, null)) {
            venue.start();
            client.start();
            client.awaitLogon();
            if (reset) {
                Message logon = venue.expectAdmin("A");
                field(logon.getHeader(), 34, "1");
                field(logon, 141, "Y");
            }
            client.send(order(id, SYMBOL, '1', 5, "25.00"));
            Message order = venue.expect("D");
            venue.send(acknowledgement(id, order, "8"));
            field(client.expect("8"), 11, id);
            Health stats = venue.health(venue.onlySession());
            Duration threshold = Duration.ofSeconds(60);
            check(stats.loggedOn() && !stats.staleAt(System.nanoTime(), threshold) && stats.lastTx() > 0,
                    "Expected healthy active session with fresh traffic");
            return order.getHeader().getInt(34);
        }
    }

    private static void resets() throws Exception {
        var directory = Files.createTempDirectory("fix-reset-");
        int first = oneExchange(directory, loopbackPort(), true, "BEFORE-RESET");
        int second = oneExchange(directory, loopbackPort(), true, "AFTER-RESET", true);
        check(first == 2 && second == 2, "An agreed reset restarts the application sequence at 2");
        SessionSettings scheduled = settings(directory, 19877, true, FIX44,
                List.of(CLIENT), "NonStopSession=N\nStartTime=08:00:00\nEndTime=17:00:00\nTimeZone=UTC");
        var schedule = new quickfix.DefaultSessionSchedule(scheduled, scheduled.sectionIterator().next());
        var morning = GregorianCalendar.from(Instant.parse("2026-11-24T08:01:00Z").atZone(ZoneOffset.UTC));
        var afternoon = GregorianCalendar.from(Instant.parse("2026-11-24T16:59:00Z").atZone(ZoneOffset.UTC));
        var nextMorning = GregorianCalendar.from(Instant.parse("2026-11-25T08:01:00Z").atZone(ZoneOffset.UTC));
        check(schedule.isSameSession(morning, afternoon) && !schedule.isSameSession(morning, nextMorning),
                "An intraday reconnect and a new session window must be distinguished");
        System.out.println("PASS reset: peer saw 34=1/141=Y; next application seq 2; day boundary recognized.");
    }

    private static void tls() throws Exception {
        Path directory = Files.createTempDirectory("fix-tls-");
        String password = UUID.randomUUID().toString();
        String token = UUID.randomUUID().toString();
        for (String role : List.of("venue", "client")) {
            keytool(directory, "-genkeypair", "-alias", role, "-dname", "CN=" + role,
                    "-ext", "SAN=DNS:localhost,IP:127.0.0.1", "-keyalg", "RSA", "-keysize", "2048",
                    "-validity", "1", "-keystore", role + ".p12", "-storetype", "PKCS12",
                    "-storepass", password);
            keytool(directory, "-exportcert", "-alias", role, "-keystore", role + ".p12",
                    "-storepass", password, "-file", role + ".cer");
        }
        trust(directory, "venue", "client", password);
        trust(directory, "client", "venue", password);
        trust(directory, "wrong", "client", password);
        int port = loopbackPort();
        try (var venue = new LabPeer(settings(directory.resolve("venue-log"), port, true, FIX44,
                List.of(CLIENT), ssl(directory, "venue", "venue", password) + "NeedClientAuth=Y\n"),
                true, false, false, false, token)) {
            venue.start();
            try (var wrongTrust = tlsClient(directory, port, "wrong", password, token)) {
                wrongTrust.start();
                check(!wrongTrust.awaitLogon(Duration.ofSeconds(2)) && !venue.health(venue.onlySession()).loggedOn(),
                        "Untrusted TLS peer must fail before Logon");
            }
            try (var wrongLogon = tlsClient(directory, port, "client", password, "invalid")) {
                wrongLogon.start();
                check(!wrongLogon.awaitLogon(Duration.ofSeconds(2)),
                        "A trusted certificate must still pass application Logon rules");
            }
            try (var client = tlsClient(directory, port, "client", password, token)) {
                client.start();
                client.awaitLogon();
                venue.awaitLogon();
                client.send(order("SECURE", SYMBOL, '1', 5, "25.00"));
                venue.send(acknowledgement("SECURE", venue.expect("D"), "8"));
                field(client.expect("8"), 39, "0");
            }
        }
        for (String file : List.of("venue.p12", "client.p12", "venue-trust.p12", "client-trust.p12",
                "wrong-trust.p12", "venue.cer", "client.cer")) {
            Files.deleteIfExists(directory.resolve(file));
        }
        Files.deleteIfExists(directory);
        System.out.println("PASS mTLS: rejected untrusted certificate and invalid FIX credentials; "
                + "correct trust and test Logon accepted.");
    }

    private static LabPeer tlsClient(Path directory, int port, String trust, String password,
                                     String token) throws Exception {
        return new LabPeer(settings(directory.resolve("client-log"), port, false, FIX44, List.of(CLIENT),
                ssl(directory, "client", trust, password) + "EndpointIdentificationAlgorithm=HTTPS\n"),
                false, false, false, false, token);
    }

    private static String ssl(Path directory, String key, String trust, String password) {
        return """
                SocketUseSSL=Y
                EnabledProtocols=TLSv1.3
                KeyStoreType=PKCS12
                TrustStoreType=PKCS12
                SocketKeyStore=%s
                SocketKeyStorePassword=%s
                SocketTrustStore=%s
                SocketTrustStorePassword=%s
                """.formatted(directory.resolve(key + ".p12"), password,
                directory.resolve(trust + "-trust.p12"), password);
    }

    private static void trust(Path directory, String store, String peer, String password) throws Exception {
        keytool(directory, "-importcert", "-noprompt", "-alias", peer, "-file", peer + ".cer",
                "-keystore", store + "-trust.p12", "-storetype", "PKCS12", "-storepass", password);
    }

    private static void keytool(Path directory, String... args) throws Exception {
        var command = new ArrayList<String>();
        command.add(Path.of(System.getProperty("java.home"), "bin", "keytool").toString());
        command.addAll(List.of(args));
        var process = new ProcessBuilder(command).directory(directory.toFile())
                .redirectError(ProcessBuilder.Redirect.DISCARD)
                .redirectOutput(ProcessBuilder.Redirect.DISCARD).start();
        check(process.waitFor() == 0, "JDK keytool failed while preparing the TLS fixture");
    }

    static Message acknowledgement(String id, Message request, String msgType) throws Exception {
        Message report = FIXT11.equals(request.getHeader().getString(8)) ? fix50(msgType) : message(msgType);
        report.setString(37, "V-" + id);
        report.setString(17, "E-" + id);
        report.setString(11, id);
        report.setString(55, request.getString(55));
        report.setChar(54, request.getChar(54));
        report.setChar(150, '0');
        report.setChar(39, '0');
        report.setInt(151, request.getInt(38));
        report.setInt(14, 0);
        report.setInt(6, 0);
        return report;
    }
}
