package learning.fix;

import quickfix.Message;
import quickfix.FieldMap;

import java.math.BigDecimal;
import java.nio.file.Files;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static learning.fix.LabPeer.*;

/** Trade capture, block allocation, affirmation and positions on a dedicated FIX session. */
public final class PostTradeLab {
    private static final String DESK = "CLIENT-POST";
    private static final String ALLOCATION = "A42";
    private static final String PRICE = "24.96";
    private static final BigDecimal UNIT_PRICE = new BigDecimal(PRICE);
    private static final BigDecimal FEE_PER_SHARE = new BigDecimal("0.01");
    private static final String DAY = LocalDate.now(ZoneOffset.UTC).format(DateTimeFormatter.BASIC_ISO_DATE);

    record Allocation(String account, int shares, String id) {}
    enum Stage { ALLOCATED, REJECTED, AFFIRMED }
    private static final List<Allocation> SPLIT = List.of(new Allocation("FUND-A", 70, "A42-A"),
            new Allocation("FUND-B", 30, "A42-B"));

    public static void main(String[] args) throws Exception {
        var directory = Files.createTempDirectory("fix-post-trade-");
        int port = loopbackPort();
        try (var broker = new LabPeer(settings(directory.resolve("broker"), port, true, FIX44,
                List.of(DESK), ""), true, true, true, true, null);
             var manager = new LabPeer(settings(directory.resolve("manager"), port, false, FIX44,
                List.of(DESK), ""), false, true, true, true, null)) {
            broker.start();
            manager.start();
            manager.awaitLogon();
            broker.awaitLogon();
            captureTrades(broker, manager);

            manager.send(instruction(List.of(SPLIT.get(0), new Allocation("FUND-B", 20, "A42-B")), "BAD"));
            Message invalid = broker.expect("J");
            check(allocationTotal(invalid) != invalid.getInt(53), "Expected invalid account split");
            broker.send(allocationAck(invalid, false));
            Message rejection = manager.expect("P");
            field(rejection, 87, "1");
            field(rejection, 88, "8");

            manager.send(instruction(SPLIT, ALLOCATION));
            Message instruction = broker.expect("J");
            check(allocationTotal(instruction) == instruction.getInt(53), "Account splits must sum to block");
            broker.send(allocationAck(instruction, true));
            field(manager.expect("P"), 70, ALLOCATION);
            broker.send(allocationReport());
            Message report = manager.expect("AS");
            field(report, 70, ALLOCATION);
            check(allocationTotal(report) == 100, "Allocation report must match the block");
            field(report.getGroup(1, group("AS", 78)), 154, "1747.90");
            field(report.getGroup(2, group("AS", 78)), 154, "749.10");
            Message receipt = message("AT");
            receipt.setString(755, report.getString(755));
            receipt.setString(70, ALLOCATION);
            receipt.setInt(87, 0);
            time(receipt, 60);
            manager.send(receipt);
            field(broker.expect("AT"), 755, "AR42");

            var stages = new LinkedHashMap<String, Stage>();
            var positions = new LinkedHashMap<String, Integer>();
            for (Allocation allocation : SPLIT) stages.put(allocation.id(), Stage.ALLOCATED);
            confirm(broker, manager, SPLIT.get(0), "C-A-1", null, "FUND-A", stages, positions);
            confirm(broker, manager, SPLIT.get(1), "C-B-1", null, "OLD-B", stages, positions);
            check(stages.get("A42-B") == Stage.REJECTED && positions.size() == 1,
                    "Rejected confirmation leaves account B unresolved");
            confirm(broker, manager, SPLIT.get(1), "C-B-2", "C-B-1", "FUND-B", stages, positions);
            check(stages.values().stream().allMatch(stage -> stage == Stage.AFFIRMED),
                    "Both accounts must affirm before the block can continue");
            check(positions.values().stream().mapToInt(Integer::intValue).sum() == 100,
                    "Position projection must count both allocations exactly once");

            Files.writeString(directory.resolve("booked-positions.tsv"), "account\tsymbol\tlong\n"
                    + "FUND-A\tACME\t" + positions.get("FUND-A") + "\n"
                    + "FUND-B\tACME\t" + positions.get("FUND-B") + "\n");
            positionQuery(broker, manager, "FUND-A", positions);
            positionQuery(broker, manager, "FUND-B", positions);
            System.out.println("PASS post-trade: two trades; invalid split rejected; 70/30 allocated, "
                    + "corrected and affirmed; positions reconciled.");
            System.out.println("Wire logs and ledger export: " + directory);
        }
    }

    private static void captureTrades(LabPeer broker, LabPeer manager) throws Exception {
        Message query = message("AD");
        query.setString(568, "TQ42");
        query.setInt(569, 0);
        query.setChar(263, '0');
        query.setString(11, "C42");
        manager.send(query);
        field(broker.expect("AD"), 568, "TQ42");
        broker.send(trade("TR1", "E1", 40, "24.90", false));
        broker.send(trade("TR2", "E2", 60, "25.00", true));
        Message first = manager.expect("AE");
        Message second = manager.expect("AE");
        field(first, 568, "TQ42");
        field(second, 568, "TQ42");
        field(second, 912, "Y");
        int quantity = first.getInt(32) + second.getInt(32);
        BigDecimal value = first.getDecimal(31).multiply(first.getDecimal(32))
                .add(second.getDecimal(31).multiply(second.getDecimal(32)));
        check(quantity == 100 && value.compareTo(new BigDecimal("2496.00")) == 0,
                "Trade capture must match the fills before allocating");
    }

    private static Message trade(String tradeId, String execId, int qty, String price, boolean last) {
        Message report = message("AE");
        report.setString(571, tradeId);
        report.setString(568, "TQ42");
        report.setString(17, execId);
        report.setInt(487, 0);
        report.setInt(748, 2);
        report.setBoolean(912, last);
        report.setBoolean(570, true);
        report.setString(55, SYMBOL);
        report.setInt(32, qty);
        report.setString(31, price);
        report.setString(75, DAY);
        time(report, 60);
        var side = group("AE", 552);
        side.setChar(54, '1');
        side.setString(37, "B510");
        side.setString(11, "C42");
        report.addGroup(side);
        return report;
    }

    private static Message instruction(List<Allocation> splits, String id) {
        Message instruction = message("J");
        instruction.setString(70, id);
        instruction.setChar(71, '0');
        instruction.setInt(626, 2);
        fillBlock(instruction, splits);
        return instruction;
    }

    private static Message allocationReport() {
        Message report = message("AS");
        report.setString(755, "AR42");
        report.setString(70, ALLOCATION);
        report.setChar(71, '4');
        report.setInt(794, 3);
        report.setInt(87, 0);
        fillBlock(report, SPLIT);
        return report;
    }

    private static void fillBlock(Message block, List<Allocation> splits) {
        String type = type(block);
        block.setInt(857, 1);
        block.setChar(54, '1');
        block.setString(55, SYMBOL);
        block.setInt(53, 100);
        block.setString(6, PRICE);
        block.setString(75, DAY);
        block.setString(15, "USD");
        var order = group(type, 73);
        order.setString(11, "C42");
        order.setString(37, "B510");
        block.addGroup(order);
        block.addGroup(allocationExecution(type, "E1", 40, "24.90"));
        block.addGroup(allocationExecution(type, "E2", 60, "25.00"));
        for (Allocation allocation : splits) {
            var row = group(type, 78);
            row.setString(79, allocation.account());
            row.setInt(80, allocation.shares());
            row.setString(467, allocation.id());
            if (type.equals("AS")) {
                row.setDecimal(153, UNIT_PRICE);
                row.setDecimal(154, amount(allocation, UNIT_PRICE.add(FEE_PER_SHARE)));
            }
            block.addGroup(row);
        }
    }

    private static quickfix.Group allocationExecution(String type, String id, int shares, String price) {
        var fill = group(type, 124);
        fill.setString(17, id);
        fill.setInt(32, shares);
        fill.setString(31, price);
        return fill;
    }

    private static int allocationTotal(Message instruction) throws Exception {
        int sum = 0;
        for (var row : instruction.getGroups(78)) sum += row.getInt(80);
        return sum;
    }

    private static Message allocationAck(Message instruction, boolean accepted) throws Exception {
        Message receipt = message("P");
        receipt.setString(70, instruction.getString(70));
        receipt.setInt(87, accepted ? 0 : 1);
        if (!accepted) {
            receipt.setInt(88, 8); // Incorrect allocated quantity.
            receipt.setString(58, "Account quantities do not sum to block");
        }
        time(receipt, 60);
        return receipt;
    }

    private static void confirm(LabPeer broker, LabPeer manager, Allocation allocation, String id,
                                String priorId, String account, Map<String, Stage> stages,
                                Map<String, Integer> positions) throws Exception {
        broker.send(confirmation(allocation, id, priorId, account));
        Message terms = manager.expect("AK");
        field(terms, 70, ALLOCATION);
        field(terms, 467, allocation.id());
        if (priorId != null) field(terms, 772, priorId);
        boolean accountMatched = terms.getString(79).equals(allocation.account());
        boolean matched = accountMatched && terms.getInt(80) == allocation.shares()
                && terms.getDecimal(6).compareTo(UNIT_PRICE) == 0
                && terms.getDecimal(381).compareTo(amount(allocation, UNIT_PRICE)) == 0
                && terms.getDecimal(118).compareTo(amount(allocation, UNIT_PRICE.add(FEE_PER_SHARE))) == 0;

        Message ack = message("AU");
        ack.setString(664, terms.getString(664));
        ack.setString(75, DAY);
        time(ack, 60);
        ack.setInt(940, matched ? 3 : 2);
        if (!matched) {
            ack.setInt(774, accountMatched ? 99 : 1);
            ack.setString(58, accountMatched ? "Quantity or cash mismatch" : "Account mismatch");
        }
        manager.send(ack);
        Message affirmation = broker.expect("AU");
        field(affirmation, 664, id);
        if (affirmation.getInt(940) == 3) {
            stages.put(allocation.id(), Stage.AFFIRMED);
            positions.put(allocation.account(), allocation.shares());
        } else {
            stages.put(allocation.id(), Stage.REJECTED);
        }
    }

    private static Message confirmation(Allocation allocation, String id, String priorId, String account) {
        Message terms = message("AK");
        terms.setString(664, id);
        terms.setInt(666, priorId == null ? 0 : 1);
        if (priorId != null) terms.setString(772, priorId);
        terms.setInt(773, 2);
        terms.setInt(665, 4);
        terms.setString(70, ALLOCATION);
        terms.setString(467, allocation.id());
        time(terms, 60);
        terms.setString(75, DAY);
        terms.setString(55, SYMBOL);
        terms.setInt(711, 0);
        terms.setInt(555, 0);
        terms.setInt(80, allocation.shares());
        terms.setString(79, account);
        terms.setChar(54, '1');
        terms.setString(15, "USD");
        terms.setString(6, PRICE);
        terms.setDecimal(381, amount(allocation, UNIT_PRICE));
        terms.setDecimal(118, amount(allocation, UNIT_PRICE.add(FEE_PER_SHARE)));
        terms.setDecimal(12, amount(allocation, FEE_PER_SHARE));
        terms.setChar(13, '3');
        var capacity = group("AK", 862);
        capacity.setChar(528, 'A');
        capacity.setInt(863, allocation.shares());
        terms.addGroup(capacity);
        return terms;
    }

    private static BigDecimal amount(Allocation allocation, BigDecimal each) {
        return each.multiply(BigDecimal.valueOf(allocation.shares()));
    }

    private static void positionQuery(LabPeer broker, LabPeer manager, String account,
                                      Map<String, Integer> positions) throws Exception {
        Message request = message("AN");
        String id = "POS-" + account;
        request.setString(710, id);
        request.setInt(724, 0);
        request.setString(1, account);
        request.setInt(581, 1);
        request.setString(715, DAY);
        request.setChar(263, '0');
        time(request, 60);
        party(request, account);
        manager.send(request);
        Message query = broker.expect("AN");

        Message response = message("AP");
        response.setString(721, "REPORT-" + account);
        response.setString(710, query.getString(710));
        response.setInt(727, 1);
        response.setInt(728, 0);
        response.setString(715, query.getString(715));
        response.setString(1, query.getString(1));
        response.setInt(581, 1);
        response.setString(55, SYMBOL);
        response.setString(730, PRICE);
        response.setInt(731, 1);
        response.setString(734, "24.85");
        party(response, account);
        var quantity = group("AP", 702);
        quantity.setString(703, "FIN");
        quantity.setInt(704, positions.get(query.getString(1)));
        quantity.setInt(705, 0);
        response.addGroup(quantity);
        var cash = group("AP", 753);
        cash.setString(707, "CASH");
        cash.setString(708, "0");
        response.addGroup(cash);
        broker.send(response);
        Message received = manager.expect("AP");
        field(received, 710, id);
        FieldMap position = received.getGroup(1, group("AP", 702));
        field(position, 704, positions.get(account).toString());
    }

    private static void party(Message message, String account) {
        var party = group(type(message), 453);
        party.setString(448, account);
        party.setChar(447, 'D');
        party.setInt(452, 3);
        message.addGroup(party);
    }
}
