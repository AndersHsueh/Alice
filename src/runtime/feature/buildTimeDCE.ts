/**
 * src/runtime/feature/buildTimeDCE.ts
 *
 * 构建期死代码消除(IK8MWJ #4):
 * 1. 把 feature('name', default) / isFeatureActive('name') 调用折叠为布尔常量
 *    (flag 表里有值用表,没有就用字面量 default,isFeatureActive 未知 → false)
 * 2. if (常量) 分支剪除:条件为 true 只留 then,为 false 只留 else / 整句删除
 *
 * 只用 TypeScript 编译器 API,bun / Node ≥ 22.18 均可直接跑。
 * 注意:本文件只允许「可擦除」TS 语法(build.ts 会直接加载它)。
 */

import ts from 'typescript';

export interface DCEResult {
  code: string;
  /** 被折叠为常量的 feature()/isFeatureActive() 调用数 */
  foldedCalls: number;
  /** 被剪除的 if 死分支数 */
  prunedBranches: number;
}

export function buildTimeDCE(
  sourceText: string,
  flags: Record<string, boolean>,
  fileName = 'fixture.ts',
): DCEResult {
  let foldedCalls = 0;
  let prunedBranches = 0;

  const resolveFlag = (name: string): boolean | undefined =>
    Object.prototype.hasOwnProperty.call(flags, name) ? flags[name] === true : undefined;

  const transformer: ts.TransformerFactory<ts.SourceFile> = (context) => {
    const visit = (node: ts.Node): ts.VisitResult<ts.Node> => {
      // 先下钻:内层 feature() 折叠后,外层 if 才能看到常量条件
      const visited = ts.visitEachChild(node, visit, context);

      // feature('x', false) / isFeatureActive('x') → true / false
      if (ts.isCallExpression(visited) && ts.isIdentifier(visited.expression)) {
        const fn = visited.expression.text;
        const first = visited.arguments[0];
        if ((fn === 'feature' || fn === 'isFeatureActive') && first && ts.isStringLiteral(first)) {
          let value = resolveFlag(first.text);
          if (value === undefined && fn === 'feature') {
            const d = visited.arguments[1];
            if (d && d.kind === ts.SyntaxKind.TrueKeyword) value = true;
            if (d && d.kind === ts.SyntaxKind.FalseKeyword) value = false;
          }
          if (value === undefined && fn === 'isFeatureActive') value = false;
          if (value !== undefined) {
            foldedCalls++;
            return value ? ts.factory.createTrue() : ts.factory.createFalse();
          }
        }
      }

      // if (true) A else B → A;if (false) A else B → B(无 else 则整句删除)
      if (ts.isIfStatement(visited)) {
        const kind = visited.expression.kind;
        if (kind === ts.SyntaxKind.TrueKeyword) {
          prunedBranches++;
          return visited.thenStatement;
        }
        if (kind === ts.SyntaxKind.FalseKeyword) {
          prunedBranches++;
          return visited.elseStatement; // undefined → 从语句列表删除
        }
      }

      return visited;
    };
    return (sf) => ts.visitNode(sf, visit) as ts.SourceFile;
  };

  const out = ts.transpileModule(sourceText, {
    fileName,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      jsx: ts.JsxEmit.ReactJSX,
      allowJs: true,
      sourceMap: false,
    },
    transformers: { before: [transformer] },
  });

  return { code: out.outputText, foldedCalls, prunedBranches };
}
