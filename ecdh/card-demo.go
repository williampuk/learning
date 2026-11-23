// Compile with storage-demo.go in a module that requires
// cunicu.li/go-openpgp-card v0.3.11. cardObjectKey is an integration
// function for a program that already opened the intended reader.
package main

import (
	"crypto/ecdh"
	"errors"
	"fmt"

	iso "cunicu.li/go-iso7816"
	openpgp "cunicu.li/go-openpgp-card"
)

// expectedCardKey is pinned during provisioning. The caller must authorize
// the operation and associated record before submitting its peer key.
func cardObjectKey(reader *iso.Card, expectedCardKey *ecdh.PublicKey, peerBytes []byte, pin string) (key []byte, err error) {
	if expectedCardKey == nil || reader == nil || len(pin) == 0 {
		return nil, errors.New("reader, pinned card public key, and PIN required")
	}

	curve := expectedCardKey.Curve()
	var size int
	switch curve {
	case ecdh.P256(), ecdh.X25519():
		size = 32
	case ecdh.P384():
		size = 48
	case ecdh.P521():
		size = 66
	default:
		return nil, errors.New("unsupported card curve")
	}
	// For X25519 this checks the input length. The shared output check
	// below rejects the all-zero result from a low-order peer.
	peer, err := curve.NewPublicKey(peerBytes)
	if err != nil {
		return nil, fmt.Errorf("parse peer public key: %w", err)
	}

	card, err := openpgp.NewCard(reader)
	if err != nil {
		return nil, fmt.Errorf("open OpenPGP applet: %w", err)
	}
	defer func() {
		if closeErr := card.Close(); closeErr != nil {
			key = nil
			err = errors.Join(err, fmt.Errorf("close card transaction: %w", closeErr))
		}
	}()

	handle, err := card.PrivateKey(openpgp.KeyDecrypt, nil)
	if err != nil {
		return nil, fmt.Errorf("get decipher key handle: %w", err)
	}
	private, ok := handle.(*openpgp.PrivateKeyECDH)
	if !ok {
		return nil, errors.New("decipher slot is not configured for ECDH")
	}
	public, ok := private.Public().(*ecdh.PublicKey)
	if !ok || !public.Equal(expectedCardKey) {
		return nil, errors.New("decipher key does not match the pinned public key")
	}
	if err := card.VerifyPassword(openpgp.PW1forPSO, pin); err != nil {
		return nil, fmt.Errorf("verify decipher PIN: %w", err)
	}
	shared, err := private.ECDH(peer)
	if err != nil {
		return nil, fmt.Errorf("card PSO: DECIPHER: %w", err)
	}
	if err := checkSharedSecret(shared, size, curve == ecdh.X25519()); err != nil {
		return nil, err
	}

	return deriveKey(shared, objectPurpose, 32)
}
