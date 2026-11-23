// Run with Go 1.24 or later: go run storage-demo.go
package main

import (
	"bytes"
	"crypto/aes"
	"crypto/cipher"
	"crypto/ecdh"
	"crypto/hkdf"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"errors"
	"fmt"
	"log"
)

const (
	objectPurpose = "object-storage-key-v1"
	objectVersion = byte(1)
	x25519Size    = 32
	headerSize    = 1 + sha256.Size + x25519Size
)

// The card example uses this check too, because the card library returns
// the response bytes without validating them.
func checkSharedSecret(secret []byte, size int, rejectZero bool) error {
	if len(secret) != size {
		return fmt.Errorf("got %d shared bytes, want %d", len(secret), size)
	}
	if rejectZero && subtle.ConstantTimeCompare(secret, make([]byte, size)) == 1 {
		return errors.New("all-zero X25519 result")
	}
	return nil
}

func deriveKey(shared []byte, purpose string, size int) ([]byte, error) {
	return hkdf.Key(sha256.New, shared, nil, purpose, size)
}

func exchange(private *ecdh.PrivateKey, peerBytes []byte) ([]byte, error) {
	peer, err := ecdh.X25519().NewPublicKey(peerBytes)
	if err != nil {
		return nil, fmt.Errorf("parse peer key: %w", err)
	}
	shared, err := private.ECDH(peer)
	if err != nil {
		return nil, fmt.Errorf("perform X25519: %w", err)
	}
	if err := checkSharedSecret(shared, x25519Size, true); err != nil {
		return nil, err
	}
	return shared, nil
}

func objectCipher(shared []byte) (cipher.AEAD, error) {
	key, err := deriveKey(shared, objectPurpose, 32)
	if err != nil {
		return nil, err
	}
	// The format specifies AES-256. NewCipher also accepts 16 or 24 bytes.
	if len(key) != 32 {
		return nil, errors.New("expected a 32-byte AES-256 key")
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	return cipher.NewGCMWithRandomNonce(block)
}

func objectAAD(header []byte, objectID string) []byte {
	// Header has a fixed length; the expected object ID occupies the rest.
	return append(bytes.Clone(header), objectID...)
}

func sealObject(recipient *ecdh.PublicKey, objectID string, plaintext []byte) ([]byte, error) {
	// Use a fresh software peer for each new record.
	peer, err := ecdh.X25519().GenerateKey(rand.Reader)
	if err != nil {
		return nil, err
	}
	shared, err := exchange(peer, recipient.Bytes())
	if err != nil {
		return nil, err
	}
	aead, err := objectCipher(shared)
	if err != nil {
		return nil, err
	}

	keyID := sha256.Sum256(recipient.Bytes())
	header := make([]byte, 0, headerSize)
	header = append(header, objectVersion)
	header = append(header, keyID[:]...)
	header = append(header, peer.PublicKey().Bytes()...)
	// This API generates and prepends a nonce. The tag follows the ciphertext.
	body := aead.Seal(nil, nil, plaintext, objectAAD(header, objectID))
	return append(header, body...), nil
}

func openObject(recipient *ecdh.PrivateKey, objectID string, record []byte) ([]byte, error) {
	const gcmOverhead = 12 + 16
	if len(record) < headerSize+gcmOverhead {
		return nil, errors.New("truncated object")
	}
	header, body := record[:headerSize], record[headerSize:]
	if header[0] != objectVersion {
		return nil, errors.New("unsupported object version")
	}

	expectedID := sha256.Sum256(recipient.PublicKey().Bytes())
	if !bytes.Equal(expectedID[:], header[1:1+sha256.Size]) {
		return nil, errors.New("unexpected recipient key ID")
	}
	// In a card-backed reader, this is the step that calls the card.
	shared, err := exchange(recipient, header[1+sha256.Size:])
	if err != nil {
		return nil, err
	}
	aead, err := objectCipher(shared)
	if err != nil {
		return nil, err
	}
	plaintext, err := aead.Open(nil, nil, body, objectAAD(header, objectID))
	if err != nil {
		return nil, fmt.Errorf("authenticate object: %w", err)
	}
	return plaintext, nil
}

func hkdfVector() error {
	const sharedHex = "4a5d9d5ba4ce2de1728e3bf480350f25e07e21c947d19e3376f09b3c1e161742"
	const want = "45975bdb01d4c58a07a4c0fd32f8beaa2b635f0fce84e392017d334a1a7d6cbc"

	shared, err := hex.DecodeString(sharedHex)
	if err != nil {
		return err
	}
	key, err := deriveKey(shared, objectPurpose, 32)
	if err != nil {
		return err
	}
	if hex.EncodeToString(key) != want {
		return errors.New("HKDF did not match the public worked example")
	}
	return nil
}

func knownScalarEquality(recipient *ecdh.PrivateKey) error {
	// Deliberately insecure teaching input. Anyone who knows this message
	// can recreate the X25519 private input, including its clamping rule.
	digest := sha256.Sum256([]byte("public example document"))
	knownPeer, err := ecdh.X25519().NewPrivateKey(digest[:])
	if err != nil {
		return err
	}
	cardShared, err := exchange(recipient, knownPeer.PublicKey().Bytes())
	if err != nil {
		return err
	}
	observerShared, err := exchange(knownPeer, recipient.PublicKey().Bytes())
	if err != nil {
		return err
	}
	cardKey, err := deriveKey(cardShared, objectPurpose, 32)
	if err != nil {
		return err
	}
	observerKey, err := deriveKey(observerShared, objectPurpose, 32)
	if err != nil {
		return err
	}
	if !bytes.Equal(cardShared, observerShared) || !bytes.Equal(cardKey, observerKey) {
		return errors.New("expected equal shared and derived bytes for the known scalar")
	}
	return nil
}

func run() error {
	curve := ecdh.X25519()
	alice, err := curve.GenerateKey(rand.Reader)
	if err != nil {
		return err
	}
	bob, err := curve.GenerateKey(rand.Reader)
	if err != nil {
		return err
	}
	aliceShared, err := exchange(alice, bob.PublicKey().Bytes())
	if err != nil {
		return err
	}
	bobShared, err := exchange(bob, alice.PublicKey().Bytes())
	if err != nil {
		return err
	}
	if !bytes.Equal(aliceShared, bobShared) {
		return errors.New("ECDH sides disagree")
	}
	if _, err := exchange(alice, make([]byte, x25519Size)); err == nil {
		return errors.New("X25519 unexpectedly accepted a low-order peer")
	}
	if _, err := exchange(alice, make([]byte, x25519Size-1)); err == nil {
		return errors.New("X25519 unexpectedly accepted the wrong peer length")
	}
	fmt.Printf("Both X25519 sides agree on %d shared bytes. Invalid inputs rejected.\n", len(aliceShared))

	aesKey, err := deriveKey(aliceShared, objectPurpose, 32)
	if err != nil {
		return err
	}
	repeated, err := deriveKey(bobShared, objectPurpose, 32)
	if err != nil {
		return err
	}
	// A separate protocol purpose, not an extra MAC for GCM.
	authKey, err := deriveKey(aliceShared, "object-storage-auth-v1", 32)
	if err != nil {
		return err
	}
	if !bytes.Equal(aesKey, repeated) || bytes.Equal(aesKey, authKey) {
		return errors.New("unexpected key derivation result")
	}
	if err := hkdfVector(); err != nil {
		return err
	}
	fmt.Println("HKDF matches the worked vector, repeats deterministically, and separates purposes.")

	message := []byte("example object contents")
	recordA, err := sealObject(alice.PublicKey(), "object-a", message)
	if err != nil {
		return err
	}
	recordB, err := sealObject(alice.PublicKey(), "object-b", message)
	if err != nil {
		return err
	}
	peerA, peerB := recordA[1+sha256.Size:headerSize], recordB[1+sha256.Size:headerSize]
	sharedA, err := exchange(alice, peerA)
	if err != nil {
		return err
	}
	sharedB, err := exchange(alice, peerB)
	if err != nil {
		return err
	}
	if bytes.Equal(sharedA, sharedB) {
		return errors.New("fresh peers unexpectedly produced equal shared secrets")
	}
	for _, object := range []struct {
		id     string
		record []byte
	}{{"object-a", recordA}, {"object-b", recordB}} {
		plaintext, err := openObject(alice, object.id, object.record)
		if err != nil {
			return err
		}
		if !bytes.Equal(plaintext, message) {
			return errors.New("round trip did not reproduce the plaintext")
		}
	}
	if _, err := openObject(alice, "object-b", recordA); err == nil {
		return errors.New("cross-object swap unexpectedly accepted")
	}
	recordA[len(recordA)-1] ^= 1
	if _, err := openObject(alice, "object-a", recordA); err == nil {
		return errors.New("tampered tag unexpectedly accepted")
	}
	fmt.Println("Each object has a fresh peer. GCM round trips, rejects swaps, and detects tampering.")

	// Re-deriving the same key still permits a fresh nonce on every seal.
	aead, err := objectCipher(aliceShared)
	if err != nil {
		return err
	}
	first := aead.Seal(nil, nil, message, nil)
	second := aead.Seal(nil, nil, message, nil)
	const gcmNonceBytes = 12
	if bytes.Equal(first[:gcmNonceBytes], second[:gcmNonceBytes]) {
		return errors.New("repeated random nonce")
	}
	fmt.Println("Sealing the same plaintext under the same key generated fresh public nonces.")

	if err := knownScalarEquality(alice); err != nil {
		return err
	}
	fmt.Println("The known peer scalar reproduces both the shared bytes and the AES key.")

	// Use distinct purposes and a stable identifier for the intended volume.
	// Real volume derivation must use a reproducible secret and ID.
	slot, err := deriveKey(aliceShared, "luks-keyslot-v1:demo-volume", 32)
	if err != nil {
		return err
	}
	volume, err := deriveKey(aliceShared, "luks-aes256-xts-volume-v1:demo-volume", 64)
	if err != nil {
		return err
	}
	fmt.Printf("LUKS example: %d credential bytes or %d raw AES-256-XTS volume-key bytes.\n",
		len(slot), len(volume))
	return nil
}

func main() {
	if err := run(); err != nil {
		log.Fatal(err)
	}
}
