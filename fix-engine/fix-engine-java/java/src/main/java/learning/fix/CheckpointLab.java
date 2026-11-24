package learning.fix;

import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.file.FileAlreadyExistsException;
import java.nio.file.Files;
import java.nio.file.Path;

import static java.nio.charset.StandardCharsets.UTF_8;
import static java.nio.file.StandardOpenOption.CREATE_NEW;
import static java.nio.file.StandardOpenOption.WRITE;

/** A single-event process crash exercise. Run one process at a time in a scratch directory. */
public final class CheckpointLab {
    private static final String FILL = "VENUE/C42/E2 filled=100\n";

    public static void main(String[] args) throws IOException {
        if (args.length != 2 || !(args[0].equals("crash") || args[0].equals("replay"))) {
            throw new IllegalArgumentException("Usage: CheckpointLab.java crash|replay <scratch directory>");
        }
        Path directory = Files.createDirectories(Path.of(args[1]));
        Path fillRecord = directory.resolve("E2.fill");
        Path checkpoint = directory.resolve("next-inbound");
        boolean crash = args[0].equals("crash");

        // This fixture starts at expected sequence 3. The checkpoint records consumption of E2.
        int next = 3;
        if (Files.exists(checkpoint)) {
            requireContents(checkpoint, "4\n");
            requireContents(fillRecord, FILL);
            next = 4;
        }
        if (crash && next != 3) {
            throw new IllegalStateException("Use a fresh scratch directory for the crash step");
        }

        // In this one-fill ledger, the keyed record is both the inbox entry and the business effect.
        boolean inserted = recordOnce(fillRecord, FILL);
        if (crash) {
            if (!inserted) {
                throw new IllegalStateException("Use a fresh scratch directory for the crash step");
            }
            System.out.println("E2 committed. Expected inbound is still 3. Halting with exit code 73.");
            System.out.flush();
            Runtime.getRuntime().halt(73);
        }

        recordOnce(checkpoint, "4\n");
        System.out.printf("%s. Filled 100. Expected inbound %d -> 4.%n",
                inserted ? "Booked E2" : "E2 already booked", next);
    }

    private static boolean recordOnce(Path path, String content) throws IOException {
        try (FileChannel channel = FileChannel.open(path, CREATE_NEW, WRITE)) {
            ByteBuffer bytes = UTF_8.encode(content);
            while (bytes.hasRemaining()) {
                channel.write(bytes);
            }
            channel.force(true);
            return true;
        } catch (FileAlreadyExistsException exists) {
            requireContents(path, content);
            return false;
        }
    }

    private static void requireContents(Path path, String expected) throws IOException {
        if (!Files.readString(path, UTF_8).equals(expected)) {
            throw new IOException("Incomplete or conflicting record: " + path);
        }
    }
}
