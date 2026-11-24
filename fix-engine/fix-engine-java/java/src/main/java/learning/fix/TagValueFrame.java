package learning.fix;

import java.io.ByteArrayOutputStream;
import java.io.EOFException;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;

/** A bounded, blocking teaching framer. The caller keeps one buffered stream per connection. */
public final class TagValueFrame {
    private static final int SOH = 1;
    private static final int MAX_BODY_BYTES = 64 * 1024;
    private static final int TRAILER_BYTES = 7; // 10=ddd followed by SOH

    private TagValueFrame() {}

    /** Returns one complete frame, or null for a clean EOF between frames. */
    public static byte[] read(InputStream socket) throws IOException {
        int first = socket.read();
        if (first < 0) {
            return null;
        }
        if (first != '8' || socket.read() != '=') {
            throw new IOException("Expected BeginString (8)");
        }

        ByteArrayOutputStream header = new ByteArrayOutputStream(32);
        header.write('8');
        header.write('=');
        String version = readField(socket, header, 16);
        if (!version.startsWith("FIX.") && !version.startsWith("FIXT.")) {
            throw new IOException("Invalid BeginString");
        }

        String lengthField = readField(socket, header, 8);
        if (!lengthField.matches("9=[0-9]{1,5}")) {
            throw new IOException("Expected bounded decimal BodyLength (9)");
        }
        int bodyLength = Integer.parseInt(lengthField.substring(2));
        if (bodyLength < 5 || bodyLength > MAX_BODY_BYTES) {
            throw new IOException("BodyLength outside lab limits");
        }

        // The length makes embedded SOH or 10= inside a data field harmless to framing.
        byte[] bodyAndTrailer = socket.readNBytes(bodyLength + TRAILER_BYTES);
        if (bodyAndTrailer.length != bodyLength + TRAILER_BYTES) {
            throw new EOFException("Truncated FIX frame");
        }
        if (bodyAndTrailer[0] != '3' || bodyAndTrailer[1] != '5' || bodyAndTrailer[2] != '='
                || bodyAndTrailer[bodyLength - 1] != SOH) {
            throw new IOException("Expected MsgType and a SOH-terminated body");
        }

        String trailer = new String(bodyAndTrailer, bodyLength, TRAILER_BYTES, StandardCharsets.US_ASCII);
        byte[] headerBytes = header.toByteArray();
        int sum = checksum(headerBytes, headerBytes.length) + checksum(bodyAndTrailer, bodyLength);
        if (!trailer.matches("10=[0-9]{3}\u0001")
                || Integer.parseInt(trailer.substring(3, 6)) != (sum & 255)) {
            throw new IOException("Invalid CheckSum (10)");
        }
        header.writeBytes(bodyAndTrailer);
        return header.toByteArray();
    }

    private static String readField(InputStream socket, ByteArrayOutputStream header, int limit)
            throws IOException {
        StringBuilder field = new StringBuilder();
        for (int i = 0; i <= limit; i++) {
            int value = socket.read();
            if (value < 0) {
                throw new EOFException("Truncated FIX header");
            }
            header.write(value);
            if (value == SOH) {
                return field.toString();
            }
            field.append((char) value);
        }
        throw new IOException("FIX header field exceeds lab limit");
    }

    private static int checksum(byte[] bytes, int length) {
        int sum = 0;
        for (int i = 0; i < length; i++) {
            sum += Byte.toUnsignedInt(bytes[i]);
        }
        return sum & 255;
    }
}
