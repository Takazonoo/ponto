package br.com.controle;

import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Base64;
import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.PBEKeySpec;

final class Passwords {
    private static final SecureRandom RANDOM = new SecureRandom();

    private Passwords() {}

    static String hash(String password) {
        byte[] salt = new byte[16];
        RANDOM.nextBytes(salt);
        return Base64.getEncoder().encodeToString(salt) + "." +
            Base64.getEncoder().encodeToString(derive(password, salt));
    }

    static boolean matches(String password, String stored) {
        String[] parts = stored.split("\\.");
        return MessageDigest.isEqual(derive(password, Base64.getDecoder().decode(parts[0])),
            Base64.getDecoder().decode(parts[1]));
    }

    private static byte[] derive(String password, byte[] salt) {
        PBEKeySpec spec = new PBEKeySpec(password.toCharArray(), salt, 600_000, 256);
        try {
            return SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).getEncoded();
        } catch (java.security.GeneralSecurityException ex) {
            throw new IllegalStateException(ex);
        } finally {
            spec.clearPassword();
        }
    }
}
