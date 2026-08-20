/**
 * Generates shared/fonts.ts from the installed font packages.
 *
 * The printed invoice must be a self-contained document — it is rendered from a
 * temp file with no network and no relative assets — so the faces are inlined as
 * data URIs. This also makes the bill render identically on Windows and macOS
 * instead of falling back to whatever each platform happens to have installed.
 *
 * Re-run with `npm run fonts` after changing a font dependency.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const faces = [
  {
    constant: 'SERIF_600',
    file: 'node_modules/@fontsource/cormorant-garamond/files/cormorant-garamond-latin-600-normal.woff2',
  },
  {
    constant: 'SANS_VARIABLE',
    file: 'node_modules/@fontsource-variable/manrope/files/manrope-latin-wght-normal.woff2',
  },
];

const parts = faces.map(({ constant, file }) => {
  const bytes = fs.readFileSync(path.join(root, file));
  return `/** ${path.basename(file)} — ${(bytes.length / 1024).toFixed(1)}KB */\nconst ${constant} =\n  '${bytes.toString('base64')}';`;
});

const output = `/**
 * GENERATED FILE — do not edit by hand. Run \`npm run fonts\` to regenerate.
 *
 * Font faces inlined as base64 so the printed invoice stays a self-contained
 * document with no external requests, and renders identically on every machine.
 *
 * Cormorant Garamond and Manrope are both licensed under the SIL Open Font
 * License 1.1, which permits embedding.
 */

${parts.join('\n\n')}

/** @font-face rules for the printed invoice, inlined into the document head. */
export const INVOICE_FONT_FACES = \`
  @font-face {
    font-family: 'PJ Serif';
    font-style: normal;
    font-weight: 600;
    font-display: block;
    src: url(data:font/woff2;base64,\${SERIF_600}) format('woff2');
  }
  @font-face {
    font-family: 'PJ Sans';
    font-style: normal;
    font-weight: 200 800;
    font-display: block;
    src: url(data:font/woff2;base64,\${SANS_VARIABLE}) format('woff2');
  }
\`;

/** Stacks used by the printed invoice, with platform fallbacks. */
export const INVOICE_SERIF_STACK = "'PJ Serif', 'Cormorant Garamond', Georgia, 'Times New Roman', serif";
export const INVOICE_SANS_STACK =
  "'PJ Sans', 'Manrope', 'Segoe UI', -apple-system, 'Helvetica Neue', Arial, sans-serif";
`;

fs.writeFileSync(path.join(root, 'shared/fonts.ts'), output);
console.log(`shared/fonts.ts written — ${(output.length / 1024).toFixed(0)}KB`);
