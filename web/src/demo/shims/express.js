// Demo: Express'in sunucu kodunda kullanılan küçük bir alt kümesi (Router + get/post/put/delete/use).
function compile(path) {
  const keys = [];
  const re = new RegExp(`^${path.replace(/\/:([A-Za-z_]+)/g, (_, k) => { keys.push(k); return '/([^/]+)'; })}/?$`);
  return (url) => {
    const m = re.exec(url);
    if (!m) return null;
    return Object.fromEntries(keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
  };
}

function runFns(fns, req, res, next, err) {
  let j = 0;
  const step = (e) => {
    if (res.finished) return;
    const fn = fns[j++];
    if (!fn) return next(e);
    try {
      if (e) { if (fn.length === 4) fn(e, req, res, step); else step(e); }
      else if (fn.length === 4) step();
      else fn(req, res, step);
    } catch (x) { step(x); }
  };
  step(err);
}

export function Router() {
  const stack = [];
  const router = (req, res, done) => {
    let i = 0;
    const next = (err) => {
      if (res.finished) return;
      const layer = stack[i++];
      if (!layer) return done(err);
      if (layer.method && layer.method !== req.method) return next(err);
      if (layer.match) {
        const params = layer.match(req.path);
        if (!params) return next(err);
        req.params = params;
      }
      runFns(layer.fns, req, res, next, err);
    };
    next();
  };
  for (const m of ['get', 'post', 'put', 'delete']) {
    router[m] = (path, ...fns) => { stack.push({ method: m.toUpperCase(), match: compile(path), fns }); return router; };
  }
  router.use = (...fns) => { stack.push({ method: null, match: null, fns }); return router; };
  return router;
}

export default { Router };
