package learning.fix;

import quickfix.Message;

import java.math.BigDecimal;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static learning.fix.LabPeer.*;

/** Deterministic router and algo timing exercise with mock venue quotes. */
public final class RoutingLab {
    record Quote(String venue, BigDecimal price, BigDecimal fee, int available, Instant received) {}
    record Child(String id, String venue, int quantity, BigDecimal limit) {}
    record Slice(Instant releaseAt, Message order) {}

    public static void main(String[] args) throws Exception {
        Instant now = Instant.parse("2026-11-24T14:30:00Z");
        var policy = new Parent("C42", '1', 100, new BigDecimal("25.05"));
        List<Quote> quotes = List.of(
                quote("A", "24.99", "0.04", 70, now),
                quote("B", "25.00", "0.01", 60, now),
                quote("STALE", "24.95", "0.00", 100, now.minusSeconds(2)));
        List<Child> first = policy.route(quotes, now);
        check(first.size() == 2 && first.get(0).venue().equals("B") && first.get(0).quantity() == 60
                && first.get(1).venue().equals("A") && first.get(1).quantity() == 40, "Wrong split");
        policy.fill(first.get(0).id(), "B-E1", 40);
        policy.fill(first.get(0).id(), "B-E1", 40); // wire replay with the same scoped execution ID
        check(policy.filled == 40 && policy.route(quotes, now).isEmpty(),
                "Working children still reserve all remaining quantity");
        policy.close(first.get(0).id()); // acknowledged cancel for the remaining 20, or terminal report
        List<Child> reroute = policy.route(List.of(quote("B", "24.98", "0.01", 20, now)), now);
        check(reroute.size() == 1 && reroute.get(0).quantity() == 20, "Reroute only confirmed leaves");
        policy.fill(first.get(1).id(), "A-E1", 40);
        policy.fill(reroute.get(0).id(), "B-E2", 20);
        check(policy.filled == 100, "C42 parent must not overfill");
        var sell = new Parent("S42", '2', 30, new BigDecimal("24.90"));
        List<Child> sale = sell.route(List.of(quote("A", "25.04", "0.04", 30, now),
                quote("B", "25.02", "0.01", 30, now)), now);
        check(sale.size() == 1 && sale.get(0).venue().equals("B"), "Sell must prefer higher net bid");

        Message request = order("ALGO-1", SYMBOL, '1', 100, "25.05");
        request.setString(9001, "DEMO_TWAP_V1");
        request.setInt(9002, 4);
        List<Slice> schedule = slices(request, now, now.plusSeconds(60));
        check(schedule.get(3).releaseAt().equals(now.plusSeconds(45)), "Expected 0/15/30/45-second offsets");
        check(schedule.stream().map(Slice::order).mapToInt(RoutingLab::quantity).sum() == 100,
                "Child quantities must add up to the parent");
        System.out.println("PASS routing: B 60 + A 40, then reroute only acknowledged unfilled 20.");
        System.out.println("PASS algo: planned four FIX child messages for 25 shares at 0/15/30/45 seconds.");
        assetProfiles();
    }

    private static Quote quote(String venue, String price, String fee, int size, Instant received) {
        return new Quote(venue, new BigDecimal(price), new BigDecimal(fee), size, received);
    }

    private static int quantity(Message order) {
        try {
            return order.getInt(38);
        } catch (quickfix.FieldNotFound e) {
            throw new IllegalStateException("Child lacks OrderQty", e);
        }
    }

    private static final class Parent {
        final String id;
        final char side;
        final int target;
        final BigDecimal limit;
        final Map<String, Child> children = new LinkedHashMap<>();
        final Map<String, Integer> working = new LinkedHashMap<>();
        final Map<String, String> executions = new LinkedHashMap<>();
        int filled;

        Parent(String id, char side, int target, BigDecimal limit) {
            this.id = id;
            this.side = side;
            this.target = target;
            this.limit = limit;
        }

        List<Child> route(List<Quote> quotes, Instant now) {
            int available = target - filled - working.values().stream().mapToInt(Integer::intValue).sum();
            Comparator<Quote> effectivePrice = side == '1'
                    ? Comparator.comparing(quote -> quote.price().add(quote.fee()))
                    : Comparator.<Quote, BigDecimal>comparing(quote -> quote.price().subtract(quote.fee())).reversed();
            var eligible = quotes.stream().filter(quote -> quote.available() > 0
                            && (side == '1' ? quote.price().compareTo(limit) <= 0 : quote.price().compareTo(limit) >= 0)
                            && !quote.received().isAfter(now)
                            && Duration.between(quote.received(), now).compareTo(Duration.ofMillis(500)) <= 0)
                    .sorted(effectivePrice)
                    .toList();
            List<Child> newChildren = new ArrayList<>();
            for (Quote quote : eligible) {
                if (available == 0) break;
                int size = Math.min(available, quote.available());
                Child child = new Child(id + "-" + (children.size() + 1), quote.venue(), size, quote.price());
                children.put(child.id(), child);
                working.put(child.id(), size);
                newChildren.add(child);
                available -= size;
            }
            return newChildren;
        }

        void fill(String childId, String execId, int qty) {
            Child child = children.get(childId);
            check(child != null, "Unknown child");
            String key = child.venue() + "/" + execId;
            String fingerprint = childId + "/" + qty;
            String prior = executions.get(key);
            if (prior != null) {
                check(prior.equals(fingerprint), "Execution ID reused for a different trade");
                return;
            }
            int leaves = working.getOrDefault(childId, 0);
            check(qty > 0 && qty <= leaves, "Late or excess fill needs reconciliation");
            filled += qty;
            working.put(childId, leaves - qty);
            executions.put(key, fingerprint);
        }

        void close(String childId) {
            check(working.remove(childId) != null, "Unknown working child");
        }
    }

    private static void assetProfiles() throws Exception {
        Message equity = order("EQ", SYMBOL, '1', 100, "25.00");
        equity.setString(167, "CS");
        Message future = fix50("D");
        orderFields(future, "FUT", "FUT-DEMO", '1', 2);
        future.setChar(40, '2');
        future.setString(44, "5000.25");
        future.setString(167, "FUT");
        future.setString(200, "202712");
        future.setString(231, "50");
        Message fx = order("FX", "EUR/USD", '1', 10000, "1.08");
        fx.setString(167, "FOR"); // Base quantity in EUR, price in USD per EUR.
        fx.setString(15, "EUR");
        fx.setString(64, "20270104");
        check(profile(equity).equals("EQUITIES") && profile(future).equals("DERIVATIVES")
                && profile(fx).equals("FX"), "Each instrument must route with the correct profile");
        BigDecimal contractValue = future.getDecimal(38).multiply(future.getDecimal(44))
                .multiply(future.getDecimal(231));
        BigDecimal terms = fx.getDecimal(38).multiply(fx.getDecimal(44));
        check(contractValue.compareTo(new BigDecimal("500025")) == 0
                && terms.compareTo(new BigDecimal("10800")) == 0, "Unit calculations must follow each profile");
        System.out.println("PASS multi-asset profiles: equity shares, futures contracts and FX base/terms.");
    }

    private static String profile(Message order) throws Exception {
        return switch (order.getString(167)) {
            case "CS", "PS" -> "EQUITIES";
            case "FUT", "OPT" -> "DERIVATIVES";
            case "CORP", "GOVT" -> "FIXED-INCOME";
            case "FOR" -> "FX";
            default -> throw new IllegalArgumentException("Unsupported instrument type for demo");
        };
    }

    private static List<Slice> slices(Message request, Instant start, Instant end) throws Exception {
        field(request, 9001, "DEMO_TWAP_V1");
        int count = request.getInt(9002);
        int quantity = request.getInt(38);
        Duration horizon = Duration.between(start, end);
        check(count > 0 && count <= quantity && !horizon.isNegative() && !horizon.isZero(),
                "Invalid slice count or window");
        int base = quantity / count;
        int extra = quantity % count;
        List<Slice> schedule = new ArrayList<>();
        for (int i = 0; i < count; i++) {
            Message child = order(request.getString(11) + "-" + (i + 1), request.getString(55),
                    request.getChar(54), base + (i < extra ? 1 : 0), request.getString(44));
            schedule.add(new Slice(start.plus(horizon.dividedBy(count).multipliedBy(i)), child));
        }
        return schedule;
    }
}
