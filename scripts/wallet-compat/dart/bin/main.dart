import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';
import 'package:bip39/bip39.dart' as bip39;
import 'package:bip32/bip32.dart' as bip32;
import 'package:crypto/crypto.dart';
// lib/ is filled from vfx-gui by gen-wallet-flow-vectors.js (unmodified copies).
import '../lib/private_key_text.dart';
import '../lib/recovery_phrase.dart';

// Verbatim from vfx-gui origin/testnet lib/features/auth/auth_utils.dart handleCreateWithEmail (seed part).
String emailSeed(String emailValue, String passwordValue) {
  String email = emailValue.toLowerCase();
  String password = passwordValue;

  String seed = "$email|$password|";
  seed = "$seed${seed.length}|!@${((password.length * 7) + email.length) * 7}";

  final regChars = RegExp(r'/[a-z]+/g');
  final regUpperChars = RegExp(r'/[A-Z]+/g');
  final regNumbers = RegExp(r'/[0-9]+/g');

  final chars =
      regChars.hasMatch(password) ? regChars.allMatches(password).length : 1;
  final upperChars = regUpperChars.hasMatch(password)
      ? regUpperChars.allMatches(password).length
      : 1;
  final upperNumbers = regNumbers.hasMatch(password)
      ? regNumbers.allMatches(password).length
      : 1;

  // var append = 3571;
  seed = "$seed${(chars + upperChars + upperNumbers) * password.length}3571";

  // seed = "${seedPriorToSha}3571";
  seed = "$seed$seed";

  for (int i = 0; i <= 50; i++) {
    seed = sha256.convert(utf8.encode(seed)).toString();
  }
  return seed;
}

// Verbatim from keygen_service.dart _mneumonicToKeypair (derivation part).
String? mnemonicPrivate(String mnemonic, int index) {
    final isValid = bip39.validateMnemonic(mnemonic);

    if (!isValid) {
      return null;
    }

    final Uint8List seed = bip39.mnemonicToSeed(mnemonic);

    final bip32.BIP32 root = bip32.BIP32.fromSeed(seed);

    final bip32.BIP32 child = root.derivePath("m/0'/0'/$index'");

    final String privateKey = child.privateKey!.toList().map((e) => e.toRadixString(16).padLeft(2, '0')).join();
  return privateKey;
}

void main(List<String> args) {
  final input = jsonDecode(File(args[0]).readAsStringSync()) as Map<String, dynamic>;
  final out = <String, dynamic>{};
  out['email'] = [
    for (final c in input['email'] as List)
      {'email': c['email'], 'password': c['password'], 'seed': emailSeed(c['email'], c['password'])}
  ];
  out['mnemonic'] = [
    for (final c in input['mnemonic'] as List)
      () {
        final normalized = normalizeRecoveryPhrase(c['phrase']);
        return {
          'phrase': c['phrase'],
          'index': c['index'],
          'normalized': normalized,
          'privateKey': mnemonicPrivate(normalized, c['index']),
        };
      }()
  ];
  out['keyText'] = [
    for (final c in input['keyText'] as List)
      () {
        final canonical = canonicalPrivateKeyHex(c['entered']);
        final candidates = canonical == null ? <String>[] : derivationTextCandidates(canonical, enteredText: c['entered']);
        return {
          'entered': c['entered'],
          'canonical': canonical,
          'candidates': [
            for (final t in candidates)
              {
                'derivationText': t,
                'reserveSeed0': reserveSeedFromDerivationText(t, 0),
                'btcEmail': btcEmailFromDerivationText(t),
                'btcPassword': btcPasswordFromDerivationText(t),
              }
          ],
        };
      }()
  ];
  // privateCorrected -> derivation text, as auth_utils.dart does for generated / mnemonic / email logins.
  out['privateCorrected'] = [
    for (final p in input['privateCorrected'] as List)
      () {
        final String private = p;
        final corrected = private.startsWith("00") ? private : "00$private";
        final text = derivationTextFromKeyText(corrected);
        return {
          'private': private,
          'derivationText': text,
          'btcEmail': btcEmailFromDerivationText(text),
          'btcPassword': btcPasswordFromDerivationText(text),
        };
      }()
  ];
  stdout.write(jsonEncode(out));
}
