import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build, transform } from "esbuild";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const distDir = path.join(rootDir, "dist");

function escapeInlineScript(value) {
  return value.replace(/<\/script/gi, "<\\/script");
}

function stripAssetLinks(html) {
  return html
    .replace(/^\s*<link rel="manifest".*\n/gm, "")
    .replace(/^\s*<link rel="icon".*\n/gm, "")
    .replace(/^\s*<link rel="apple-touch-icon".*\n/gm, "");
}

async function bundleApp() {
  const result = await build({
    entryPoints: [path.join(rootDir, "app.js")],
    bundle: true,
    format: "esm",
    minify: true,
    target: ["es2022"],
    write: false,
  });

  return result.outputFiles[0].text;
}

async function bundleStyles() {
  const result = await build({
    entryPoints: [path.join(rootDir, "styles.css")],
    bundle: true,
    minify: true,
    write: false,
  });

  return result.outputFiles[0].text;
}

async function bundleWorker() {
  const source = await readFile(path.join(rootDir, "ai-worker.js"), "utf8");
  const result = await transform(source, {
    loader: "js",
    format: "esm",
    minify: true,
    target: "es2022",
  });

  return result.code;
}

async function main() {
  const [htmlTemplate, appCode, styles, workerCode] = await Promise.all([
    readFile(path.join(rootDir, "index.html"), "utf8"),
    bundleApp(),
    bundleStyles(),
    bundleWorker(),
  ]);

  const inlineBootstrap = [
    "<script>",
    "window.__SONICFLOW_SINGLE_FILE__ = true;",
    `window.__SONICFLOW_INLINE_WORKER__ = ${JSON.stringify(escapeInlineScript(workerCode))};`,
    "</script>",
  ].join("");

  const finalHtml = stripAssetLinks(htmlTemplate)
    .replace(
      /<link rel="stylesheet" href="\/styles\.min\.css" \/>/,
      `<style>${styles}</style>`,
    )
    .replace(
      /<script type="module" src="\/app\.min\.js"><\/script>/,
      `${inlineBootstrap}<script type="module">${escapeInlineScript(appCode)}</script>`,
    );

  await mkdir(distDir, { recursive: true });
  await writeFile(path.join(distDir, "sonicflow-single.html"), finalHtml);
  console.log("Wrote dist/sonicflow-single.html");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
