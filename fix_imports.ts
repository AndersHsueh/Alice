import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const baseDir = process.cwd();
const shimPath = 'src/shim/qwen-code-core.ts';

// 使用 find 命令
const output = execSync(`find src -type f \\( -name '*.ts' -o -name '*.tsx' \\)`).toString();
const files = output.trim().split('\n').filter(f => f);

console.log(`Found ${files.length} files`);

let updated = 0;

files.forEach(file => {
  if (!file) return;
  
  // 计算相对路径
  const fileDir = path.dirname(file);
  const relPath = path.relative(fileDir, shimPath).replace('.ts', '.js');
  
  // 读取文件
  let content = fs.readFileSync(file, 'utf-8');
  
  // 替换导入
  const oldImport = "from '../../shim/qwen-code-core.js'";
  
  if (content.includes(oldImport)) {
    const newImport = `from '${relPath}'`;
    content = content.replace(new RegExp(`from '\\.\\./.*/shim/qwen-code-core\\.js'`, 'g'), newImport);
    fs.writeFileSync(file, content);
    updated++;
    if (updated <= 10) {
      console.log(`Updated: ${file.replace(baseDir + '/', '')} -> ${relPath}`);
    }
  }
});

console.log(`\nTotal files fixed: ${updated}`);
