// Public test keys and synthetic prevouts. Run "go run ." in this directory.
package main

import (
	"bytes"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"os"

	"github.com/btcsuite/btcd/btcec/v2"
	"github.com/btcsuite/btcd/btcec/v2/schnorr"
	"github.com/btcsuite/btcd/btcec/v2/schnorr/musig2"
	"github.com/btcsuite/btcd/btcutil"
	"github.com/btcsuite/btcd/chaincfg"
	"github.com/btcsuite/btcd/chaincfg/chainhash"
	"github.com/btcsuite/btcd/txscript"
	"github.com/btcsuite/btcd/wire"
)

func require(err error) {
	if err != nil {
		panic(err)
	}
}

func must[T any](value T, err error) T {
	require(err)
	return value
}

func h(b []byte) string { return hex.EncodeToString(b) }

func publicKey(key *btcec.PrivateKey) []byte { return schnorr.SerializePubKey(key.PubKey()) }

func demoKey(id byte) *btcec.PrivateKey {
	key, _ := btcec.PrivKeyFromBytes([]byte{id})
	return key
}

// Use the BIP340 auxiliary-randomness nonce path in btcec.
func sign(key *btcec.PrivateKey, digest []byte) *schnorr.Signature {
	var aux [32]byte
	_, err := rand.Read(aux[:])
	require(err)
	return must(schnorr.Sign(key, digest, schnorr.CustomNonce(aux)))
}

type spend struct {
	funding *wire.MsgTx
	tx      *wire.MsgTx
	prev    *wire.TxOut
	fetcher *txscript.MultiPrevOutFetcher
	hashes  *txscript.TxSigHashes
}

// Override synthetic prevouts by example number when testing on a local regtest chain.
type fundedOutput struct {
	TxID  string `json:"txid"`
	Vout  uint32 `json:"vout"`
	Value int64  `json:"value"`
}

var regtestFunding map[byte]fundedOutput

func newSpend(fundingID byte, pkScript []byte, sequence uint32) spend {
	// This synthetic funding transaction creates a distinct 100,000-sat UTXO.
	// Its fake source outpoint stands in for an already funded wallet.
	funding := wire.NewMsgTx(2)
	source := wire.OutPoint{Hash: chainhash.Hash{fundingID}, Index: 0}
	funding.AddTxIn(wire.NewTxIn(&source, nil, nil))
	prev := wire.NewTxOut(100000, pkScript)
	funding.AddTxOut(prev)
	outpoint := wire.OutPoint{Hash: funding.TxHash(), Index: 0}
	if real, ok := regtestFunding[fundingID]; ok {
		if real.Value != prev.Value {
			panic("regtest fixture must fund exactly 100000 satoshis")
		}
		outpoint = wire.OutPoint{Hash: *must(chainhash.NewHashFromStr(real.TxID)), Index: real.Vout}
		funding = nil // The live funding transaction is supplied by the regtest wallet.
	}
	tx := wire.NewMsgTx(2)
	input := wire.NewTxIn(&outpoint, nil, nil)
	input.Sequence = sequence
	tx.AddTxIn(input)

	// Both paths use the same destination, value and fee.
	destination := txscript.ComputeTaprootKeyNoScript(demoKey(9).PubKey())
	tx.AddTxOut(wire.NewTxOut(99000, must(txscript.PayToTaprootScript(destination))))
	fetcher := txscript.NewMultiPrevOutFetcher(map[wire.OutPoint]*wire.TxOut{outpoint: prev})
	return spend{funding, tx, prev, fetcher, txscript.NewTxSigHashes(tx, fetcher)}
}

func (s spend) digest() []byte {
	return must(txscript.CalcTaprootSignatureHash(s.hashes, txscript.SigHashDefault, s.tx, 0, s.fetcher))
}

func (s spend) scriptDigest(leaf txscript.TapLeaf) []byte {
	return must(txscript.CalcTapscriptSignaturehash(s.hashes, txscript.SigHashDefault,
		s.tx, 0, s.fetcher, leaf))
}

func (s spend) validate() error {
	vm, err := txscript.NewEngine(s.prev.PkScript, s.tx, 0, txscript.StandardVerifyFlags,
		nil, s.hashes, s.prev.Value, s.fetcher)
	if err != nil {
		return err
	}
	return vm.Execute()
}

func wireHex(tx *wire.MsgTx) string {
	var raw bytes.Buffer
	require(tx.Serialize(&raw))
	return h(raw.Bytes())
}

func (s spend) report(digest []byte) map[string]any {
	witness := make([]string, len(s.tx.TxIn[0].Witness))
	for i, element := range s.tx.TxIn[0].Witness {
		witness[i] = h(element)
	}
	weight := 3*s.tx.SerializeSizeStripped() + s.tx.SerializeSize()
	report := map[string]any{
		"txid": s.tx.TxHash().String(), "outpoint": s.tx.TxIn[0].PreviousOutPoint.String(),
		"amount": s.prev.Value, "sequence": s.tx.TxIn[0].Sequence, "digest": h(digest),
		"witness": witness, "raw": wireHex(s.tx), "weight": weight, "vsize": (weight + 3) / 4,
		"version": s.tx.Version, "locktime": s.tx.LockTime, "outputAmount": s.tx.TxOut[0].Value,
		"outputScript": h(s.tx.TxOut[0].PkScript),
	}
	if s.funding != nil {
		report["syntheticFunding"] = wireHex(s.funding)
	}
	return report
}

func singleKeySpend() map[string]any {
	alice := demoKey(3)
	// BIP86-style commitment: hash x(P) alone and add tG.
	output := txscript.ComputeTaprootKeyNoScript(alice.PubKey())
	script := must(txscript.PayToTaprootScript(output))
	s := newSpend(1, script, wire.MaxTxInSequenceNum)
	digest := s.digest()
	tweaked := txscript.TweakTaprootPrivKey(*alice, nil)
	sig := sign(tweaked, digest)
	if !sig.Verify(digest, output) {
		panic("key-path signature failed independent Schnorr verification")
	}
	s.tx.TxIn[0].Witness = wire.TxWitness{sig.Serialize()}
	require(s.validate())
	result := s.report(digest)
	result["internalKey"] = h(publicKey(alice))
	result["outputKey"] = h(schnorr.SerializePubKey(output))
	result["scriptPubKey"] = h(script)
	result["regtestAddress"] = must(btcutil.NewAddressTaproot(schnorr.SerializePubKey(output),
		&chaincfg.RegressionNetParams)).EncodeAddress()
	return result
}

func cooperativeSignature(alice, bob *btcec.PrivateKey, root, digest []byte) ([]byte, map[string]string) {
	keys := []*btcec.PublicKey{alice.PubKey(), bob.PubKey()}
	opts := []musig2.ContextOption{musig2.WithKnownSigners(keys), musig2.WithTaprootTweakCtx(root)}
	a := must(must(musig2.NewContext(alice, false, opts...)).NewSession())
	b := must(must(musig2.NewContext(bob, false, opts...)).NewSession())
	// Each party exchanges public nonces and consumes its own secret nonce once.
	aNonce, bNonce := a.PublicNonce(), b.PublicNonce()
	must(a.RegisterPubNonce(bNonce))
	must(b.RegisterPubNonce(aNonce))
	aPartial := must(a.Sign([32]byte(digest)))
	bPartial := must(b.Sign([32]byte(digest)))
	if !must(a.CombineSig(bPartial)) {
		panic("MuSig2 session did not complete")
	}
	var partialA, partialB bytes.Buffer
	require(aPartial.Encode(&partialA))
	require(bPartial.Encode(&partialB))
	return a.FinalSig().Serialize(), map[string]string{
		"alicePublicNonce": h(aNonce[:]), "bobPublicNonce": h(bNonce[:]),
		"alicePartial": h(partialA.Bytes()), "bobPartial": h(partialB.Bytes()),
	}
}

func vault() map[string]any {
	alice, bob := demoKey(3), demoKey(7)
	recovery := demoKey(11)
	trustees := []*btcec.PrivateKey{demoKey(13), demoKey(17), demoKey(19)}
	fallback := demoKey(23)
	pubkeys := []*btcec.PublicKey{alice.PubKey(), bob.PubKey()}
	aggregate, _, _, err := musig2.AggregateKeys(pubkeys, false)
	require(err)
	internal := aggregate.FinalKey

	// A: dedicated Alice recovery key after 144 blocks.
	delayed := must(txscript.NewScriptBuilder().AddInt64(144).
		AddOp(txscript.OP_CHECKSEQUENCEVERIFY).AddOp(txscript.OP_DROP).
		AddData(publicKey(recovery)).AddOp(txscript.OP_CHECKSIG).Script())
	// B: two of three trustees after 4320 blocks, using a separate key per trustee.
	quorum := must(txscript.NewScriptBuilder().AddInt64(4320).
		AddOp(txscript.OP_CHECKSEQUENCEVERIFY).AddOp(txscript.OP_DROP).
		AddData(publicKey(trustees[0])).AddOp(txscript.OP_CHECKSIG).
		AddData(publicKey(trustees[1])).AddOp(txscript.OP_CHECKSIGADD).
		AddData(publicKey(trustees[2])).AddOp(txscript.OP_CHECKSIGADD).
		AddInt64(2).AddOp(txscript.OP_NUMEQUAL).Script())
	// C: a designated arbiter after absolute block height 1,000,000.
	emergency := must(txscript.NewScriptBuilder().AddInt64(1000000).
		AddOp(txscript.OP_CHECKLOCKTIMEVERIFY).AddOp(txscript.OP_DROP).
		AddData(publicKey(fallback)).AddOp(txscript.OP_CHECKSIG).Script())

	a, b, c := txscript.NewBaseTapLeaf(delayed), txscript.NewBaseTapLeaf(quorum), txscript.NewBaseTapLeaf(emergency)
	branch := txscript.NewTapBranch(b, c)
	root := txscript.NewTapBranch(a, branch).TapHash()
	output := txscript.ComputeTaprootOutputKey(internal, root[:])
	outputX := schnorr.SerializePubKey(output)
	pkScript := must(txscript.PayToTaprootScript(output))
	internalX := schnorr.SerializePubKey(internal)
	tweak := chainhash.TaggedHash(chainhash.TagTapTweak, internalX, root[:])
	address := must(btcutil.NewAddressTaproot(outputX, &chaincfg.MainNetParams))

	cooperative := newSpend(2, pkScript, wire.MaxTxInSequenceNum)
	keyDigest := cooperative.digest()
	combined, rounds := cooperativeSignature(alice, bob, root[:], keyDigest)
	cooperative.tx.TxIn[0].Witness = wire.TxWitness{combined}
	require(cooperative.validate())

	sibling := branch.TapHash()
	control := txscript.ControlBlock{
		InternalKey: internal, OutputKeyYIsOdd: output.SerializeCompressed()[0] == 3,
		LeafVersion: txscript.BaseLeafVersion, InclusionProof: sibling[:],
	}
	controlBytes := must(control.ToBytes())
	require(txscript.VerifyTaprootLeafCommitment(must(txscript.ParseControlBlock(controlBytes)), outputX, delayed))

	recover := func(sequence uint32) (spend, []byte) {
		s := newSpend(3, pkScript, sequence)
		digest := s.scriptDigest(a)
		sig := sign(recovery, digest)
		s.tx.TxIn[0].Witness = wire.TxWitness{sig.Serialize(), delayed, controlBytes}
		return s, digest
	}
	recoverySpend, recoveryDigest := recover(144)
	require(recoverySpend.validate())
	early, _ := recover(143)
	if early.validate() == nil {
		panic("sequence 143 incorrectly satisfies CSV(144)")
	}

	// Also execute B with two real signatures and an empty middle signer slot.
	ha, hc := a.TapHash(), c.TapHash()
	bProof := append(append([]byte{}, hc[:]...), ha[:]...)
	bControl := control
	bControl.InclusionProof = bProof
	quorumSpend := newSpend(4, pkScript, 4320)
	quorumDigest := quorumSpend.scriptDigest(b)
	quorumSpend.tx.TxIn[0].Witness = wire.TxWitness{
		sign(trustees[2], quorumDigest).Serialize(), nil,
		sign(trustees[0], quorumDigest).Serialize(), quorum, must(bControl.ToBytes()),
	}
	require(quorumSpend.validate())

	// Also execute C with a locktime-enabled sequence and height-based nLockTime.
	cProof := append(append([]byte{}, hashBytes(b)...), ha[:]...)
	cControl := control
	cControl.InclusionProof = cProof
	emergencySpend := newSpend(5, pkScript, 0xfffffffe)
	emergencySpend.tx.LockTime = 1000000
	emergencyDigest := emergencySpend.scriptDigest(c)
	emergencySpend.tx.TxIn[0].Witness = wire.TxWitness{
		sign(fallback, emergencyDigest).Serialize(), emergency, must(cControl.ToBytes()),
	}
	require(emergencySpend.validate())

	return map[string]any{
		"alice": h(alice.PubKey().SerializeCompressed()), "bob": h(bob.PubKey().SerializeCompressed()),
		"internalKey": h(internalX), "outputKey": h(outputX), "outputParity": output.SerializeCompressed()[0] & 1,
		"scriptPubKey": h(pkScript), "address": address.EncodeAddress(), "root": h(root[:]),
		"regtestAddress": must(btcutil.NewAddressTaproot(outputX, &chaincfg.RegressionNetParams)).EncodeAddress(),
		"tweak":          h(tweak[:]), "branch": h(sibling[:]),
		"leafHashes":    []string{h(hashBytes(a)), h(hashBytes(b)), h(hashBytes(c))},
		"scripts":       []string{h(delayed), h(quorum), h(emergency)},
		"signingRounds": rounds, "cooperative": cooperative.report(keyDigest), "recovery": recoverySpend.report(recoveryDigest),
		"quorum": quorumSpend.report(quorumDigest), "emergency": emergencySpend.report(emergencyDigest),
		"badSequenceError": early.validate().Error(),
	}
}

func hashBytes(leaf txscript.TapLeaf) []byte {
	hash := leaf.TapHash()
	return hash[:]
}

func main() {
	fundingPath := flag.String("funding", "", "JSON mapping regtest example numbers (1–5) to funded outpoints")
	flag.Parse()
	if *fundingPath != "" {
		require(json.Unmarshal(must(os.ReadFile(*fundingPath)), &regtestFunding))
	}
	report := map[string]any{"singleKey": singleKeySpend(), "vault": vault()}
	encoder := json.NewEncoder(os.Stdout)
	encoder.SetIndent("", "  ")
	if err := encoder.Encode(report); err != nil {
		panic(fmt.Errorf("write validated examples: %w", err))
	}
}
