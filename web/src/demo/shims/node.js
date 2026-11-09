// Demo: node:fs / node:path / node:os / node:url yerine geçen küçük parçalar.
import schema from '../../../../server/schema.sql?raw';
import licensePublicKey from '../../../../server/license-public.pem?raw';

export const readFileSync = (p) => {
  if (String(p).endsWith('schema.sql')) return schema;
  if (String(p).endsWith('license-public.pem')) return licensePublicKey;
  throw new Error(`Demoda dosya okunamaz: ${p}`);
};
export const mkdirSync = () => {};
export const existsSync = () => false;
export const rm = (_p, _o, cb) => cb?.();
export const join = (...parts) => parts.join('/').replace(/\/+/g, '/');
export const dirname = (p) => String(p).split('/').slice(0, -1).join('/') || '/';
export const fileURLToPath = (u) => String(u);
export const pathToFileURL = (p) => ({ href: p });
export const tmpdir = () => '/tmp';
export const networkInterfaces = () => ({});

const all = { readFileSync, mkdirSync, existsSync, rm, join, dirname, fileURLToPath, pathToFileURL, tmpdir, networkInterfaces };
export default all;
