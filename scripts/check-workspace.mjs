import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const ownPath = fileURLToPath(import.meta.url);
const codeExtensions = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs']);
const excludedDirectories = new Set([
  'node_modules', '.git', '.next', '.turbo', 'out', 'dist', 'build', 'coverage',
  'test-results', 'playwright-report', 'docs', 'public',
]);
const configName = /^(?:tsconfig|jsconfig)(?:\.[^.]+)*\.json$/;
const dependencyFields = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];
const within = (filename, directory) =>
  filename === directory || filename.startsWith(`${directory}${path.sep}`);

/** Include type-only edges; reading source must never execute app or package code. */
function importsIn(source) {
  const imports = [];
  function add(argument, node) {
    imports.push({
      specifier: argument && ts.isStringLiteralLike(argument) ? argument.text : null,
      // A literal prefix can still expose an obvious computed cross-app import.
      prefix: argument && ts.isTemplateExpression(argument) ? argument.head.text : null,
      node,
    });
  }
  function visit(node) {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
      add(node.moduleSpecifier, node);
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
      add(node.argument.literal, node);
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      add(node.moduleReference.expression, node);
    } else if (ts.isCallExpression(node) && (
      node.expression.kind === ts.SyntaxKind.ImportKeyword ||
      (ts.isIdentifier(node.expression) && node.expression.text === 'require') ||
      (ts.isPropertyAccessExpression(node.expression) &&
        ts.isIdentifier(node.expression.expression) && node.expression.expression.text === 'require' &&
        node.expression.name.text === 'resolve')
    )) {
      add(node.arguments[0], node);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return imports;
}

// exports can be a root target, conditional target, subpath map, or pattern map.
// Null exclusions and the most specific matching pattern must take precedence.
function hasExport(exports, subpath) {
  const usable = (value) => typeof value === 'string' ||
    (Array.isArray(value) && value.some(usable)) ||
    (value !== null && typeof value === 'object' && Object.values(value).some(usable));
  if (!exports || typeof exports !== 'object' || Array.isArray(exports)) {
    return subpath === '.' && usable(exports);
  }
  const keys = Object.keys(exports);
  if (!keys.some((key) => key.startsWith('.'))) return subpath === '.' && usable(exports);
  if (Object.hasOwn(exports, subpath)) return usable(exports[subpath]);
  const patterns = keys.filter((key) => {
    const [prefix, suffix, extra] = key.split('*');
    return suffix !== undefined && extra === undefined && subpath.startsWith(prefix) &&
      subpath.endsWith(suffix) && subpath.length >= prefix.length + suffix.length;
  }).sort((a, b) => b.indexOf('*') - a.indexOf('*') || b.length - a.length);
  return patterns.length > 0 && usable(exports[patterns[0]]);
}

/** Static workspace boundaries, independent of cwd and of installed workspace links. */
export function checkWorkspace(projectRoot) {
  const root = fs.realpathSync(path.resolve(projectRoot));
  const issues = [];
  const files = new Set();
  const configFiles = new Set();
  const computedImports = [];
  const workspaces = [];
  const parsedConfigs = new Map();
  const relative = (filename) => path.relative(root, filename).split(path.sep).join('/');
  const report = (filename, message) => issues.push(`${relative(filename)}: ${message}`);
  const canonical = (filename) => fs.existsSync(filename) ? fs.realpathSync(filename) : filename;

  function walk(directory) {
    if (!fs.existsSync(directory)) return;
    for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
      if (excludedDirectories.has(item.name) || item.name.startsWith('.')) continue;
      const filename = path.join(directory, item.name);
      if (item.isDirectory()) walk(filename);
      else if (item.isFile()) {
        if (codeExtensions.has(path.extname(filename))) files.add(filename);
        if (configName.test(item.name)) configFiles.add(filename);
      } else if (item.isSymbolicLink()) {
        report(filename, 'source symlinks are not scanned; use a workspace package public export');
      }
    }
  }

  for (const group of ['apps', 'packages']) {
    const directory = path.join(root, group);
    if (!fs.existsSync(directory)) continue;
    for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
      if (!item.isDirectory() || item.name.startsWith('.')) continue;
      const workspaceRoot = path.join(directory, item.name);
      const manifestPath = path.join(workspaceRoot, 'package.json');
      let manifest;
      try {
        manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      } catch (error) {
        report(manifestPath, `workspace manifest missing or invalid (${error.code ?? 'invalid JSON'})`);
        continue;
      }
      if (typeof manifest.name !== 'string' || !manifest.name) {
        report(manifestPath, 'workspace manifest requires a package name');
        continue;
      }
      if (workspaces.some((unit) => unit.name === manifest.name)) {
        report(manifestPath, `duplicate workspace package name: ${manifest.name}`);
      }
      const unit = { name: manifest.name, kind: group, root: workspaceRoot, manifest, manifestPath };
      workspaces.push(unit);
      walk(workspaceRoot);
      unit.sourceFiles = [...files].filter((file) => within(file, path.join(workspaceRoot, 'src'))).length;
      unit.codeFiles = [...files].filter((file) => within(file, workspaceRoot)).length;
      unit.reserved = unit.sourceFiles === 0 && manifest.private === true &&
        /\breserved workspace boundary\b/i.test(manifest.description ?? '') &&
        !Object.keys(manifest.scripts ?? {}).length;
      if (!unit.sourceFiles && !unit.reserved) {
        report(manifestPath, 'workspace has no source files; explicitly mark a private reserved workspace without scripts');
      }
    }
  }

  const webRoot = path.join(root, 'apps/web');
  const web = workspaces.find((unit) => unit.root === webRoot);
  if (!web) report(path.join(webRoot, 'package.json'), 'required @hd/web workspace manifest is missing');
  else {
    if (web.name !== '@hd/web') report(web.manifestPath, 'required web package name is @hd/web');
    if (!web.sourceFiles) report(path.join(webRoot, 'src'), 'required web source tree is missing or empty');
  }

  // Root tooling/configs are code too; documentation and generated output are not.
  walk(path.join(root, 'scripts'));
  for (const item of fs.readdirSync(root, { withFileTypes: true })) {
    if (!item.isFile()) continue;
    const filename = path.join(root, item.name);
    if (codeExtensions.has(path.extname(filename))) files.add(filename);
    if (configName.test(item.name)) configFiles.add(filename);
  }
  const ownerOf = (filename) => workspaces.find((unit) => within(filename, unit.root));
  const byName = (specifier) => workspaces.find((unit) =>
    specifier === unit.name || specifier.startsWith(`${unit.name}/`));

  function forbiddenDirection(from, to) {
    if (!from || !to || from === to) return null;
    if (from.kind === 'apps' && to.kind === 'apps') return 'apps must not depend on another app';
    if (from.kind === 'packages' && to.kind === 'apps') return 'packages must not depend on apps';
    return null;
  }

  function checkPath(filename, from, target, specifier, externalLibrary = false) {
    const resolved = canonical(target);
    const to = ownerOf(resolved);
    const direction = forbiddenDirection(from, to);
    if (direction) report(filename, `${direction}: ${specifier}`);
    else if (to?.kind === 'packages' && from !== to) {
      report(filename, `consume ${to.name} through package exports, not a filesystem/tsconfig alias: ${specifier}`);
    } else if (from && !within(resolved, from.root) &&
      !(externalLibrary && resolved.split(path.sep).includes('node_modules'))) {
      // Root code must not act as a bridge between otherwise independent apps.
      // Only named third-party imports resolved inside node_modules are exempt.
      report(filename, `filesystem imports must stay inside ${from.name}; shared code requires a workspace package export: ${specifier}`);
    }
  }

  function configOptions(filename) {
    if (parsedConfigs.has(filename)) return parsedConfigs.get(filename);
    const read = ts.readConfigFile(filename, ts.sys.readFile);
    if (read.error) {
      report(filename, `invalid TypeScript config: ${ts.flattenDiagnosticMessageText(read.error.messageText, ' ')}`);
      parsedConfigs.set(filename, {});
      return {};
    }
    const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, path.dirname(filename), undefined, filename);
    for (const error of parsed.errors) {
      // Reserved packages and alternate configs may intentionally have no inputs.
      if (![18002, 18003].includes(error.code)) {
        report(filename, `invalid TypeScript config: ${ts.flattenDiagnosticMessageText(error.messageText, ' ')}`);
      }
    }
    parsedConfigs.set(filename, parsed.options);
    return parsed.options;
  }

  for (const filename of configFiles) {
    const from = ownerOf(filename);
    const options = configOptions(filename);
    const base = options.baseUrl ?? options.pathsBasePath ?? path.dirname(filename);
    for (const [alias, targets] of Object.entries(options.paths ?? {})) {
      for (const target of targets) {
        const resolved = canonical(path.resolve(base, target.replaceAll('*', '__workspace_alias__')));
        if (from && !within(resolved, from.root)) {
          report(filename, `tsconfig paths must stay inside ${from.name}; use package exports for shared code: ${alias} -> ${target}`);
        } else checkPath(filename, from, resolved, `${alias} -> ${target}`);
      }
    }
  }

  for (const from of workspaces) {
    for (const field of dependencyFields) {
      for (const [name, version] of Object.entries(from.manifest[field] ?? {})) {
        let to = byName(name);
        if (typeof version === 'string') {
          const alias = /^(?:npm:|workspace:)(@[^/]+\/[^@]+|[^@./][^@/]*)@/.exec(version);
          if (alias) to = byName(alias[1]) ?? to;
          const localPath = /^(?:file:|link:)(.+)$/.exec(version) ?? /^workspace:(\.{1,2}\/.+)$/.exec(version);
          if (localPath) {
            to = ownerOf(canonical(path.resolve(from.root, localPath[1]))) ?? to;
          }
        }
        const direction = forbiddenDirection(from, to);
        if (direction) report(from.manifestPath, `${direction} (${field}): ${name}`);
        else if (to?.kind === 'packages' && from !== to &&
          !(typeof version === 'string' && version.startsWith('workspace:'))) {
          report(from.manifestPath, `shared package requires an explicit workspace: dependency on ${to.name} (${field}): ${name}`);
        }
      }
    }
  }

  function optionsFor(filename, unit) {
    let directory = path.dirname(filename);
    const stop = unit?.root ?? root;
    while (within(directory, stop)) {
      for (const name of ['tsconfig.json', 'jsconfig.json']) {
        const config = path.join(directory, name);
        if (configFiles.has(config)) return configOptions(config);
      }
      if (directory === stop) break;
      directory = path.dirname(directory);
    }
    return {};
  }

  for (const filename of [...files].sort()) {
    const from = ownerOf(filename);
    const options = optionsFor(filename, from);
    const source = ts.createSourceFile(filename, fs.readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true);
    const browserContract = from?.name === '@hd/contracts' && within(filename, path.join(from.root, 'src'));
    if (browserContract) {
      function inspect(node) {
        if (ts.isIdentifier(node) && ['process', 'Buffer', 'fetch', 'XMLHttpRequest', 'WebSocket'].includes(node.text)) {
          report(filename, `contracts must be browser-safe and side-effect free: ${node.text}`);
        }
        ts.forEachChild(node, inspect);
      }
      inspect(source);
    }
    for (const dependency of importsIn(source)) {
      const line = source.getLineAndCharacterOfPosition(dependency.node.getStart(source)).line + 1;
      const location = `${filename}:${line}`;
      const specifier = dependency.specifier ?? dependency.prefix;
      if (dependency.specifier === null) {
        computedImports.push(`${relative(filename)}:${line}`);
        const prefixTarget = specifier?.startsWith('.')
          ? path.resolve(path.dirname(filename), specifier)
          : null;
        if (!from || !prefixTarget || !specifier.endsWith('/') || !within(prefixTarget, from.root)) {
          report(location, `computed import requires an app/package-local literal directory prefix; use explicit imports otherwise: ${specifier ?? '[no literal prefix]'}`);
        }
      }
      if (!specifier) continue;
      if (browserContract) {
        const local = specifier.startsWith('.') && within(path.resolve(path.dirname(filename), specifier), path.join(from.root, 'src'));
        if (!local && specifier !== 'zod') report(location, `contracts source may import only its own source and zod: ${specifier}`);
      }
      const named = byName(specifier);
      if (named) {
        const direction = forbiddenDirection(from, named);
        if (direction) report(location, `${direction}: ${specifier}`);
        else {
          if (from && from !== named && named.kind === 'packages' && !dependencyFields.some((field) =>
            typeof from.manifest[field]?.[named.name] === 'string' &&
            from.manifest[field][named.name].startsWith('workspace:'))) {
            report(location, `workspace import requires an explicit workspace: dependency on ${named.name}: ${specifier}`);
          }
          if (!hasExport(named.manifest.exports, specifier === named.name ? '.' : `.${specifier.slice(named.name.length)}`)) {
            report(location, `workspace import is not exposed by ${named.name} package exports: ${specifier}`);
          }
        }
        continue;
      }
      if (specifier.startsWith('.') || path.isAbsolute(specifier)) {
        checkPath(location, from, path.resolve(path.dirname(filename), specifier), specifier);
      }
      const resolved = ts.resolveModuleName(specifier, filename, options, ts.sys).resolvedModule;
      if (resolved) checkPath(location, from, path.resolve(resolved.resolvedFileName), specifier, resolved.isExternalLibraryImport);
    }
  }

  return {
    issues: [...new Set(issues)],
    files: [...files].map(relative).sort(),
    configFiles: [...configFiles].map(relative).sort(),
    computedImports,
    workspaces: workspaces.map(({ name, kind, root: directory, sourceFiles, codeFiles, reserved }) => ({
      name, kind, directory: relative(directory), sourceFiles, codeFiles,
      status: reserved ? 'reserved' : 'source',
    })),
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === ownPath) {
  const result = checkWorkspace(path.dirname(path.dirname(ownPath)));
  console.log(`Workspace scan: ${result.files.length} code files, ${result.configFiles.length} TypeScript configs, ${result.workspaces.length} manifests.`);
  for (const unit of result.workspaces) {
    console.log(`  ${unit.name}: ${unit.sourceFiles} source files; ${unit.status === 'reserved' ? 'reserved, not initialized or functionally validated' : `${unit.codeFiles} code files inspected`}.`);
  }
  if (result.computedImports.length) {
    console.log(`Computed import targets not fully resolved (${result.computedImports.length}): ${result.computedImports.join(', ')}`);
  }
  if (result.issues.length) {
    console.error(`Workspace boundaries failed:\n${result.issues.join('\n')}`);
    process.exitCode = 1;
  } else console.log('Workspace static boundaries passed; app-internal module checks run separately.');
}
