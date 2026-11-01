// Android uygulamasının yerel eklentilerini güvenli çağırma.
// DİKKAT: Capacitor eklenti nesnesi bir Proxy'dir; async fonksiyondan döndürülür ya da await edilirse
// JavaScript onu Promise sanıp .then'i çağırır ve sonsuza kadar bekler. Bu yüzden nesne asla döndürülmez,
// yalnızca metotları çağrılır (ayrıntı: printing/labelPrinter.js).

export const isNativeApp = () => !!globalThis.Capacitor?.isNativePlatform?.();

const plugins = {};
async function load(name) {
  if (!plugins[name]) {
    const { registerPlugin } = await import('@capacitor/core');
    plugins[name] = registerPlugin(name);
  }
}

export function withTimeout(promise, ms, message) {
  let t;
  return Promise.race([
    Promise.resolve(promise).finally(() => clearTimeout(t)),
    new Promise((_, reject) => { t = setTimeout(() => reject(new Error(message || 'Zaman aşımı')), ms); }),
  ]);
}

/** Yerel eklenti metodunu zaman aşımıyla çağırır. */
export async function nativeCall(plugin, method, options = {}, ms = 20000) {
  await load(plugin);
  return withTimeout(plugins[plugin][method](options), ms, `${plugin}.${method} yanıt vermedi`);
}

/** Cihaz eklentisi (android/.../DevicePlugin.java) */
export const device = (method, options = {}) => nativeCall('VKDevice', method, options);
