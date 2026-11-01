// Applies French typography inside the string literals of src/textes/fr.ts:
// no-break spaces before « : » and inside « », narrow no-break spaces before « ; » and « ? »,
// typographic apostrophe and ellipsis. Code outside strings is left untouched.
// Usage: npm run texts:fix
import { readFileSync, writeFileSync } from 'node:fs';
import ts from 'typescript';

const FILE = new URL('../src/textes/fr.ts', import.meta.url);
const NBSP = '\u00a0';
const NNBSP = '\u202f';

function fixText(text) {
  return text
    .replace(/\\'|'/g, '’')
    .replace(/\.\.\./g, '…')
    .replace(/[ \u00a0\u202f]*:(?=\s|$)/g, `${NBSP}:`)
    .replace(/[ \u00a0\u202f]*([;?])/g, `${NNBSP}$1`)
    .replace(/«[ \u00a0\u202f]*/g, `«${NBSP}`)
    .replace(/[ \u00a0\u202f]*»/g, `${NBSP}»`);
}

// [opening delimiter length, closing delimiter length] of each literal kind.
const DELIMITERS = new Map([
  [ts.SyntaxKind.StringLiteral, [1, 1]],
  [ts.SyntaxKind.NoSubstitutionTemplateLiteral, [1, 1]],
  [ts.SyntaxKind.TemplateHead, [1, 2]],
  [ts.SyntaxKind.TemplateMiddle, [1, 2]],
  [ts.SyntaxKind.TemplateTail, [1, 1]],
]);

const source = readFileSync(FILE, 'utf8');
const sourceFile = ts.createSourceFile('fr.ts', source, ts.ScriptTarget.Latest, true);
const edits = [];

function visit(node) {
  const delimiters = DELIMITERS.get(node.kind);
  // Import specifiers and the like are not user texts.
  const isUserText = delimiters && !ts.isImportDeclaration(node.parent) && !ts.isExportDeclaration(node.parent);
  if (isUserText) {
    const start = node.getStart(sourceFile) + delimiters[0];
    const end = node.getEnd() - delimiters[1];
    const original = source.slice(start, end);
    const fixed = fixText(original);
    if (fixed !== original) edits.push({ start, end, fixed });
  }
  ts.forEachChild(node, visit);
}
visit(sourceFile);

let output = source;
for (const { start, end, fixed } of edits.sort((a, b) => b.start - a.start)) {
  output = output.slice(0, start) + fixed + output.slice(end);
}

if (output === source) {
  console.log('Aucune correction nécessaire.');
} else {
  writeFileSync(FILE, output);
  console.log(`${edits.length} texte(s) corrigé(s) dans src/textes/fr.ts.`);
}
