// A small TOML reader: enough for pyproject.toml and Cargo.toml.
// Supports [tables], [[arrays of tables]], dotted keys, basic and literal
// strings, multi-line arrays, inline tables, numbers and booleans. It never
// throws: a line it cannot read is skipped, because a partial picture of a
// manifest is still useful for describing a repository.

function stripComment(line) {
  let inStr = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inStr) {
      if (c === '\\' && inStr === '"') i++;
      else if (c === inStr) inStr = null;
    } else if (c === '"' || c === "'") inStr = c;
    else if (c === '#') return line.slice(0, i);
  }
  return line;
}

function splitKey(key) {
  const parts = [];
  let cur = '';
  let q = null;
  for (const c of key.trim()) {
    if (q) {
      if (c === q) q = null;
      else cur += c;
    } else if (c === '"' || c === "'") q = c;
    else if (c === '.') {
      parts.push(cur.trim());
      cur = '';
    } else cur += c;
  }
  parts.push(cur.trim());
  return parts.filter((p) => p !== '');
}

// Parse one value starting at s[i]; returns [value, nextIndex].
function parseValue(s, i) {
  while (s[i] === ' ' || s[i] === '\t' || s[i] === '\n' || s[i] === '\r') i++;
  const c = s[i];
  if (s.startsWith('"""', i) || s.startsWith("'''", i)) {
    const q = s.slice(i, i + 3);
    const end = s.indexOf(q, i + 3);
    const raw = s.slice(i + 3, end === -1 ? s.length : end).replace(/^\r?\n/, '');
    return [raw, end === -1 ? s.length : end + 3];
  }
  if (c === '"') {
    let out = '';
    i++;
    while (i < s.length && s[i] !== '"') {
      if (s[i] === '\\') {
        const n = s[i + 1];
        out += n === 'n' ? '\n' : n === 't' ? '\t' : n;
        i += 2;
      } else out += s[i++];
    }
    return [out, i + 1];
  }
  if (c === "'") {
    const end = s.indexOf("'", i + 1);
    return [s.slice(i + 1, end), end + 1];
  }
  if (c === '[') {
    const arr = [];
    i++;
    for (;;) {
      while (/[\s,]/.test(s[i] ?? '')) i++;
      if (s[i] === '#') {
        while (i < s.length && s[i] !== '\n') i++;
        continue;
      }
      if (s[i] === ']' || i >= s.length) return [arr, i + 1];
      const [v, n] = parseValue(s, i);
      arr.push(v);
      i = n;
    }
  }
  if (c === '{') {
    const obj = {};
    i++;
    for (;;) {
      while (/[\s,]/.test(s[i] ?? '')) i++;
      if (s[i] === '}' || i >= s.length) return [obj, i + 1];
      const eq = s.indexOf('=', i);
      if (eq === -1) return [obj, s.length];
      const keys = splitKey(s.slice(i, eq));
      const [v, n] = parseValue(s, eq + 1);
      setPath(obj, keys, v);
      i = n;
    }
  }
  const m = /^[^,\]}\s]+/.exec(s.slice(i));
  const tok = m ? m[0] : '';
  let v = tok;
  if (tok === 'true') v = true;
  else if (tok === 'false') v = false;
  else if (/^[+-]?\d[\d_]*(\.\d+)?$/.test(tok)) v = Number(tok.replace(/_/g, ''));
  return [v, i + tok.length];
}

function setPath(obj, keys, value) {
  let o = obj;
  for (const k of keys.slice(0, -1)) {
    if (typeof o[k] !== 'object' || o[k] === null) o[k] = {};
    o = Array.isArray(o[k]) ? o[k][o[k].length - 1] : o[k];
  }
  o[keys[keys.length - 1]] = value;
}

function getTable(root, keys, arrayItem) {
  let o = root;
  keys.forEach((k, idx) => {
    const last = idx === keys.length - 1;
    if (last && arrayItem) {
      if (!Array.isArray(o[k])) o[k] = [];
      o[k].push({});
      o = o[k][o[k].length - 1];
      return;
    }
    if (o[k] == null || typeof o[k] !== 'object') o[k] = {};
    o = Array.isArray(o[k]) ? o[k][o[k].length - 1] : o[k];
  });
  return o;
}

/** Bracket depth change on a line, ignoring brackets inside strings. */
function depthDelta(line) {
  let d = 0;
  let q = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '\\' && q === '"') i++;
      else if (c === q) q = null;
    } else if (c === '"' || c === "'") q = c;
    else if (c === '[' || c === '{') d++;
    else if (c === ']' || c === '}') d--;
  }
  return d;
}

export function parseToml(text) {
  const root = {};
  let table = root;
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = stripComment(lines[i]).trim();
    if (!line) continue;
    try {
      const arrHeader = /^\[\[([^\]]+)\]\]$/.exec(line);
      const header = /^\[([^\]]+)\]$/.exec(line);
      if (arrHeader) {
        table = getTable(root, splitKey(arrHeader[1]), true);
        continue;
      }
      if (header) {
        table = getTable(root, splitKey(header[1]), false);
        continue;
      }
      const eq = line.indexOf('=');
      if (eq === -1) continue;
      const keys = splitKey(line.slice(0, eq));
      let rest = line.slice(eq + 1);
      // gather continuation lines for multi-line arrays, inline tables and strings
      let depth = depthDelta(rest);
      let tripleOpen = (rest.match(/"""|'''/g) || []).length % 2 === 1;
      while ((depth > 0 || tripleOpen) && i + 1 < lines.length) {
        i++;
        const next = tripleOpen ? lines[i] : stripComment(lines[i]);
        rest += '\n' + next;
        if (tripleOpen) {
          if (/"""|'''/.test(next)) tripleOpen = false;
        } else depth += depthDelta(next);
      }
      const [value] = parseValue(rest, 0);
      setPath(table, keys, value);
    } catch {
      /* skip unreadable line */
    }
  }
  return root;
}
