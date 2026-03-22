import { readFile, writeFile, mkdir, copyFile, access } from "fs/promises";
import { resolve, dirname } from "path";
import { glob } from "glob";
import { minify as terserMinify } from "terser";
import postcss from "postcss";
import cssnano from "cssnano";

const SITE_NAME = "Black Velvet";
const PARTIALS_DIR = "PARTIALS";
const BUILD_DIR = "dist";
const SITE_BASE = "/blackv/";
const CSS_ENTRY = "main.css";
const JS_ENTRY = "app.js";

console.log(`🤖 Iniciando robot armador ${SITE_NAME} v3.1...`);

async function exists(file) {
  try {
    await access(resolve(file));
    return true;
  } catch {
    return false;
  }
}
 
function showContext(src, line, col, radius = 4) {
  const L = Number(line || 0);
  const C = Number(col || 0);
  const lines = src.split(/\r?\n/);
  const start = Math.max(0, L - 1 - radius);
  const end = Math.min(lines.length, L - 1 + radius + 1);
  const block = lines
    .slice(start, end)
    .map((text, i) => {
      const n = start + i + 1;
      return `${n === L ? " >>" : "   "} ${String(n).padStart(4, " ")} | ${text}`;
    })
    .join("\n");

  console.log(block);
  if (L > 0) console.log(" ".repeat(9 + C) + "^");
}

async function minifyJsOrThrow(file, src) {
  try {
    const result = await terserMinify(src, {
      ecma: 2020,
      module: false,
      compress: true,
      mangle: true,
      format: { comments: false }
    });

    if (!result || typeof result.code !== "string") {
      throw new Error("Terser no devolvió código");
    }

    return result.code;
  } catch (e) {
    console.error(`\n❌ Terser error en: ${file}`);
    console.error(`${e.name || "Error"}: ${e.message || e}`);

    if (typeof e.line === "number") {
      console.error(`Línea ${e.line}, Col ${e.col || 0}\n`);
      showContext(src, e.line, e.col || 0);
      console.error("\n💡 Revisa comas faltantes, texto incrustado no-JS o llaves/paréntesis sin cerrar.");
    }
    throw e;
  }
}

const RX = {
  headOpen: /<head(\s[^>]*)?>/i,
  charset: /<meta\b[^>]*charset=/i,
  viewport: /<meta\b[^>]*name=["']viewport["']/i,
  base: /<meta\b[^>]*name=["']site-base["']/i,
  headClose: /<\/head>/i
};

function normalizeHead(html, file) {
  if (!RX.headOpen.test(html)) return html;

  const adds = [];
  if (!RX.charset.test(html)) {
    adds.push(`<meta charset="utf-8" />`);
  }
  if (!RX.base.test(html)) {
    adds.push(`<meta name="site-base" content="${SITE_BASE}" />`);
  }
  if (!RX.viewport.test(html)) {
    adds.push(`<meta name="viewport" content="width=device-width, initial-scale=1" />`);
  }

  if (!adds.length) return html;

  console.log(`🔧 HEAD normalized: ${file} (+${adds.length})`);
  return html.replace(RX.headOpen, (m) => `${m}\n  ${adds.join("\n  ")}\n`);
}

function injectHeadPartial(html, headPartial) {
  if (html.includes("<!-- HEAD_PLACEHOLDER -->")) {
    return html.replace("<!-- HEAD_PLACEHOLDER -->", headPartial);
  }
  return html;
}

function optimizeHtml(html, headPartial, header, footer) {
  let out = html;

  out = injectHeadPartial(out, headPartial);
  out = out.replace(/<div id="header-placeholder"><\/div>/g, header);
  out = out.replace(/<div id="footer-placeholder"><\/div>/g, footer);

  out = out.replace(/<script>[\s\S]*?loadPartials[\s\S]*?<\/script>/g, "");
  out = out.replace(/<iframe(?![^>]*loading=)/g, '<iframe loading="lazy"');
  out = out.replace(/<video(?![^>]*preload=)/g, '<video preload="none"');

  return out;
}

async function buildSite() {
  try {
    const hasHead = await exists(`${PARTIALS_DIR}/global-head.html`);
    const hasHeader = await exists(`${PARTIALS_DIR}/global-header.html`);
    const hasFooter = await exists(`${PARTIALS_DIR}/global-footer.html`);
    const hasCss = await exists(CSS_ENTRY);
    const hasJs = await exists(JS_ENTRY);

    if (!hasHead) throw new Error(`Falta ${PARTIALS_DIR}/global-head.html`);
    if (!hasHeader) throw new Error(`Falta ${PARTIALS_DIR}/global-header.html`);
    if (!hasFooter) throw new Error(`Falta ${PARTIALS_DIR}/global-footer.html`);
    if (!hasCss) throw new Error(`Falta ${CSS_ENTRY}`);
    if (!hasJs) throw new Error(`Falta ${JS_ENTRY}`);

    const headPartial = await readFile(resolve(PARTIALS_DIR, "global-head.html"), "utf8");
    const header = await readFile(resolve(PARTIALS_DIR, "global-header.html"), "utf8");
    const footer = await readFile(resolve(PARTIALS_DIR, "global-footer.html"), "utf8");

    console.log("⚙️ 1/4 Parciales cargados.");

    const htmlFiles = await glob("**/*.html", {
      ignore: [`${PARTIALS_DIR}/**`, `${BUILD_DIR}/**`, "node_modules/**"]
    });

    console.log(`⚙️ 2/4 Procesando ${htmlFiles.length} HTML...`);

    for (const file of htmlFiles) {
      let html = await readFile(file, "utf8");

      html = normalizeHead(html, file);
      html = optimizeHtml(html, headPartial, header, footer);

      const out = resolve(BUILD_DIR, file);
      await mkdir(dirname(out), { recursive: true });
      await writeFile(out, html, "utf8");
    }

    console.log("✅ HTML ensamblado.");

    const assets = await glob("**/*.{png,jpg,jpeg,webp,avif,svg,ico,json,webmanifest,pdf,woff,woff2}", {
      ignore: [
        `${PARTIALS_DIR}/**`,
        `${BUILD_DIR}/**`,
        "node_modules/**",
        "build.js",
        "package*.json",
        CSS_ENTRY,
        JS_ENTRY
      ]
    });

    console.log(`⚙️ 3/4 Copiando ${assets.length} assets...`);

    for (const file of assets) {
      const out = resolve(BUILD_DIR, file);
      await mkdir(dirname(out), { recursive: true });
      await copyFile(file, out);
    }

    console.log("✅ Assets copiados.");
    console.log(`⚙️ 4/4 Minificando ${CSS_ENTRY} + ${JS_ENTRY}...`);

    {
      const src = await readFile(resolve(CSS_ENTRY), "utf8");
      const out = resolve(BUILD_DIR, CSS_ENTRY);
      const result = await postcss([cssnano]).process(src, { from: CSS_ENTRY, to: out });

      await mkdir(dirname(out), { recursive: true });
      await writeFile(out, result.css, "utf8");
    }

    {
      const src = await readFile(resolve(JS_ENTRY), "utf8");
      const out = resolve(BUILD_DIR, JS_ENTRY);
      const min = await minifyJsOrThrow(JS_ENTRY, src);

      await mkdir(dirname(out), { recursive: true });
      await writeFile(out, min, "utf8");
    }

    console.log("✅ CSS y JS minificados.");
    console.log(`\n🚀 Build ${SITE_NAME} v3.1 COMPLETADO`);
    console.log(`📦 Output: /${BUILD_DIR}`);
    console.log(`🌐 Base actual: ${SITE_BASE}`);
  } catch (e) {
    console.error("❌ Build falló:", e);
    process.exit(1);
  }
}

buildSite();
