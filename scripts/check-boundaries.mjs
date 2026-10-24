import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const ownPath = fileURLToPath(import.meta.url);
const extensions = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'];

/** Check source imports rather than importing or executing the calculator. */
export function checkBoundaries(projectRoot) {
  const root = path.resolve(projectRoot);
  const sourceRoot = path.join(root, 'src');
  const calculatorRoot = path.join(sourceRoot, 'modules/calculator');
  const entry = path.join(calculatorRoot, 'index.ts');
  const issues = [];
  const visited = new Set();
  const parsed = new Map();
  const configPath = ts.findConfigFile(root, ts.sys.fileExists, 'tsconfig.json');
  const config = configPath ? ts.readConfigFile(configPath, ts.sys.readFile).config : {};
  const options = ts.parseJsonConfigFileContent(config ?? {}, ts.sys, root).options;
  // Keep the fixture-friendly defaults consistent with the repository alias.
  options.baseUrl ??= root;
  options.paths ??= { '@/*': ['./src/*'] };
  options.moduleResolution ??= ts.ModuleResolutionKind.Bundler;

  const relative = (filename) => path.relative(root, filename).split(path.sep).join('/');
  const within = (filename, directory) =>
    filename === directory || filename.startsWith(`${directory}${path.sep}`);
  function report(filename, node, message) {
    const source = getSource(filename);
    const position = source.getLineAndCharacterOfPosition(node.getStart(source));
    issues.push(`${relative(filename)}:${position.line + 1}: ${message}`);
  }
  function getSource(filename) {
    if (!parsed.has(filename)) {
      parsed.set(
        filename,
        ts.createSourceFile(
          filename,
          fs.readFileSync(filename, 'utf8'),
          ts.ScriptTarget.Latest,
          true,
        ),
      );
    }
    return parsed.get(filename);
  }
  function resolve(specifier, filename) {
    const resolved = ts.resolveModuleName(specifier, filename, options, ts.sys).resolvedModule;
    if (resolved) return path.resolve(resolved.resolvedFileName);
    const target = specifier.startsWith('@/')
      ? path.join(sourceRoot, specifier.slice(2))
      : specifier.startsWith('.')
        ? path.resolve(path.dirname(filename), specifier)
        : null;
    if (!target) return null;
    for (const candidate of [
      target,
      ...extensions.map((ext) => `${target}${ext}`),
      ...extensions.map((ext) => path.join(target, `index${ext}`)),
    ]) {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
    }
    return target;
  }
  function dependencies(source, includeTypes) {
    const imports = [];
    function visit(node) {
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
        let typeOnly = node.isTypeOnly === true;
        if (ts.isImportDeclaration(node) && node.importClause) {
          const clause = node.importClause;
          typeOnly =
            clause.isTypeOnly ||
            (!clause.name &&
              clause.namedBindings &&
              ts.isNamedImports(clause.namedBindings) &&
              clause.namedBindings.elements.every((item) => item.isTypeOnly));
        } else if (
          ts.isExportDeclaration(node) &&
          node.exportClause &&
          ts.isNamedExports(node.exportClause)
        ) {
          typeOnly ||= node.exportClause.elements.every((item) => item.isTypeOnly);
        }
        if (
          (includeTypes || !typeOnly) &&
          node.moduleSpecifier &&
          ts.isStringLiteral(node.moduleSpecifier)
        ) {
          imports.push({ specifier: node.moduleSpecifier.text, node });
        }
      } else if (
        ts.isImportEqualsDeclaration(node) &&
        (includeTypes || !node.isTypeOnly) &&
        ts.isExternalModuleReference(node.moduleReference) &&
        node.moduleReference.expression &&
        ts.isStringLiteral(node.moduleReference.expression)
      ) {
        imports.push({ specifier: node.moduleReference.expression.text, node });
      } else if (
        ts.isCallExpression(node) &&
        (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
      ) {
        const argument = node.arguments[0];
        imports.push({
          specifier: argument && ts.isStringLiteralLike(argument) ? argument.text : null,
          node,
        });
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
    return imports;
  }
  function inspectPureSource(filename) {
    const source = getSource(filename);
    const forbiddenGlobals = new Set([
      'Date',
      'fetch',
      'XMLHttpRequest',
      'WebSocket',
      'EventSource',
      'navigator',
      'window',
      'document',
      'localStorage',
      'sessionStorage',
      'performance',
      'process',
      'globalThis',
      'setTimeout',
      'setInterval',
      'requestAnimationFrame',
      'eval',
      'Function',
    ]);
    function visit(node) {
      if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node)) {
        report(filename, node, 'pure calculator must not contain JSX or an implicit UI runtime');
      }
      if (ts.isIdentifier(node) && forbiddenGlobals.has(node.text)) {
        report(
          filename,
          node,
          `pure calculator must not access ${node.text}; inject facts explicitly`,
        );
      }
      if (
        ts.isPropertyAccessExpression(node) &&
        ((ts.isIdentifier(node.expression) &&
          node.expression.text === 'Math' &&
          node.name.text === 'random') ||
          (ts.isIdentifier(node.expression) &&
            node.expression.text === 'crypto' &&
            ['randomUUID', 'getRandomValues'].includes(node.name.text)))
      ) {
        report(filename, node, 'pure calculator must not read randomness');
      }
      if (
        ts.isExpressionStatement(node) &&
        ts.isStringLiteral(node.expression) &&
        ['use client', 'use server'].includes(node.expression.text)
      ) {
        report(filename, node, 'pure calculator must not contain framework directives');
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
    for (const dependency of dependencies(source, false)) {
      const { specifier, node } = dependency;
      if (specifier === 'decimal.js') continue;
      const target = specifier && resolve(specifier, filename);
      if (
        !target ||
        !within(target, calculatorRoot) ||
        (!within(target, path.join(calculatorRoot, 'core')) &&
          !within(target, path.join(calculatorRoot, 'policies'))) ||
        /(?:^|[/\\])(?:[^/\\]*messages|ui|i18n)(?:\.[^.]+)?(?:[/\\]|$)/.test(target)
      ) {
        report(
          filename,
          node,
          `public calculator dependency must stay in pure core/policies: ${specifier ?? '[computed import]'}`,
        );
      } else if (!fs.existsSync(target)) {
        report(filename, node, `unresolved calculator dependency: ${specifier}`);
      } else {
        inspectClosure(target);
      }
    }
  }
  function inspectClosure(filename) {
    if (visited.has(filename)) return;
    visited.add(filename);
    inspectPureSource(filename);
  }
  function walk(directory) {
    if (!fs.existsSync(directory)) return [];
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap((item) => {
      const filename = path.join(directory, item.name);
      return item.isDirectory()
        ? walk(filename)
        : extensions.includes(path.extname(filename))
          ? [filename]
          : [];
    });
  }

  if (!fs.existsSync(entry))
    issues.push('src/modules/calculator/index.ts: public entry is missing');
  else inspectClosure(entry);
  // Route/i18n composition can assemble the page. Other business modules consume
  // the public facade, including types, instead of its UI, policies or internals.
  for (const filename of walk(path.join(sourceRoot, 'modules'))) {
    if (within(filename, calculatorRoot)) continue;
    for (const { specifier, node } of dependencies(getSource(filename), true)) {
      const target = specifier && resolve(specifier, filename);
      if (target && within(target, calculatorRoot) && target !== entry) {
        report(
          filename,
          node,
          `business modules must import calculator through its public entry: ${specifier}`,
        );
      }
    }
  }
  return { issues, files: [...visited].map(relative).sort() };
}

if (process.argv[1] && path.resolve(process.argv[1]) === ownPath) {
  const result = checkBoundaries(process.argv[2] ?? path.dirname(path.dirname(ownPath)));
  if (result.issues.length) {
    console.error(`Module boundary check failed:\n${result.issues.join('\n')}`);
    process.exitCode = 1;
  } else {
    console.log(
      `Module boundaries passed: ${result.files.length} public calculator runtime source files; other business modules use the public entry.`,
    );
  }
}
