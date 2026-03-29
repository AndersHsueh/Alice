import fs from 'fs';
import path from 'path';
import { globSync } from './node_modules/glob/dist/mjs/index.js';

const baseDir = process.cwd();
const shimPath = 'src/shim/qwen-code-core.ts';

// 获取所有 TS/TSX 文件
const files = globSync(`src/**/*.{ts,tsx}`, { nodir: true });

let updated = 0;
const errors = [];

files.forEach(file => {
  try {
    // 计算相对路径
    const fileDir = path.dirname(file);
    const relPath = path.relative(fileDir, shimPath).replace('.ts', '.js');
    
    // 读取文件
    let content = fs.readFileSync(file, 'utf-8');
    
    // 替换导入
    const oldImport = "from '../../shim/qwen-code-core.js'";
    const newImport = `from '${relPath}'`;
    
    if (content.includes(oldImport)) {
      content = content.replace(new RegExp("from '../../shim/qwen-code-core.js'", 'g'), newImport);
      fs.writeFileSync(file, content);
      updated++;
      if (updated <= 15) {
        console.log(`Updated: ${file} -> ${relPath}`);
      }
    }
  } catch (e) {
    errors.push(`Error processing ${file}: ${e.message}`);
  }
});

if (errors.length > 0) {
  console.error(`\nErrors: ${errors.length}`);
  errors.slice(0, 5).forEach(e => console.error(e));
}

console.log(`\nTotal files fixed: ${updated}`);
