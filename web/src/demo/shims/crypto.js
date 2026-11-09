// Demo / tablet uygulaması: node:crypto'nun sunucu kodunda kullanılan kısmı (senkron SHA-256 / HMAC, scrypt, Ed25519 doğrulama).
import * as ed from '@noble/ed25519';
import { scrypt as nobleScrypt } from '@noble/hashes/scrypt';
import { sha512 } from '@noble/hashes/sha512';
// Not: demo amaçlıdır; gerçek sürüm Node'un scrypt'ini kullanır.
const K = new Uint32Array([0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2]);

function sha256Bytes(bytes) {
  const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const len = bytes.length;
  const total = Math.ceil((len + 9) / 64) * 64;
  const buf = new Uint8Array(total);
  buf.set(bytes);
  buf[len] = 0x80;
  const view = new DataView(buf.buffer);
  view.setUint32(total - 4, len * 8);
  view.setUint32(total - 8, Math.floor((len * 8) / 2 ** 32));
  const W = new Uint32Array(64);
  const rotr = (x, n) => (x >>> n) | (x << (32 - n));
  for (let o = 0; o < total; o += 64) {
    for (let i = 0; i < 16; i++) W[i] = view.getUint32(o + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(W[i - 15], 7) ^ rotr(W[i - 15], 18) ^ (W[i - 15] >>> 3);
      const s1 = rotr(W[i - 2], 17) ^ rotr(W[i - 2], 19) ^ (W[i - 2] >>> 10);
      W[i] = (W[i - 16] + s0 + W[i - 7] + s1) | 0;
    }
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const t1 = (h + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + W[i]) | 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    H[0] += a; H[1] += b; H[2] += c; H[3] += d; H[4] += e; H[5] += f; H[6] += g; H[7] += h;
  }
  const out = new Uint8Array(32);
  const ov = new DataView(out.buffer);
  H.forEach((v, i) => ov.setUint32(i * 4, v));
  return out;
}

const enc = new TextEncoder();
const toBytes = (v) => (v instanceof Uint8Array ? v : enc.encode(String(v)));
const hex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
const wrap = (bytes) => Object.assign(bytes, { toString: () => hex(bytes) });

function hmac(key, data) {
  let k = toBytes(key);
  if (k.length > 64) k = sha256Bytes(k);
  const pad = (c) => { const p = new Uint8Array(64).fill(c); k.forEach((x, i) => { p[i] ^= x; }); return p; };
  const concat = (a, b) => { const o = new Uint8Array(a.length + b.length); o.set(a); o.set(b, a.length); return o; };
  return sha256Bytes(concat(pad(0x5c), sha256Bytes(concat(pad(0x36), toBytes(data)))));
}

// update(): metin ya da bayt; digest('hex') metin, digest() bayt (Node'daki gibi Buffer benzeri)
const digester = (fn) => {
  const parts = [];
  const o = {
    update: (d) => { parts.push(d instanceof Uint8Array ? d : d && d.__bytes ? d.__bytes : toBytes(String(d))); return o; },
    digest: (encoding) => {
      const all = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
      let off = 0; for (const p of parts) { all.set(p, off); off += p.length; }
      const out = fn(all);
      return encoding === 'hex' ? hex(out) : globalThis.Buffer.from(out);
    },
  };
  return o;
};

export const randomBytes = (n) => wrap(globalThis.crypto.getRandomValues(new Uint8Array(n)));
export const randomUUID = () => globalThis.crypto.randomUUID();
export const createHash = () => digester((b) => sha256Bytes(b));
export const createHmac = (_alg, key) => digester((b) => hmac(key, b));
// Gerçek scrypt (Node'un scryptSync varsayılanlarıyla aynı: N=16384, r=8, p=1): tablette kaydedilen PIN'ler
// sunucuya taşınınca da doğrulanabilsin.
export const scryptSync = (secret, salt, keylen = 32) => wrap(nobleScrypt(toBytes(String(secret)), toBytes(String(salt)), { N: 16384, r: 8, p: 1, dkLen: keylen }));
const bytesOf = (v) => (v instanceof Uint8Array ? v : v && v.__bytes ? v.__bytes : toBytes(String(v)));
export const timingSafeEqual = (a, b) => {
  const x = bytesOf(a); const y = bytesOf(b);
  if (x.length !== y.length) return false;
  let d = 0;
  for (let i = 0; i < x.length; i++) d |= x[i] ^ y[i];
  return d === 0;
};

// Lisans imzası (Ed25519) doğrulama: anahtar PEM (SPKI) → son 32 bayt ham açık anahtar
ed.etc.sha512Sync = (...m) => sha512(ed.etc.concatBytes(...m));
export function verify(_alg, data, keyPem, sig) {
  const der = Uint8Array.from(atob(String(keyPem).replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')), (c) => c.charCodeAt(0));
  return ed.verify(bytesOf(sig), bytesOf(data), der.slice(-32));
}

// Sunucu kodundaki Buffer kullanımı için küçük bir karşılık (hex / base64 / utf8)
if (!globalThis.Buffer) {
  const fromHex = (s) => Uint8Array.from(String(s).match(/../g) || [], (h) => parseInt(h, 16));
  const make = (bytes) => ({
    __bytes: bytes, length: bytes.length,
    toString: (encoding) => (encoding === 'hex' ? hex(bytes) : encoding === 'base64' ? btoa(String.fromCharCode(...bytes)) : new TextDecoder().decode(bytes)),
  });
  globalThis.Buffer = {
    from: (v, encoding) => {
      if (v instanceof Uint8Array) return make(v);
      if (v && v.__bytes) return make(v.__bytes);
      if (encoding === 'hex') return make(fromHex(v));
      if (encoding === 'base64') return make(Uint8Array.from(atob(String(v)), (c) => c.charCodeAt(0)));
      return make(toBytes(String(v)));
    },
  };
}

export default { randomBytes, randomUUID, createHash, createHmac, scryptSync, timingSafeEqual, verify };
