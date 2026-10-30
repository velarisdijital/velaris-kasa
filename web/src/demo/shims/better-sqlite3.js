// Demo: better-sqlite3 API'sinin sql.js (WebAssembly SQLite) üzerine uyarlaması.
let SQL = null;
let initialBytes = null;
export function useSqlJs(sqlModule, bytes) { SQL = sqlModule; initialBytes = bytes; }

// sql.js içinde 'localtime' UTC döner; tarayıcının saat dilimini elle ekliyoruz.
const tz = () => `'${-new Date().getTimezoneOffset()} minutes'`;
const fixSql = (sql) => sql.replace(/'now',\s*'localtime'/g, () => `'now',${tz()}`);

function bindArgs(args) {
  if (args.length === 1 && args[0] && typeof args[0] === 'object' && !Array.isArray(args[0])) {
    const out = {};
    for (const [k, v] of Object.entries(args[0])) {
      const val = v === undefined ? null : typeof v === 'boolean' ? Number(v) : v;
      out[`@${k}`] = val;
      out[`:${k}`] = val;
      out[`$${k}`] = val;
    }
    return out;
  }
  return args.map((v) => (v === undefined ? null : typeof v === 'boolean' ? Number(v) : v));
}

export default class Database {
  constructor() {
    this.raw = new SQL.Database(initialBytes || undefined);
    this.depth = 0;
  }
  pragma(s) { try { this.raw.run(`PRAGMA ${s}`); } catch { /* WAL vb. desteklenmeyebilir */ } }
  exec(sql) { this.raw.exec(fixSql(sql)); }
  close() { this.raw.close(); }
  export() { return this.raw.export(); }
  async backup() { throw Object.assign(new Error('Demoda yedek indirme kapalı'), { status: 400 }); }
  prepare(sql) {
    const db = this.raw;
    const text = fixSql(sql);
    const withStmt = (args, fn) => {
      const st = db.prepare(text);
      try {
        const b = bindArgs(args);
        if (Array.isArray(b) ? b.length : Object.keys(b).length) st.bind(b);
        return fn(st);
      } finally { st.free(); }
    };
    return {
      get: (...args) => withStmt(args, (st) => (st.step() ? st.getAsObject() : undefined)),
      all: (...args) => withStmt(args, (st) => { const rows = []; while (st.step()) rows.push(st.getAsObject()); return rows; }),
      run: (...args) => withStmt(args, (st) => {
        st.step();
        const changes = db.getRowsModified();
        const lastInsertRowid = db.exec('SELECT last_insert_rowid()')[0].values[0][0];
        return { changes, lastInsertRowid };
      }),
    };
  }
  transaction(fn) {
    return (...args) => {
      const name = `sp${this.depth++}`;
      this.raw.run(`SAVEPOINT ${name}`);
      try {
        const out = fn(...args);
        this.raw.run(`RELEASE ${name}`);
        return out;
      } catch (e) {
        this.raw.run(`ROLLBACK TO ${name}`);
        this.raw.run(`RELEASE ${name}`);
        throw e;
      } finally {
        this.depth--;
      }
    };
  }
}
