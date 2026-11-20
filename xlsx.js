// Mini libreria Excel (.xlsx) senza dipendenze: scrive e legge fogli semplici.
// Scrittura: zip "stored" (senza compressione). Lettura: zip con o senza compressione
// (DecompressionStream "deflate-raw", disponibile su Safari/iPhone recenti, Chrome e Node).
// Usata da Admin → Backup per esportare e ripristinare i dati.

const enc = new TextEncoder();
const dec = new TextDecoder();

// ---------------------------------------------------------------- Date (sistema 1900 di Excel)
const EPOCH = Date.UTC(1899, 11, 30);
export function dateToSerial(d) {
  const ms = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds());
  return (ms - EPOCH) / 86400000;
}
export function serialToDate(n) {
  const u = new Date(EPOCH + Math.round(n * 86400000));
  return new Date(u.getUTCFullYear(), u.getUTCMonth(), u.getUTCDate(), u.getUTCHours(), u.getUTCMinutes(), u.getUTCSeconds());
}

// ---------------------------------------------------------------- XML
const xesc = (s) => String(s)
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
  .replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const xunesc = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, e) => {
  if (e[0] === "#") return String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
  return { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" }[e.toLowerCase()];
});
const colName = (i) => { let s = ""; i++; while (i) { const r = (i - 1) % 26; s = String.fromCharCode(65 + r) + s; i = Math.floor((i - 1) / 26); } return s; };
const colIndex = (ref) => { let n = 0; for (const ch of ref.replace(/\d+/g, "")) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };

// ---------------------------------------------------------------- ZIP
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(b) { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

function zipStored(files) {
  const parts = [], central = [];
  let offset = 0;
  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  for (const [name, text] of files) {
    const nameB = enc.encode(name), data = enc.encode(text), crc = crc32(data);
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true);
    h.setUint16(10, dosTime, true); h.setUint16(12, dosDate, true); h.setUint32(14, crc, true);
    h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, nameB.length, true); h.setUint16(28, 0, true);
    parts.push(new Uint8Array(h.buffer), nameB, data);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, 0, true);
    c.setUint16(12, dosTime, true); c.setUint16(14, dosDate, true); c.setUint32(16, crc, true);
    c.setUint32(20, data.length, true); c.setUint32(24, data.length, true); c.setUint16(28, nameB.length, true);
    c.setUint32(42, offset, true);
    central.push(new Uint8Array(c.buffer), nameB);
    offset += 30 + nameB.length + data.length;
  }
  const cSize = central.reduce((s, p) => s + p.length, 0);
  const e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true);
  e.setUint32(12, cSize, true); e.setUint32(16, offset, true);
  const all = [...parts, ...central, new Uint8Array(e.buffer)];
  const out = new Uint8Array(all.reduce((s, p) => s + p.length, 0));
  let o = 0; for (const p of all) { out.set(p, o); o += p.length; }
  return out;
}

async function inflateRaw(data) {
  const ds = new DecompressionStream("deflate-raw");
  const stream = new Blob([data]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function unzip(buf) {
  const b = new Uint8Array(buf), v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 66000); i--) if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error("Il file non è un Excel (.xlsx) valido");
  const count = v.getUint16(eocd + 10, true);
  let p = v.getUint32(eocd + 16, true);
  const files = {};
  for (let n = 0; n < count; n++) {
    if (v.getUint32(p, true) !== 0x02014b50) break;
    const method = v.getUint16(p + 10, true), csize = v.getUint32(p + 20, true);
    const nlen = v.getUint16(p + 28, true), xlen = v.getUint16(p + 30, true), clen = v.getUint16(p + 32, true);
    const local = v.getUint32(p + 42, true);
    const name = dec.decode(b.subarray(p + 46, p + 46 + nlen));
    const start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
    const raw = b.subarray(start, start + csize);
    files[name] = { method, raw };
    p += 46 + nlen + xlen + clen;
  }
  return {
    has: (name) => !!files[name],
    async text(name) {
      const f = files[name]; if (!f) return null;
      if (f.method === 0) return dec.decode(f.raw);
      if (f.method === 8) return dec.decode(await inflateRaw(f.raw));
      throw new Error("Compressione del file non supportata");
    }
  };
}

// ---------------------------------------------------------------- Scrittura
// sheets: [{ name, rows: [[valore, ...], ...], widths: [num, ...], header: true }]
// valori: stringa, numero, Date, null/undefined (cella vuota)
export function writeXlsx(sheets) {
  const sheetXml = (sh) => {
    const rows = sh.rows.map((row, r) => {
      const cells = row.map((v, c) => {
        if (v === null || v === undefined || v === "") return "";
        const ref = colName(c) + (r + 1);
        const hs = sh.header && r === 0 ? 1 : 0;
        if (v instanceof Date) {
          const hasTime = v.getHours() || v.getMinutes() || v.getSeconds();
          const noon = v.getHours() === 12 && !v.getMinutes() && !v.getSeconds();
          return `<c r="${ref}" s="${hasTime && !noon ? 3 : 2}"><v>${dateToSerial(v)}</v></c>`;
        }
        if (typeof v === "number" && isFinite(v)) return `<c r="${ref}"${hs ? ` s="${hs}"` : ""}><v>${v}</v></c>`;
        return `<c r="${ref}" t="inlineStr"${hs ? ` s="${hs}"` : ""}><is><t xml:space="preserve">${xesc(v)}</t></is></c>`;
      }).join("");
      return `<row r="${r + 1}">${cells}</row>`;
    }).join("");
    const ncol = Math.max(1, ...sh.rows.map((r) => r.length));
    const cols = sh.widths ? `<cols>${sh.widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")}</cols>` : "";
    const freeze = sh.header ? `<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` : `<sheetViews><sheetView workbookViewId="0"/></sheetViews>`;
    const filter = sh.header && sh.rows.length > 1 ? `<autoFilter ref="A1:${colName(ncol - 1)}${sh.rows.length}"/>` : "";
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">${freeze}${cols}<sheetData>${rows}</sheetData>${filter}</worksheet>`;
  };
  const files = [
    ["[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`],
    ["_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ["xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s, i) => `<sheet name="${xesc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>`],
    ["xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
    ["xl/styles.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="2"><numFmt numFmtId="164" formatCode="dd/mm/yyyy"/><numFmt numFmtId="165" formatCode="dd/mm/yyyy hh:mm"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE9E5FF"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`],
    ...sheets.map((s, i) => [`xl/worksheets/sheet${i + 1}.xml`, sheetXml(s)])
  ];
  return zipStored(files);
}

// ---------------------------------------------------------------- Lettura
// Restituisce { "Nome foglio": [[valore, ...], ...] }. Le celle formattate come data diventano Date.
export async function readXlsx(buf) {
  const z = await unzip(buf);
  const wb = await z.text("xl/workbook.xml");
  if (!wb) throw new Error("Il file non è un Excel (.xlsx) valido");
  const rels = (await z.text("xl/_rels/workbook.xml.rels")) || "";
  const relMap = {};
  for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = /\bId="([^"]+)"/.exec(m[0])?.[1], target = /\bTarget="([^"]+)"/.exec(m[0])?.[1];
    if (id && target) relMap[id] = target.startsWith("/") ? target.slice(1) : "xl/" + target.replace(/^\.\//, "");
  }
  // Testi condivisi
  const shared = [];
  const ss = await z.text("xl/sharedStrings.xml");
  if (ss) for (const si of ss.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
    const body = si[1].replace(/<rPh\b[\s\S]*?<\/rPh>/g, "");
    shared.push([...body.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((t) => xunesc(t[1])).join(""));
  }
  // Stili data
  const dateStyles = new Set();
  const st = await z.text("xl/styles.xml");
  if (st) {
    const custom = {};
    for (const m of st.matchAll(/<numFmt\b[^>]*numFmtId="(\d+)"[^>]*formatCode="([^"]*)"/g)) custom[m[1]] = xunesc(m[2]);
    const isDateFmt = (id) => (id >= 14 && id <= 22) || (id >= 45 && id <= 47) || (custom[id] && /[dmyhs]/i.test(custom[id].replace(/"[^"]*"|\[[^\]]*\]/g, "")) && !/^[#0.,%\s]*$/.test(custom[id]));
    const cellXfs = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(st)?.[1] || "";
    [...cellXfs.matchAll(/<xf\b[^>]*?(\/>|>)/g)].forEach((m, i) => { const id = Number(/numFmtId="(\d+)"/.exec(m[0])?.[1] || 0); if (isDateFmt(id)) dateStyles.add(i); });
  }
  const out = {};
  for (const m of wb.matchAll(/<sheet\b[^>]*>/g)) {
    const name = xunesc(/\bname="([^"]*)"/.exec(m[0])?.[1] || "");
    const rid = /\br:id="([^"]+)"/.exec(m[0])?.[1] || /\bid="([^"]+)"/.exec(m[0])?.[1];
    const path = relMap[rid]; if (!path) continue;
    const xml = await z.text(path); if (!xml) continue;
    const rows = [];
    for (const rm of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
      const rnum = Number(/\br="(\d+)"/.exec(rm[1])?.[1] || rows.length + 1);
      const row = [];
      let ci = 0;
      for (const cm of (rm[2] || "").matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = cm[1], body = cm[2] || "";
        const ref = /\br="([A-Z]+\d+)"/.exec(attrs)?.[1];
        const c = ref ? colIndex(ref) : ci;
        ci = c + 1;
        const t = /\bt="([^"]+)"/.exec(attrs)?.[1] || "n";
        const s = Number(/\bs="(\d+)"/.exec(attrs)?.[1] || 0);
        const vRaw = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
        let val = null;
        if (t === "inlineStr") val = [...body.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((x) => xunesc(x[1])).join("");
        else if (t === "s") val = vRaw != null ? shared[Number(vRaw)] ?? "" : "";
        else if (t === "str" || t === "e") val = vRaw != null ? xunesc(vRaw) : "";
        else if (t === "b") val = vRaw === "1";
        else if (t === "d") val = vRaw ? new Date(vRaw) : null;
        else if (vRaw != null && vRaw !== "") { const n = Number(vRaw); val = dateStyles.has(s) ? serialToDate(n) : n; }
        row[c] = val;
      }
      rows[rnum - 1] = row;
    }
    for (let i = 0; i < rows.length; i++) if (!rows[i]) rows[i] = [];
    out[name] = rows;
  }
  return out;
}
