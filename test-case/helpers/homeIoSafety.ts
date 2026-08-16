import fs from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';

const DESTRUCTIVE_FS_METHODS = new Set([
  'appendFile', 'appendFileSync', 'chmod', 'chmodSync', 'chown', 'chownSync',
  'copyFile', 'copyFileSync', 'cp', 'cpSync', 'createWriteStream', 'link',
  'linkSync', 'mkdir', 'mkdirSync', 'mkdtemp', 'mkdtempSync', 'rename',
  'renameSync', 'rm', 'rmSync', 'rmdir', 'rmdirSync', 'symlink', 'symlinkSync',
  'truncate', 'truncateSync', 'unlink', 'unlinkSync', 'utimes', 'utimesSync',
  'writeFile', 'writeFileSync',
]);
const KNOWN_HOME_PATH_FACTORIES = new Set([
  'defaultTracePath',
  'resolveConsoleFilePath',
]);

function isHomeReference(node: ts.Node, sourceFile: ts.SourceFile): boolean {
  if (ts.isCallExpression(node)) {
    const callee = node.expression;
    if (ts.isIdentifier(callee) && (callee.text === 'homedir' || KNOWN_HOME_PATH_FACTORIES.has(callee.text))) {
      return true;
    }
    if (ts.isPropertyAccessExpression(callee)
      && (callee.name.text === 'homedir' || KNOWN_HOME_PATH_FACTORIES.has(callee.name.text))) {
      return true;
    }
  }
  if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
    return /^process\.env(?:\.HOME|\[['"]HOME['"]\])$/.test(node.getText(sourceFile));
  }
  return false;
}

function containsHomeDerivedPath(
  node: ts.Node,
  sourceFile: ts.SourceFile,
  taintedIdentifiers: ReadonlySet<string>,
): boolean {
  let found = false;
  const visit = (current: ts.Node): void => {
    if (found) return;
    if (isHomeReference(current, sourceFile)) {
      found = true;
      return;
    }
    if (ts.isIdentifier(current) && taintedIdentifiers.has(current.text)) {
      found = true;
      return;
    }
    ts.forEachChild(current, visit);
  };
  visit(node);
  return found;
}

function destructiveCallName(
  call: ts.CallExpression,
  importedAliases: ReadonlySet<string>,
): string | undefined {
  if (ts.isIdentifier(call.expression)) {
    return importedAliases.has(call.expression.text) ? call.expression.text : undefined;
  }
  if (ts.isPropertyAccessExpression(call.expression)) {
    const name = call.expression.name.text;
    return DESTRUCTIVE_FS_METHODS.has(name) ? name : undefined;
  }
  return undefined;
}

export interface HomeIoViolation {
  file: string;
  line: number;
  method: string;
}

/**
 * 静态追踪测试脚本里由 homedir()/process.env.HOME 及已知默认路径 helper
 * 派生的路径，禁止其进入写入、创建、移动或删除类 fs API。对默认路径 helper
 * 自身的内部 I/O，调用方仍须另做 runtime fs spy；此扫描不冒充通用跨函数分析。
 */
export async function findDestructiveHomeIo(testCaseDir: string): Promise<HomeIoViolation[]> {
  const entries = await fs.readdir(testCaseDir, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && /^test-.*\.ts$/.test(entry.name))
    .map((entry) => path.join(testCaseDir, entry.name));
  const violations: HomeIoViolation[] = [];

  for (const file of files) {
    const source = await fs.readFile(file, 'utf8');
    const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const importedAliases = new Set<string>();
    const declarations: ts.VariableDeclaration[] = [];

    const collect = (node: ts.Node): void => {
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
        if (/^(?:node:)?fs(?:\/promises)?$/.test(node.moduleSpecifier.text)) {
          const bindings = node.importClause?.namedBindings;
          if (bindings && ts.isNamedImports(bindings)) {
            for (const element of bindings.elements) {
              const imported = element.propertyName?.text ?? element.name.text;
              if (DESTRUCTIVE_FS_METHODS.has(imported)) importedAliases.add(element.name.text);
            }
          }
        }
      }
      if (ts.isVariableDeclaration(node)) declarations.push(node);
      ts.forEachChild(node, collect);
    };
    collect(sourceFile);

    const taintedIdentifiers = new Set<string>();
    let changed = true;
    while (changed) {
      changed = false;
      for (const declaration of declarations) {
        if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;
        if (taintedIdentifiers.has(declaration.name.text)) continue;
        if (containsHomeDerivedPath(declaration.initializer, sourceFile, taintedIdentifiers)) {
          taintedIdentifiers.add(declaration.name.text);
          changed = true;
        }
      }
    }

    const inspect = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        const method = destructiveCallName(node, importedAliases);
        if (method && node.arguments.some((arg) => containsHomeDerivedPath(arg, sourceFile, taintedIdentifiers))) {
          const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
          violations.push({ file: path.relative(testCaseDir, file), line: line + 1, method });
        }
      }
      ts.forEachChild(node, inspect);
    };
    inspect(sourceFile);
  }

  return violations;
}
