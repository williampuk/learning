package learning.fix;

import quickfix.Message;

import java.math.BigDecimal;
import java.nio.file.Files;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static learning.fix.LabPeer.*;

/** Market-data and dealer-quote state machines on separate localhost FIX sessions. */
public final class MarketAndQuoteLab {
    private static final String MARKET_DATA = "CLIENT-MD";
    private static final String RFQ = "CLIENT-RFQ";
    private static final String BOND = "BOND-DEMO";
    private static final String OFFER = "99.50";

    public static void main(String[] args) throws Exception {
        var directory = Files.createTempDirectory("fix-market-");
        int port = loopbackPort();
        try (var venue = new LabPeer(settings(directory.resolve("venue"), port, true, FIX44,
                List.of(MARKET_DATA, RFQ), ""), true, true, true, true, null);
             var md = new LabPeer(settings(directory.resolve("md"), port, false, FIX44,
                List.of(MARKET_DATA), ""), false, true, true, true, null);
             var dealerClient = new LabPeer(settings(directory.resolve("rfq"), port, false, FIX44,
                List.of(RFQ), ""), false, true, true, true, null)) {
            venue.start();
            md.start();
            dealerClient.start();
            md.awaitLogon();
            dealerClient.awaitLogon();
            marketData(venue, md);
            quotes(venue, dealerClient);
            System.out.println("Wire logs: " + directory);
        }
    }

    private static void marketData(LabPeer venue, LabPeer client) throws Exception {
        var source = new HashMap<Level, Integer>();
        source.put(new Level('0', new BigDecimal("24.80")), 200);
        source.put(new Level('1', new BigDecimal("24.90")), 40);
        source.put(new Level('1', new BigDecimal("25.10")), 60);
        var book = new Book();

        client.send(subscription("bad", '1', "UNKNOWN"));
        var unknown = venue.receive("V");
        field(unknown.message().getGroup(1, group("V", 146)), 55, "UNKNOWN");
        Message rejection = message("Y");
        rejection.setString(262, "bad");
        rejection.setChar(281, '0');
        send(rejection, unknown.session());
        field(client.expect("Y"), 281, "0");

        client.send(subscription("once", '0', SYMBOL));
        var once = venue.receive("V");
        field(once.message(), 263, "0");
        send(snapshot("once", SYMBOL, source), once.session());
        book.replace(client.expect("W"), "once");
        book.checkBestOffer("24.90");

        client.send(subscription("sub-1", '1', SYMBOL));
        var request = venue.receive("V");
        field(request.message(), 263, "1");
        field(request.message(), 264, "0");
        field(request.message(), 265, "1");
        Map<String, quickfix.SessionID> subscribers = new HashMap<>();
        subscribers.put(request.message().getString(262), request.session());
        send(snapshot("sub-1", SYMBOL, source), request.session());
        book.replace(client.expect("W"), "sub-1");
        book.checkBestOffer("24.90");

        publish(subscribers, source, book, client, new Level('1', new BigDecimal("25.00")), '0', 50);
        publish(subscribers, source, book, client, new Level('1', new BigDecimal("25.00")), '1', 30);
        publish(subscribers, source, book, client, new Level('1', new BigDecimal("24.90")), '2', 0);
        book.checkBestOffer("25.00");

        // Let the FIX session receive this change, but omit it from the application book.
        Level bid = new Level('0', new BigDecimal("24.80"));
        source.put(bid, 150);
        send(incremental("sub-1", SYMBOL, bid, '1', 150), request.session());
        Message missed = client.expect("X");
        check(!book.levels.equals(source), "A live FIX session can still have a stale book");
        book.invalidate();
        check(!book.apply(missed), "An invalidated book must wait for its snapshot");
        client.send(subscription("sub-1", '2', SYMBOL));
        Message stop = venue.expect("V");
        field(stop, 263, "2");
        subscribers.remove(stop.getString(262));
        check(subscribers.isEmpty(), "Unsubscribed feed must have no recipients");
        client.send(subscription("sub-2", '1', SYMBOL));
        var resubscribe = venue.receive("V");
        subscribers.put(resubscribe.message().getString(262), resubscribe.session());
        send(snapshot("sub-2", SYMBOL, source), resubscribe.session());
        book.replace(client.expect("W"), "sub-2");
        send(incremental("sub-1", SYMBOL, bid, '1', 100), resubscribe.session());
        check(!book.apply(client.expect("X")), "A late update from sub-1 must not change sub-2");
        book.checkBestOffer("25.00");
        check(book.levels.equals(source), "Recovered view must match");
        System.out.println("PASS market data: unknown symbol, subscription, add/change/delete, "
                + "application gap, snapshot rebuild and discarded old subscription verified.");
    }

    static Message subscription(String id, char action, String symbol) {
        Message request = message("V");
        request.setString(262, id);
        request.setChar(263, action);
        request.setInt(264, 0); // Request the full aggregated book, with no top-N truncation.
        request.setInt(265, 1);
        request.setBoolean(266, true);
        for (char side : new char[]{'0', '1'}) {
            var entry = group("V", 267);
            entry.setChar(269, side);
            request.addGroup(entry);
        }
        var instrument = group("V", 146);
        instrument.setString(55, symbol);
        request.addGroup(instrument);
        return request;
    }

    record Level(char side, BigDecimal price) {
        Level {
            price = price.stripTrailingZeros();
        }
    }

    static Message snapshot(String id, String symbol, Map<Level, Integer> source) {
        Message snapshot = message("W");
        snapshot.setString(262, id);
        snapshot.setString(55, symbol);
        source.entrySet().stream()
                .sorted(Comparator.<Map.Entry<Level, Integer>>comparingInt(e -> e.getKey().side())
                        .thenComparing(e -> e.getKey().side() == '0'
                                ? e.getKey().price().negate() : e.getKey().price()))
                .forEach(entry -> {
                    var row = group("W", 268);
                    row.setChar(269, entry.getKey().side());
                    row.setDecimal(270, entry.getKey().price());
                    row.setInt(271, entry.getValue());
                    snapshot.addGroup(row);
                });
        return snapshot;
    }

    private static void publish(Map<String, quickfix.SessionID> subscribers, Map<Level, Integer> source,
                                Book book, LabPeer client, Level level, char action, int size) throws Exception {
        if (action == '2') source.remove(level);
        else source.put(level, size);

        for (var subscription : subscribers.entrySet()) {
            send(incremental(subscription.getKey(), SYMBOL, level, action, size), subscription.getValue());
        }
        check(book.apply(client.expect("X")), "Update belongs to the active book");
    }

    static Message incremental(String id, String symbol, Level level, char action, int size) {
        Message update = message("X");
        update.setString(262, id);
        var row = group("X", 268);
        row.setChar(279, action);
        row.setChar(269, level.side());
        row.setString(55, symbol);
        row.setDecimal(270, level.price());
        if (action != '2') row.setInt(271, size);
        update.addGroup(row);
        return update;
    }

    static final class Book {
        final Map<Level, Integer> levels = new HashMap<>();
        String subscription;
        String symbol;

        void replace(Message snapshot, String expectedId) throws Exception {
            field(snapshot, 262, expectedId);
            var replacement = new HashMap<Level, Integer>();
            for (var row : snapshot.getGroups(268)) {
                replacement.put(new Level(row.getChar(269), row.getDecimal(270)), row.getInt(271));
            }
            levels.clear();
            levels.putAll(replacement);
            subscription = expectedId;
            symbol = snapshot.getString(55);
        }

        boolean apply(Message update) throws Exception {
            if (subscription == null || !subscription.equals(update.getString(262))) return false;
            for (var row : update.getGroups(268)) {
                field(row, 55, symbol);
                Level level = new Level(row.getChar(269), row.getDecimal(270));
                switch (row.getChar(279)) {
                    case '0' -> check(levels.putIfAbsent(level, row.getInt(271)) == null, "Duplicate level");
                    case '1' -> check(levels.replace(level, row.getInt(271)) != null, "Unknown changed level");
                    case '2' -> check(levels.remove(level) != null, "Unknown deleted level");
                    default -> throw new IllegalStateException("Unsupported market-data action");
                }
            }
            return true;
        }

        void checkBestOffer(String expected) {
            check(subscription != null, "A stale book has no usable quote");
            BigDecimal bestOffer = levels.keySet().stream().filter(level -> level.side() == '1')
                    .map(Level::price).min(BigDecimal::compareTo).orElseThrow();
            check(bestOffer.compareTo(new BigDecimal(expected)) == 0,
                    "Expected best offer " + expected + " but got " + bestOffer.toPlainString());
        }

        void invalidate() {
            subscription = null;
            levels.clear();
        }
    }

    private static void quotes(LabPeer dealer, LabPeer client) throws Exception {
        LocalDateTime now = LocalDateTime.now(ZoneOffset.UTC).withNano(0);
        Map<String, LocalDateTime> live = new HashMap<>();
        quote(dealer, client, live, "R1", "Q1", now.plusSeconds(20));
        accept(dealer, client, live, "Q1", now, true);

        quote(dealer, client, live, "R2", "Q2", now);
        accept(dealer, client, live, "Q2", now.plusSeconds(1), false);

        quote(dealer, client, live, "R3", "Q3", now.plusSeconds(20));
        Message cancel = message("Z");
        cancel.setString(131, "R3");
        cancel.setString(117, "Q3");
        cancel.setInt(298, 1);
        var instrument = group("Z", 295);
        instrument.setString(55, BOND);
        cancel.addGroup(instrument);
        var rfqSession = dealer.sessions().stream().filter(id -> RFQ.equals(id.getTargetCompID()))
                .findFirst().orElseThrow();
        live.remove("Q3");
        send(cancel, rfqSession);
        acknowledgeWithdrawal(dealer, client, "Q3", 1, 1);
        accept(dealer, client, live, "Q3", now, false);

        quote(dealer, client, live, "R4", "Q4", now.plusSeconds(20));
        quote(dealer, client, live, "R5", "Q5", now.plusSeconds(20));
        // One RFQ relationship in this fixture. Other sessions would keep their own quotes.
        check(live.size() == 2, "Both unswept quotes must be live before the cancel-all");
        Message cancelAll = message("Z");
        cancelAll.setString(117, "SESSION-CLOSE"); // Agreed scope identifier in this fixture.
        cancelAll.setInt(298, 4);
        live.clear();
        send(cancelAll, rfqSession);
        acknowledgeWithdrawal(dealer, client, "SESSION-CLOSE", 4, 0);
        accept(dealer, client, live, "Q4", now, false);
        accept(dealer, client, live, "Q5", now, false);
        System.out.println("PASS RFQ: firm price, expiry, scoped withdrawal and cancel-all verified.");
    }

    private static void acknowledgeWithdrawal(LabPeer dealer, LabPeer client, String id,
                                               int scope, int instruments) throws Exception {
        Message cancellation = client.expect("Z");
        field(cancellation, 117, id);
        field(cancellation, 298, Integer.toString(scope));
        check(cancellation.getGroupCount(295) == instruments, "Unexpected instrument scope");
        Message status = message("AI");
        if (cancellation.isSetField(131)) status.setString(131, cancellation.getString(131));
        status.setString(117, cancellation.getString(117));
        status.setString(55, BOND);
        status.setInt(297, scope);
        client.send(status);
        Message received = dealer.expect("AI");
        field(received, 117, id);
        field(received, 297, Integer.toString(scope));
    }

    private static void quote(LabPeer dealer, LabPeer client, Map<String, LocalDateTime> live,
                              String requestId, String quoteId, LocalDateTime expiry) throws Exception {
        Message request = message("R");
        request.setString(131, requestId);
        var instrument = group("R", 146);
        instrument.setString(55, BOND);
        instrument.setChar(54, '1');
        instrument.setInt(38, 10);
        instrument.setInt(537, 1);
        request.addGroup(instrument);
        client.send(request);
        var received = dealer.receive("R");
        field(received.message().getGroup(1, group("R", 146)), 38, "10");
        Message quote = message("S");
        quote.setString(131, received.message().getString(131));
        quote.setString(117, quoteId);
        quote.setString(55, BOND);
        quote.setInt(537, 1);
        quote.setString(132, "99.25");
        quote.setString(133, OFFER);
        quote.setInt(134, 10);
        quote.setInt(135, 10);
        quote.setUtcTimeStamp(62, expiry);
        live.put(quoteId, expiry);
        send(quote, received.session());
        Message receivedQuote = client.expect("S");
        field(receivedQuote, 131, requestId);
        field(receivedQuote, 117, quoteId);
    }

    private static void accept(LabPeer dealer, LabPeer client, Map<String, LocalDateTime> live,
                               String quoteId, LocalDateTime now, boolean expected) throws Exception {
        Message take = order("TAKE-" + quoteId, BOND, '1', 10, OFFER);
        take.setChar(40, 'D'); // Previously quoted, by this counterparty's agreement.
        take.setString(117, quoteId);
        client.send(take);
        var incoming = dealer.receive("D");
        Message order = incoming.message();
        String incomingQuote = order.getString(117);
        LocalDateTime expiry = live.get(incomingQuote);
        boolean eligible = expiry != null && now.isBefore(expiry)
                && order.getInt(38) == 10 && order.getChar(54) == '1'
                && BOND.equals(order.getString(55)) && new BigDecimal(OFFER).compareTo(order.getDecimal(44)) == 0;
        if (eligible || (expiry != null && !now.isBefore(expiry))) {
            live.remove(incomingQuote);
        }
        Message report = message("8");
        report.setString(37, "VENUE-" + quoteId);
        report.setString(17, "EVENT-" + quoteId);
        report.setString(11, order.getString(11));
        report.setString(55, BOND);
        report.setChar(54, '1');
        report.setChar(150, eligible ? 'F' : '8');
        report.setChar(39, eligible ? '2' : '8');
        report.setInt(151, 0);
        report.setInt(14, eligible ? 10 : 0);
        report.setString(6, eligible ? OFFER : "0");
        if (eligible) {
            report.setInt(32, 10);
            report.setString(31, OFFER);
        } else {
            report.setString(58, "Quote unavailable");
        }
        send(report, incoming.session());
        field(client.expect("8"), 39, expected ? "2" : "8");
    }
}
