package learning.fix;

import learning.fix.MarketAndQuoteLab.Book;
import learning.fix.MarketAndQuoteLab.Level;
import quickfix.Message;
import quickfix.SessionID;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static learning.fix.LabPeer.*;
import static learning.fix.MarketAndQuoteLab.incremental;
import static learning.fix.MarketAndQuoteLab.snapshot;
import static learning.fix.MarketAndQuoteLab.subscription;

/** Two order-entry sessions and a market-data session at a price-time-priority venue. */
public final class OrderLifecycleLab {
    private static final String SELLER = "SELLER";
    private static final String MARKET_DATA = "CLIENT-MD";

    public static void main(String[] args) throws Exception {
        var directory = Files.createTempDirectory("fix-orders-");
        int port = loopbackPort();
        try (var venue = new LabPeer(settings(directory.resolve("venue"), port, true, FIX44,
                List.of(CLIENT, SELLER, MARKET_DATA), ""), true, true, true, true, null);
             var buyer = new LabPeer(settings(directory.resolve("buyer"), port, false, FIX44,
                List.of(CLIENT), ""), false, true, true, true, null);
             var seller = new LabPeer(settings(directory.resolve("seller"), port, false, FIX44,
                List.of(SELLER), ""), false, true, true, true, null);
             var market = new LabPeer(settings(directory.resolve("market"), port, false, FIX44,
                List.of(MARKET_DATA), ""), false, true, true, true, null)) {
            venue.start();
            buyer.start();
            seller.start();
            market.start();
            buyer.awaitLogon();
            seller.awaitLogon();
            market.awaitLogon();
            var book = new Venue(venue);
            marketDepth(book, buyer, seller, market);

            step(seller, book, order("S1", SYMBOL, '2', 20, "24.90"));
            report(seller, '0', '0', 0, 20);
            step(seller, book, order("S2", SYMBOL, '2', 20, "24.90"));
            report(seller, '0', '0', 0, 20);
            step(seller, book, order("S3", SYMBOL, '2', 60, "25.10"));
            report(seller, '0', '0', 0, 60);
            step(buyer, book, order("C42", SYMBOL, '1', 100, "25.00"));
            report(buyer, '0', '0', 0, 100);
            report(buyer, 'F', '1', 20, 80);
            report(buyer, 'F', '1', 40, 60);
            field(report(seller, 'F', '2', 20, 0), 11, "S1");
            field(report(seller, 'F', '2', 20, 0), 11, "S2");

            step(buyer, book, replaceRequest("C42-R1", "C42", 80));
            report(buyer, 'E', 'E', 40, 60);
            report(buyer, '5', '1', 40, 40);
            step(buyer, book, replaceRequest("C42-BAD", "C42-R1", 30));
            field(buyer.expect("9"), 434, "2");
            step(buyer, book, replaceRequest("UNKNOWN-R1", "UNKNOWN", 80));
            Message unknown = buyer.expect("9");
            field(unknown, 434, "2");
            field(unknown, 102, "1");
            step(buyer, book, order("C42-R1", SYMBOL, '1', 10, "25.00"));
            field(report(buyer, '8', '8', 0, 0), 103, "6");
            checkStatus(buyer, book, "C42-R1", "STATUS-1", '1', '1', 40, 40);

            Message unsupported = message("g");
            unsupported.setString(335, "TRADING-STATUS-1");
            unsupported.setChar(263, '0');
            step(buyer, book, unsupported);
            Message businessReject = buyer.expect("j");
            field(businessReject, 372, "g");
            field(businessReject, 379, "TRADING-STATUS-1");
            field(businessReject, 380, "3");

            step(buyer, book, cancelRequest("C42-C1", "C42-R1", SYMBOL, '1', 80));
            report(buyer, '6', '6', 40, 40);
            step(seller, book, order("S4", SYMBOL, '2', 40, "25.00"));
            report(seller, '0', '0', 0, 40);
            report(seller, 'F', '2', 40, 0);
            field(report(buyer, 'F', '6', 80, 0), 6, "24.95");
            book.finishCancel();
            Message tooLate = buyer.expect("9");
            field(tooLate, 102, "0");
            field(tooLate, 39, "2");

            step(buyer, book, order("C43", SYMBOL, '1', 50, "24.90"));
            report(buyer, '0', '0', 0, 50);
            step(buyer, book, cancelRequest("C43-C1", "C43", SYMBOL, '1', 50));
            report(buyer, '6', '6', 0, 50);
            book.finishCancel();
            report(buyer, '4', '4', 0, 0);
            step(buyer, book, order("C44", SYMBOL, '1', 1000, "25.00"));
            field(report(buyer, '8', '8', 0, 0), 58, "Order size");
            step(buyer, book, order("C44-VALUE", SYMBOL, '1', 500, "25.00"));
            field(report(buyer, '8', '8', 0, 0), 58, "Order value");
            step(buyer, book, order("C44-PRICE", SYMBOL, '1', 10, "29.00"));
            field(report(buyer, '8', '8', 0, 0), 58, "Price collar");
            step(buyer, book, order("C45", SYMBOL, '1', 10, "23.00"));
            report(buyer, '0', '0', 0, 10);
            step(buyer, book, order("C45B", SYMBOL, '1', 20, "23.00"));
            report(buyer, '0', '0', 0, 20);

            SessionID buyingSession = venue.sessions().stream()
                    .filter(id -> CLIENT.equals(id.getTargetCompID())).findFirst().orElseThrow();
            book.blocked.add(buyingSession);
            Message massCancel = message("q");
            massCancel.setString(11, "KILL-1");
            massCancel.setInt(530, 1); // This profile scopes the request to one security and customer.
            massCancel.setString(55, SYMBOL);
            time(massCancel, 60);
            step(buyer, book, massCancel);
            Message scope = buyer.expect("r");
            field(scope, 530, "1");
            field(scope, 531, "1");
            field(scope, 533, "2");
            field(scope.getGroup(1, group("r", 534)), 41, "C45");
            field(scope.getGroup(2, group("r", 534)), 41, "C45B");
            field(report(buyer, '4', '4', 0, 0), 11, "C45");
            field(report(buyer, '4', '4', 0, 0), 11, "C45B");
            checkStatus(buyer, book, "C45", "STATUS-2", '1', '4', 0, 0);
            checkStatus(buyer, book, "C45B", "STATUS-3", '1', '4', 0, 0);
            checkStatus(buyer, book, "C42-R1", "STATUS-4", '1', '2', 80, 0);
            checkStatus(seller, book, "S3", "STATUS-1", '2', '0', 0, 60);
            step(buyer, book, order("C46", SYMBOL, '1', 10, "25.00"));
            field(report(buyer, '8', '8', 0, 0), 58, "Session blocked");

            var exposure = new PositionKey(buyingSession, SYMBOL);
            List<Fill> acmeFills = book.copy.stream().filter(fill -> SYMBOL.equals(fill.instrument())).toList();
            check(book.position.get(exposure) == 80 && acmeFills.size() == 6,
                    "Drop-copy projection must preserve both sides of three trades");
            int before = book.position.get(exposure);
            book.applyCopy(acmeFills.stream().filter(fill -> fill.owner().equals(buyingSession))
                    .findFirst().orElseThrow());
            check(book.position.get(exposure) == before, "Duplicate must have no business effect");
            System.out.println("PASS orders: two clients; 80 filled at 24.95; status, cancel race, "
                    + "order/change/business rejects, risk, scoped mass cancel and drop-copy dedup verified.");
            System.out.println("Wire logs: " + directory);
        }
    }

    private static void marketDepth(Venue venue, LabPeer buyer, LabPeer seller, LabPeer market) throws Exception {
        step(seller, venue, order("MD-S1", "BETA", '2', 60, "25.10"));
        report(seller, '0', '0', 0, 60);
        step(seller, venue, order("MD-S2", "GAMMA", '2', 3, "25.10"));
        report(seller, '0', '0', 0, 3);
        var beta = new Depth(venue, market, "BETA", "DEPTH-BETA", 60);
        var gamma = new Depth(venue, market, "GAMMA", "DEPTH-GAMMA", 3);

        step(seller, venue, order("MD-S3", "BETA", '2', 20, "25.100"));
        report(seller, '0', '0', 0, 20);
        beta.update('1', "25.10", 80);
        step(seller, venue, order("MD-S4", "BETA", '2', 5, "25.20"));
        report(seller, '0', '0', 0, 5);
        beta.update('0', "25.20", 5);
        step(buyer, venue, order("MD-B1", "BETA", '1', 50, "25.10"));
        report(buyer, '0', '0', 0, 50);
        report(buyer, 'F', '2', 50, 0);
        field(report(seller, 'F', '1', 50, 10), 11, "MD-S1");
        beta.update('1', "25.10", 30);

        step(seller, venue, cancelRequest("MD-C1", "MD-S1", "BETA", '2', 60));
        report(seller, '6', '6', 50, 10);
        venue.finishCancel();
        report(seller, '4', '4', 50, 0);
        beta.update('1', "25.10", 20);
        step(seller, venue, cancelRequest("MD-C2", "MD-S3", "BETA", '2', 20));
        report(seller, '6', '6', 0, 20);
        venue.finishCancel();
        report(seller, '4', '4', 0, 0);
        beta.update('2', "25.10", 0);
        beta.view.checkBestOffer("25.20");

        step(seller, venue, order("MD-S5", "GAMMA", '2', 4, "25.10"));
        report(seller, '0', '0', 0, 4);
        gamma.update('1', "25.10", 7);
        System.out.println("PASS matching-to-feed: isolated BETA and GAMMA snapshots and updates; "
                + "order entry, a fill and cancels drove the advertised depth.");
    }

    // The scenario refreshes the publisher at defined event boundaries, then checks the received view.
    private static final class Depth {
        final Venue venue;
        final LabPeer subscriber;
        final String symbol;
        final String id;
        final SessionID session;
        final Book view = new Book();
        Map<Level, Integer> published;

        Depth(Venue venue, LabPeer subscriber, String symbol, String id, int expectedSize) throws Exception {
            this.venue = venue;
            this.subscriber = subscriber;
            subscriber.send(subscription(id, '1', symbol));
            var request = venue.peer.receive("V");
            session = request.session();
            this.id = request.message().getString(262);
            this.symbol = request.message().getGroup(1, group("V", 146)).getString(55);
            published = venue.depth(this.symbol);
            send(snapshot(this.id, this.symbol, published), session);
            Message initial = subscriber.expect("W");
            field(initial, 55, symbol);
            view.replace(initial, id);
            check(view.levels.equals(Map.of(new Level('1', new BigDecimal("25.10")), expectedSize)),
                    "Snapshot must show the resting sell quantity");
        }

        void update(char action, String price, int quantity) throws Exception {
            Map<Level, Integer> current = venue.depth(symbol);
            var levels = new LinkedHashSet<>(published.keySet());
            levels.addAll(current.keySet());
            int changes = 0;
            for (Level level : levels) {
                int before = published.getOrDefault(level, 0);
                int after = current.getOrDefault(level, 0);
                if (before == after) continue;
                char updateType = before == 0 ? '0' : after == 0 ? '2' : '1';
                send(incremental(id, symbol, level, updateType, after), session);
                changes++;
            }
            published = current;
            check(changes == 1, "Expected exactly one changed price level on " + symbol);
            Message update = subscriber.expect("X");
            var entry = update.getGroup(1, group("X", 268));
            field(entry, 279, String.valueOf(action));
            check(entry.getDecimal(270).compareTo(new BigDecimal(price)) == 0, "Price level mismatch");
            if (action != '2') field(entry, 271, String.valueOf(quantity));
            check(view.apply(update) && view.levels.equals(published), "Subscriber depth diverged");
        }
    }

    private static void step(LabPeer client, Venue venue, Message request) throws Exception {
        client.send(request);
        venue.handle(venue.peer.receive(type(request)));
    }

    private static Message replaceRequest(String id, String previous, int qty) {
        Message request = message("G");
        orderFields(request, id, SYMBOL, '1', qty);
        request.setString(41, previous);
        request.setChar(40, '2');
        request.setString(44, "25.00");
        return request;
    }

    private static Message cancelRequest(String id, String previous, String symbol, char side, int qty) {
        Message request = message("F");
        orderFields(request, id, symbol, side, qty);
        request.setString(41, previous);
        return request;
    }

    private static void checkStatus(LabPeer client, Venue venue, String id, String statusId,
                                    char side, char status, int cum, int leaves) throws Exception {
        Message request = message("H");
        request.setString(11, id);
        request.setString(55, SYMBOL);
        request.setChar(54, side);
        request.setString(790, statusId);
        step(client, venue, request);
        Message response = report(client, 'I', status, cum, leaves);
        field(response, 11, id);
        field(response, 17, "0");
        field(response, 790, statusId);
    }

    private static Message report(LabPeer client, char type, char status, int cum, int leaves) throws Exception {
        Message report = client.expect("8");
        field(report, 150, String.valueOf(type));
        field(report, 39, String.valueOf(status));
        field(report, 14, String.valueOf(cum));
        field(report, 151, String.valueOf(leaves));
        return report;
    }

    private record Key(SessionID owner, String id) {}
    private record PositionKey(SessionID owner, String instrument) {}
    private record Fill(String execId, SessionID owner, String instrument, int signedQuantity) {}

    private static final class Order {
        final SessionID owner;
        final String venueId;
        final String symbol;
        final char side;
        String id;
        int total;
        int filled;
        BigDecimal price;
        BigDecimal notional = BigDecimal.ZERO;
        long priority;
        boolean closed;
        String pendingCancel;

        Order(SessionID owner, Message message, String venueId, long priority) throws Exception {
            this.owner = owner;
            this.venueId = venueId;
            this.priority = priority;
            id = message.getString(11);
            symbol = message.getString(55);
            side = message.getChar(54);
            total = message.getInt(38);
            price = message.getDecimal(44);
        }

        int leaves() {
            return closed ? 0 : total - filled;
        }

        char status() {
            if (pendingCancel != null) return '6';
            if (filled == total && total > 0) return '2';
            if (closed) return '4';
            return filled > 0 ? '1' : '0';
        }
    }

    private static final class Venue {
        final LabPeer peer;
        final Map<String, List<Order>> bySymbol = new LinkedHashMap<>();
        final Map<Key, Order> byRequest = new LinkedHashMap<>();
        final Set<Key> requestIds = new LinkedHashSet<>();
        final Set<SessionID> blocked = new LinkedHashSet<>();
        final Map<PositionKey, Integer> position = new LinkedHashMap<>();
        final List<Fill> copy = new ArrayList<>();
        final Set<String> appliedExecutions = new LinkedHashSet<>();
        private long nextOrder;
        private long nextEvent;
        private Order cancelInProgress;

        Venue(LabPeer peer) {
            this.peer = peer;
        }

        Map<Level, Integer> depth(String symbol) {
            var levels = new LinkedHashMap<Level, Integer>();
            for (Order order : bySymbol.getOrDefault(symbol, List.of())) {
                if (order.leaves() > 0) {
                    char side = order.side == '1' ? '0' : '1';
                    levels.merge(new Level(side, order.price), order.leaves(), Integer::sum);
                }
            }
            return levels;
        }

        void handle(LabPeer.Arrival arrival) throws Exception {
            Message msg = arrival.message();
            SessionID owner = arrival.session();
            switch (type(msg)) {
                case "D" -> enter(owner, msg);
                case "G" -> replace(owner, msg);
                case "F" -> cancel(owner, msg);
                case "H" -> inquire(owner, msg);
                case "q" -> massCancel(owner, msg);
                default -> rejectUnsupported(owner, msg);
            }
        }

        void enter(SessionID owner, Message request) throws Exception {
            var order = new Order(owner, request, "V" + ++nextOrder, nextOrder);
            var key = new Key(owner, order.id);
            boolean duplicate = !requestIds.add(key);
            String failure = duplicate ? "Duplicate ClOrdID" : risk(order, order.total, order.total, order.price);
            if (failure != null) {
                order.closed = true;
                Message reject = execution(order, '8', '8', order.id, null);
                if (duplicate) reject.setString(37, "NONE");
                reject.setInt(103, duplicate ? 6 : 99);
                reject.setString(58, failure);
                send(reject, owner);
                return;
            }
            byRequest.put(key, order);
            send(execution(order, '0', '0', order.id, null), owner);
            match(order);
            bySymbol.computeIfAbsent(order.symbol, ignored -> new ArrayList<>()).add(order);
        }

        String risk(Order order, int total, int leaves, BigDecimal price) {
            if (blocked.contains(order.owner)) return "Session blocked";
            if (order.side != '1' && order.side != '2') return "Unsupported side";
            if (total <= 0 || total > 500) return "Order size";
            if (price.signum() <= 0 || price.multiply(BigDecimal.valueOf(leaves))
                    .compareTo(new BigDecimal("10000")) > 0) return "Order value";
            if (price.subtract(new BigDecimal("25.00")).abs()
                    .compareTo(new BigDecimal("2.00")) > 0) return "Price collar";
            int sign = order.side == '1' ? 1 : -1;
            int positionNow = position.getOrDefault(new PositionKey(order.owner, order.symbol), 0);
            int workingSameSide = byRequest.values().stream().distinct()
                    .filter(existing -> existing != order && existing.owner.equals(order.owner)
                            && existing.side == order.side && existing.symbol.equals(order.symbol))
                    .mapToInt(Order::leaves).sum();
            if (Math.abs(positionNow + sign * (workingSameSide + leaves)) > 1000) {
                return "Position including same-side working orders";
            }
            return null;
        }

        void match(Order incoming) throws Exception {
            Comparator<Order> priceOrder = Comparator.comparing(order -> order.price);
            if (incoming.side == '2') priceOrder = priceOrder.reversed();
            List<Order> opponents = bySymbol.getOrDefault(incoming.symbol, List.of()).stream()
                    .filter(other -> other != incoming && other.side != incoming.side && other.leaves() > 0)
                    .filter(other -> incoming.side == '1'
                            ? incoming.price.compareTo(other.price) >= 0
                            : incoming.price.compareTo(other.price) <= 0)
                    .sorted(priceOrder.thenComparingLong(other -> other.priority)).toList();
            for (Order resting : opponents) {
                if (incoming.leaves() == 0) break;
                int quantity = Math.min(incoming.leaves(), resting.leaves());
                trade(resting, quantity, resting.price);
                trade(incoming, quantity, resting.price);
            }
        }

        void trade(Order order, int amount, BigDecimal price) throws Exception {
            order.filled += amount;
            order.notional = order.notional.add(price.multiply(BigDecimal.valueOf(amount)));
            long reportStarted = System.nanoTime();
            Message report = execution(order, 'F', order.status(), order.id, null);
            report.setInt(32, amount);
            report.setDecimal(31, price);
            send(report, order.owner);
            Fill fill = new Fill(report.getString(17), order.owner, order.symbol,
                    order.side == '1' ? amount : -amount);
            copy.add(fill);
            applyCopy(fill);
            System.out.printf("Drop copy %s on %s applied in %d µs from report creation%n",
                    fill.execId(), fill.owner(), (System.nanoTime() - reportStarted) / 1_000);
        }

        void applyCopy(Fill fill) {
            if (appliedExecutions.add(fill.execId())) {
                position.merge(new PositionKey(fill.owner(), fill.instrument()), fill.signedQuantity(), Integer::sum);
            }
        }

        void replace(SessionID owner, Message request) throws Exception {
            String previous = request.getString(41);
            String id = request.getString(11);
            Order order = byRequest.get(new Key(owner, previous));
            int total = request.getInt(38);
            BigDecimal price = request.getDecimal(44);
            var key = new Key(owner, id);
            if (!requestIds.add(key)) {
                rejectChange(owner, order, request, '2', 6);
                return;
            }
            if (order == null || !order.id.equals(previous) || order.leaves() == 0
                    || !sameInstrumentAndSide(order, request) || total <= order.filled
                    || risk(order, total, total - order.filled, price) != null) {
                rejectChange(owner, order, request, '2', order == null ? 1 : 2);
                return;
            }
            send(execution(order, 'E', 'E', id, previous), owner);
            if (price.compareTo(order.price) != 0 || total > order.total) order.priority = ++nextOrder;
            order.id = id;
            order.total = total;
            order.price = price;
            byRequest.put(key, order);
            send(execution(order, '5', order.status(), id, previous), owner);
            match(order);
        }

        void cancel(SessionID owner, Message request) throws Exception {
            String previous = request.getString(41);
            Order order = byRequest.get(new Key(owner, previous));
            String id = request.getString(11);
            if (!requestIds.add(new Key(owner, id))) {
                rejectChange(owner, order, request, '1', 6);
                return;
            }
            if (order == null || !order.id.equals(previous) || !sameInstrumentAndSide(order, request)) {
                rejectChange(owner, order, request, '1', 1);
                return;
            }
            if (order.leaves() == 0) {
                rejectChange(owner, order, request, '1', 0);
                return;
            }
            check(cancelInProgress == null, "This scenario drives one cancel at a time");
            order.pendingCancel = id;
            cancelInProgress = order;
            send(execution(order, '6', '6', order.pendingCancel, order.id), owner);
        }

        void finishCancel() throws Exception {
            Order order = cancelInProgress;
            check(order != null, "Expected pending cancel");
            cancelInProgress = null;
            String cancelId = order.pendingCancel;
            order.pendingCancel = null;
            if (order.leaves() == 0) {
                rejectChange(order.owner, order,
                        cancelRequest(cancelId, order.id, order.symbol, order.side, order.total), '1', 0);
                return;
            }
            order.closed = true;
            send(execution(order, '4', '4', cancelId, order.id), order.owner);
        }

        void inquire(SessionID owner, Message request) throws Exception {
            Order order = byRequest.get(new Key(owner, request.getString(11)));
            check(order != null, "Scenario must query a known order");
            Message report = execution(order, 'I', order.status(), order.id, null);
            report.setString(790, request.getString(790));
            send(report, owner);
        }

        void massCancel(SessionID owner, Message request) throws Exception {
            int scope = request.getInt(530);
            String symbol = request.getString(55);
            check(scope == 1, "Scenario supports cancel by security");
            var canceled = bySymbol.getOrDefault(symbol, List.of()).stream()
                    .filter(order -> order.owner.equals(owner) && order.leaves() > 0).toList();
            Message report = message("r");
            report.setString(11, request.getString(11));
            report.setString(37, "M" + ++nextEvent);
            report.setInt(530, scope);
            report.setInt(531, scope);
            report.setInt(533, canceled.size());
            report.setString(55, symbol);
            for (Order order : canceled) {
                var affected = group("r", 534);
                affected.setString(41, order.id);
                affected.setString(535, order.venueId);
                report.addGroup(affected);
            }
            send(report, owner);
            for (Order order : canceled) {
                order.closed = true;
                send(execution(order, '4', '4', order.id, null), order.owner);
            }
        }

        void rejectChange(SessionID session, Order order, Message request, char responseTo, int reason)
                throws Exception {
            Message reject = message("9");
            reject.setString(37, order == null ? "NONE" : order.venueId);
            reject.setString(11, request.getString(11));
            reject.setString(41, request.getString(41));
            reject.setChar(39, order == null ? '8' : order.status());
            reject.setChar(434, responseTo);
            reject.setInt(102, reason);
            send(reject, session);
        }

        void rejectUnsupported(SessionID session, Message request) throws Exception {
            Message reject = message("j");
            String msgType = type(request);
            reject.setString(372, msgType);
            reject.setInt(45, request.getHeader().getInt(34));
            if (msgType.equals("g")) reject.setString(379, request.getString(335));
            reject.setInt(380, 3);
            reject.setString(58, "Unsupported message type");
            send(reject, session);
        }

        boolean sameInstrumentAndSide(Order order, Message request) throws Exception {
            return order.symbol.equals(request.getString(55)) && order.side == request.getChar(54);
        }

        Message execution(Order order, char type, char status, String id, String previous) {
            Message exec = message("8");
            exec.setString(37, order.venueId);
            exec.setString(17, type == 'I' ? "0" : "E" + ++nextEvent);
            exec.setString(11, id);
            if (previous != null) exec.setString(41, previous);
            exec.setString(55, order.symbol);
            exec.setChar(54, order.side);
            exec.setChar(150, type);
            exec.setChar(39, status);
            exec.setInt(38, order.total);
            exec.setInt(14, order.filled);
            exec.setInt(151, order.leaves());
            exec.setString(6, order.filled == 0 ? "0" : order.notional
                    .divide(BigDecimal.valueOf(order.filled), 2, RoundingMode.HALF_UP).toPlainString());
            return exec;
        }
    }
}
