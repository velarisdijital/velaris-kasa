// Tablet uygulamasının (tarayıcı) node:crypto karşılığı sunucuyla aynı sonucu vermeli:
// PIN'ler sunucuya taşınınca doğrulanabilsin, lisans imzası tablette doğrulanabilsin.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { test } from 'node:test';
import * as shim from '../web/src/demo/shims/crypto.js';
import { verifySecret, needsRehash, hashSecret } from '../server/auth.js';
import { signLicense } from '../server/license.js';

test('scrypt: tarayıcı karşılığı Node ile aynı', () => {
  const a = shim.scryptSync('1234', 'abcd1234salt', 32).toString('hex');
  const b = crypto.scryptSync('1234', 'abcd1234salt', 32).toString('hex');
  assert.equal(a, b);
});

test('Ed25519 lisans imzası tarayıcı karşılığıyla doğrulanır', () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const key = signLicense({ lic: 'T1', plan: 'pro' }, privateKey.export({ type: 'pkcs8', format: 'pem' }));
  const [, data, sig] = key.split('.');
  const sigBytes = Uint8Array.from(atob(sig.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
  const pem = publicKey.export({ type: 'spki', format: 'pem' });
  assert.equal(shim.verify(null, new TextEncoder().encode(data), pem, sigBytes), true);
  const bad = new TextEncoder().encode(`${data}x`);
  assert.equal(shim.verify(null, bad, pem, sigBytes), false);
  // Depodaki gömülü açık anahtar da okunabilir PEM
  assert.match(fs.readFileSync('server/license-public.pem', 'utf8'), /BEGIN PUBLIC KEY/);
});

test('eski tablet PIN biçimi kabul edilir ve yeniden saklanmalı işaretlenir', () => {
  // Eski biçim: sha256 zinciri (salt:secret, 2000 tur)
  const salt = 'deadbeefdeadbeef';
  let b = Buffer.from(`${salt}:5678`);
  for (let i = 0; i < 2000; i++) b = crypto.createHash('sha256').update(b).digest();
  const legacy = `${salt}:${b.toString('hex')}`;
  assert.equal(verifySecret('5678', legacy), true);
  assert.equal(verifySecret('0000', legacy), false);
  assert.equal(needsRehash('5678', legacy), true);
  const fresh = hashSecret('5678');
  assert.equal(verifySecret('5678', fresh), true);
  assert.equal(needsRehash('5678', fresh), false);
});
