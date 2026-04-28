# CLI Banner 设计方案

> [!info] 目标
> 创建类似 GitHub Copilot CLI 的酷炫启动 banner，包括动画效果和视觉吸引力

## 🎨 Banner 类型对比

### 1. ASCII Art Banner

**优点:** 兼容性最好，跨平台，无依赖  
**缺点:** 视觉效果相对简单

```
    ___    __    ________  ______
   /   |  / /   /  _/ __ \/ ____/
  / /| | / /    / // / / / __/   
 / ___ |/ /____/ // /_/ / /___   
/_/  |_/_____/___/\____/_____/   
                                  
  AI-Powered CLI Assistant v1.0
```

### 2. 彩色渐变 Banner

**优点:** 视觉效果好，现代感强  
**缺点:** 需要终端支持 TrueColor

```typescript
// 使用 gradient-string 库
import gradient from 'gradient-string';

const banner = gradient.rainbow(`
╔═══════════════════════════════════════╗
║          A L I C E   C L I           ║
║     Your AI Coding Companion 🚀      ║
╚═══════════════════════════════════════╝
`);
```

### 3. 动画 Banner ⭐ 推荐

**优点:** 最吸引眼球，用户体验最佳  
**缺点:** 实现复杂度高

**效果类型:**
- 逐字打字机效果
- 淡入淡出动画
- 波浪滚动效果
- 粒子聚合效果
- 霓虹灯闪烁效果

---

## 🛠️ 推荐工具库

### Node.js 生态

#### 1. figlet - ASCII Art 生成器
```bash
npm install figlet @types/figlet
```

```typescript
import figlet from 'figlet';

const text = figlet.textSync('ALICE', {
  font: 'ANSI Shadow',  // 字体选择
  horizontalLayout: 'default',
  verticalLayout: 'default',
  width: 80,
  whitespaceBreak: true
});
```

**最佳字体推荐:**
- `ANSI Shadow` - 阴影效果，现代
- `Big` - 大号字体，清晰
- `Slant` - 倾斜风格，动感
- `3D-ASCII` - 3D 效果
- `Cyberlarge` - 赛博朋克风
- `Doom` - 游戏风格
- `Graffiti` - 涂鸦风格

#### 2. chalk - 颜色渲染
```bash
npm install chalk
```

```typescript
import chalk from 'chalk';

console.log(chalk.cyan.bold('ALICE'));
console.log(chalk.gray('Version 1.0.0'));
```

#### 3. gradient-string - 渐变色
```bash
npm install gradient-string
```

```typescript
import gradient from 'gradient-string';

// 预设渐变
console.log(gradient.rainbow('Rainbow text'));
console.log(gradient.pastel('Pastel text'));
console.log(gradient.morning('Morning text'));

// 自定义渐变
const customGradient = gradient(['#FF6B6B', '#4ECDC4', '#45B7D1']);
console.log(customGradient('Custom gradient'));
```

#### 4. ora - 加载动画
```bash
npm install ora
```

```typescript
import ora from 'ora';

const spinner = ora({
  text: 'Loading ALICE...',
  spinner: 'dots12',  // 动画类型
  color: 'cyan'
}).start();

setTimeout(() => spinner.succeed('Ready!'), 2000);
```

#### 5. cli-boxes - 边框装饰
```bash
npm install cli-boxes boxen
```

```typescript
import boxen from 'boxen';

console.log(boxen('ALICE CLI v1.0', {
  padding: 1,
  margin: 1,
  borderStyle: 'double',
  borderColor: 'cyan',
  backgroundColor: '#555555'
}));
```

#### 6. term-img - 图片显示（高级）
```bash
npm install term-img
```

```typescript
import termImg from 'term-img';

// 在支持的终端显示图片
termImg('./logo.png', {
  width: 40,
  height: 20,
  fallback: () => '🚀 ALICE'
});
```

---

## 🎬 动画实现方案

### 方案 1: 打字机效果

```typescript
// src/banner/typewriter.ts
import chalk from 'chalk';

export async function typewriterEffect(
  text: string, 
  options = { delay: 50, color: 'cyan' }
): Promise<void> {
  const colorFn = chalk[options.color as keyof typeof chalk] as Function;
  
  for (const char of text) {
    process.stdout.write(colorFn(char));
    await new Promise(resolve => setTimeout(resolve, options.delay));
  }
  
  process.stdout.write('\n');
}

// 使用
await typewriterEffect('ALICE CLI', { delay: 80, color: 'cyan' });
```

### 方案 2: 淡入效果

```typescript
// src/banner/fade-in.ts
import chalk from 'chalk';

export async function fadeIn(
  lines: string[], 
  options = { duration: 1000 }
): Promise<void> {
  const frames = 20;
  const delay = options.duration / frames;
  
  // ANSI gray scale: 232-255 (24 shades)
  const grayStart = 232;
  const grayEnd = 255;
  
  for (let frame = 0; frame < frames; frame++) {
    // 清屏
    process.stdout.write('\x1B[2J\x1B[0f');
    
    // 计算当前灰度
    const gray = Math.floor(grayStart + (grayEnd - grayStart) * (frame / frames));
    
    // 渲染
    for (const line of lines) {
      console.log(`\x1b[38;5;${gray}m${line}\x1b[0m`);
    }
    
    await new Promise(resolve => setTimeout(resolve, delay));
  }
  
  // 最终彩色版本
  process.stdout.write('\x1B[2J\x1B[0f');
  for (const line of lines) {
    console.log(chalk.cyan.bold(line));
  }
}
```

### 方案 3: 波浪滚动效果

```typescript
// src/banner/wave.ts
import chalk from 'chalk';

export async function waveEffect(
  lines: string[], 
  options = { cycles: 2, speed: 50 }
): Promise<void> {
  const width = Math.max(...lines.map(l => l.length));
  const totalFrames = width * options.cycles;
  
  for (let frame = 0; frame < totalFrames; frame++) {
    process.stdout.write('\x1B[2J\x1B[0f'); // 清屏
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      let coloredLine = '';
      
      for (let j = 0; j < line.length; j++) {
        // 波浪函数
        const wave = Math.sin((frame + j + i * 3) * 0.2);
        const brightness = Math.floor((wave + 1) * 127.5);
        
        // RGB 渐变
        const r = Math.floor(100 + brightness * 0.6);
        const g = Math.floor(150 + brightness * 0.4);
        const b = Math.floor(200 + brightness * 0.2);
        
        coloredLine += `\x1b[38;2;${r};${g};${b}m${line[j]}\x1b[0m`;
      }
      
      console.log(coloredLine);
    }
    
    await new Promise(resolve => setTimeout(resolve, options.speed));
  }
}
```

### 方案 4: 矩阵雨效果（赛博朋克风）

```typescript
// src/banner/matrix.ts
import chalk from 'chalk';

export async function matrixRain(
  finalText: string[], 
  options = { duration: 3000 }
): Promise<void> {
  const width = 80;
  const height = 20;
  const chars = '01アイウエオカキクケコサシスセソタチツテト';
  
  const drops: number[] = Array(width).fill(0);
  const startTime = Date.now();
  
  while (Date.now() - startTime < options.duration) {
    process.stdout.write('\x1B[2J\x1B[0f');
    
    // 绘制矩阵雨
    for (let i = 0; i < width; i++) {
      if (drops[i] === 0 && Math.random() > 0.95) {
        drops[i] = 1;
      }
      
      if (drops[i] > 0) {
        const y = drops[i] - 1;
        if (y < height) {
          const char = chars[Math.floor(Math.random() * chars.length)];
          process.stdout.cursorTo(i, y);
          process.stdout.write(chalk.green(char));
        }
        
        drops[i]++;
        
        if (drops[i] > height) {
          drops[i] = 0;
        }
      }
    }
    
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  
  // 显示最终文本
  process.stdout.write('\x1B[2J\x1B[0f');
  finalText.forEach(line => console.log(chalk.cyan.bold(line)));
}
```

### 方案 5: 粒子聚合效果 🌟 最酷

```typescript
// src/banner/particle.ts
interface Particle {
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  char: string;
}

export async function particleGathering(
  finalLines: string[],
  options = { duration: 2000 }
): Promise<void> {
  const width = 80;
  const height = 20;
  const particles: Particle[] = [];
  
  // 创建粒子
  for (let y = 0; y < finalLines.length; y++) {
    for (let x = 0; x < finalLines[y].length; x++) {
      const char = finalLines[y][x];
      if (char.trim()) {
        particles.push({
          x: Math.random() * width,
          y: Math.random() * height,
          targetX: x + (width - finalLines[y].length) / 2,
          targetY: y + (height - finalLines.length) / 2,
          char
        });
      }
    }
  }
  
  const frames = 60;
  const delay = options.duration / frames;
  
  for (let frame = 0; frame < frames; frame++) {
    process.stdout.write('\x1B[2J\x1B[0f');
    
    // 更新粒子位置
    for (const particle of particles) {
      const progress = frame / frames;
      
      // 缓动函数（easeOutCubic）
      const ease = 1 - Math.pow(1 - progress, 3);
      
      particle.x += (particle.targetX - particle.x) * 0.1;
      particle.y += (particle.targetY - particle.y) * 0.1;
      
      // 渲染粒子
      const x = Math.floor(particle.x);
      const y = Math.floor(particle.y);
      
      if (x >= 0 && x < width && y >= 0 && y < height) {
        process.stdout.cursorTo(x, y);
        
        // 根据距离目标的远近改变颜色
        const distance = Math.sqrt(
          Math.pow(particle.x - particle.targetX, 2) +
          Math.pow(particle.y - particle.targetY, 2)
        );
        
        if (distance < 1) {
          process.stdout.write(chalk.cyan.bold(particle.char));
        } else {
          process.stdout.write(chalk.gray(particle.char));
        }
      }
    }
    
    await new Promise(resolve => setTimeout(resolve, delay));
  }
}
```

---

## 🎯 完整 Banner 示例

### 示例 1: 简洁专业风格

```typescript
// src/banner/professional.ts
import figlet from 'figlet';
import gradient from 'gradient-string';
import boxen from 'boxen';
import chalk from 'chalk';

export async function showProfessionalBanner() {
  // ASCII Art
  const logo = figlet.textSync('ALICE', {
    font: 'ANSI Shadow',
    horizontalLayout: 'default'
  });
  
  // 应用渐变
  const coloredLogo = gradient.cristal.multiline(logo);
  
  // 版本信息
  const version = chalk.gray(`v1.0.0 • ${chalk.cyan('https://alice.dev')}`);
  const tagline = chalk.italic.gray('Your AI Coding Companion');
  
  // 组合
  const content = `${coloredLogo}\n\n${tagline}\n${version}`;
  
  // 添加边框
  console.log(boxen(content, {
    padding: 1,
    margin: { top: 1, bottom: 1 },
    borderStyle: 'round',
    borderColor: 'cyan',
    dimBorder: true
  }));
  
  // 提示信息
  console.log(chalk.gray('  Type ') + chalk.cyan('/help') + chalk.gray(' to get started\n'));
}
```

### 示例 2: 赛博朋克风格

```typescript
// src/banner/cyberpunk.ts
import figlet from 'figlet';
import chalk from 'chalk';

export async function showCyberpunkBanner() {
  // 矩阵雨前奏
  await matrixRain(['ALICE'], { duration: 2000 });
  
  // 主 Logo
  const logo = figlet.textSync('ALICE', { font: 'Cyberlarge' });
  
  // 霓虹灯效果
  const neonColors = ['magenta', 'cyan', 'magenta', 'cyan'];
  for (let i = 0; i < 3; i++) {
    process.stdout.write('\x1B[2J\x1B[0f');
    const color = neonColors[i % neonColors.length];
    console.log(chalk[color].bold(logo));
    await new Promise(r => setTimeout(r, 200));
  }
  
  // 信息栏
  console.log(chalk.magenta('━'.repeat(60)));
  console.log(chalk.cyan('  [SYSTEM ONLINE]') + chalk.gray(' Neural Link Established'));
  console.log(chalk.magenta('━'.repeat(60)));
  console.log();
}
```

### 示例 3: 极简动画风格 ⭐ 最推荐

```typescript
// src/banner/minimal-animated.ts
import figlet from 'figlet';
import gradient from 'gradient-string';
import ora from 'ora';
import chalk from 'chalk';

export async function showMinimalBanner() {
  // 加载动画
  const spinner = ora({
    text: chalk.gray('Initializing ALICE...'),
    spinner: 'dots12',
    color: 'cyan'
  }).start();
  
  await new Promise(r => setTimeout(r, 1000));
  spinner.stop();
  
  // 清屏
  console.clear();
  
  // Logo 生成
  const logo = figlet.textSync('ALICE', {
    font: 'ANSI Shadow',
    horizontalLayout: 'fitted'
  });
  
  const lines = logo.split('\n');
  
  // 逐行淡入
  for (const line of lines) {
    console.log(gradient.pastel(line));
    await new Promise(r => setTimeout(r, 50));
  }
  
  console.log();
  
  // 打字机效果的标语
  await typewriterEffect(
    '  Your AI Coding Companion 🤖✨',
    { delay: 30, color: 'gray' }
  );
  
  console.log();
  console.log(chalk.gray('  Version ') + chalk.cyan('1.0.0'));
  console.log();
  
  // 快速提示
  const hints = [
    '  💡 Tip: Type /help to see available commands',
    '  🚀 Ready to assist you with coding tasks',
  ];
  
  for (const hint of hints) {
    console.log(chalk.dim(hint));
    await new Promise(r => setTimeout(r, 100));
  }
  
  console.log('\n' + chalk.cyan('─'.repeat(50)) + '\n');
}
```

---

## 🎨 设计建议

### 视觉层次

```
[大号 Logo]        ← 最醒目，使用渐变色
    ↓
[标语/Tagline]     ← 中等大小，灰色斜体
    ↓
[版本信息]         ← 小号，灰色
    ↓
[快速提示]         ← 最小，深灰色
```

### 颜色方案

#### 1. 科技蓝风格（推荐）
```typescript
const colors = {
  primary: '#00D9FF',    // 青色
  secondary: '#0088CC',  // 深蓝
  accent: '#00FFAA',     // 青绿
  text: '#E0E0E0',       // 浅灰
  dim: '#808080'         // 中灰
};
```

#### 2. 紫色魔法风格
```typescript
const colors = {
  primary: '#A78BFA',    // 浅紫
  secondary: '#7C3AED',  // 深紫
  accent: '#EC4899',     // 粉色
  text: '#F3F4F6',
  dim: '#9CA3AF'
};
```

#### 3. 赛博朋克风格
```typescript
const colors = {
  primary: '#FF00FF',    // 品红
  secondary: '#00FFFF',  // 青色
  accent: '#FFFF00',     // 黄色
  text: '#FFFFFF',
  dim: '#666666'
};
```

---

## 🚀 完整实现代码

```typescript
// src/banner/index.ts
import figlet from 'figlet';
import gradient from 'gradient-string';
import chalk from 'chalk';
import ora from 'ora';
import boxen from 'boxen';

interface BannerOptions {
  animated?: boolean;
  style?: 'minimal' | 'professional' | 'cyberpunk';
  showTips?: boolean;
}

export class BannerManager {
  async show(options: BannerOptions = {}) {
    const {
      animated = true,
      style = 'minimal',
      showTips = true
    } = options;
    
    if (animated) {
      await this.showAnimated(style);
    } else {
      await this.showStatic(style);
    }
    
    if (showTips) {
      this.showQuickTips();
    }
  }
  
  private async showAnimated(style: string) {
    switch (style) {
      case 'minimal':
        await this.minimal();
        break;
      case 'professional':
        await this.professional();
        break;
      case 'cyberpunk':
        await this.cyberpunk();
        break;
    }
  }
  
  private async minimal() {
    // 初始化动画
    const spinner = ora({
      text: chalk.gray('Initializing ALICE...'),
      spinner: 'dots12',
      color: 'cyan'
    }).start();
    
    await this.sleep(1200);
    spinner.succeed(chalk.green('Ready!'));
    await this.sleep(300);
    
    console.clear();
    
    // Logo
    const logo = figlet.textSync('ALICE', {
      font: 'ANSI Shadow',
      horizontalLayout: 'fitted'
    });
    
    // 逐行显示
    for (const line of logo.split('\n')) {
      console.log(gradient.pastel(line));
      await this.sleep(50);
    }
    
    console.log();
    
    // 标语
    const tagline = '  Your AI Coding Companion 🤖✨';
    await this.typewriter(tagline, 30);
    
    console.log();
    console.log(chalk.gray('  Version ') + chalk.cyan('1.0.0'));
    console.log();
  }
  
  private async professional() {
    const logo = figlet.textSync('ALICE', { font: 'ANSI Shadow' });
    const coloredLogo = gradient.cristal.multiline(logo);
    
    const content = [
      coloredLogo,
      '',
      chalk.italic.gray('Your AI Coding Companion'),
      chalk.gray(`v1.0.0 • ${chalk.cyan('https://alice.dev')}`)
    ].join('\n');
    
    console.log(boxen(content, {
      padding: 1,
      margin: 1,
      borderStyle: 'round',
      borderColor: 'cyan'
    }));
  }
  
  private async cyberpunk() {
    // 矩阵雨效果
    await this.matrixEffect(1500);
    
    const logo = figlet.textSync('ALICE', { font: 'Doom' });
    
    // 霓虹灯闪烁
    const colors = ['magenta', 'cyan', 'magenta'];
    for (const color of colors) {
      console.clear();
      console.log(chalk[color].bold(logo));
      await this.sleep(200);
    }
    
    console.log(chalk.magenta('━'.repeat(60)));
    console.log(
      chalk.cyan('  [SYSTEM ONLINE]') + 
      chalk.gray(' Neural Link Established')
    );
    console.log(chalk.magenta('━'.repeat(60)));
  }
  
  private showQuickTips() {
    const tips = [
      { icon: '💡', text: 'Type /help to see available commands' },
      { icon: '🔧', text: 'Press Tab to autocomplete' },
      { icon: '⬆️', text: 'Use arrow keys for command history' },
    ];
    
    console.log(chalk.bold.cyan('Quick Tips:'));
    tips.forEach(tip => {
      console.log(chalk.gray(`  ${tip.icon} ${tip.text}`));
    });
    
    console.log('\n' + chalk.cyan('─'.repeat(50)) + '\n');
  }
  
  private async typewriter(text: string, delay: number) {
    for (const char of text) {
      process.stdout.write(chalk.gray(char));
      await this.sleep(delay);
    }
    console.log();
  }
  
  private async matrixEffect(duration: number) {
    const chars = '01アイウエオ';
    const width = 80;
    const endTime = Date.now() + duration;
    
    while (Date.now() < endTime) {
      let line = '';
      for (let i = 0; i < width; i++) {
        if (Math.random() > 0.9) {
          const char = chars[Math.floor(Math.random() * chars.length)];
          line += chalk.green(char);
        } else {
          line += ' ';
        }
      }
      process.stdout.write('\r' + line);
      await this.sleep(50);
    }
    console.clear();
  }
  
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// 导出
export const bannerManager = new BannerManager();

// 使用
// import { bannerManager } from './banner';
// await bannerManager.show({ animated: true, style: 'minimal' });
```

---

## 📦 安装所需依赖

```bash
npm install figlet @types/figlet
npm install chalk
npm install gradient-string
npm install ora
npm install boxen
npm install cli-boxes
```

---

## 🎯 最佳实践

### 1. 性能优化
- 使用 `--no-banner` 选项跳过动画（快速启动）
- 缓存 figlet 字体避免重复加载
- 检测 CI 环境自动禁用动画

```typescript
const isCI = process.env.CI === 'true';
const showAnimated = !isCI && !process.argv.includes('--no-banner');
```

### 2. 终端兼容性
```typescript
import supportsColor from 'supports-color';

const hasColor = supportsColor.stdout;
const hasTrueColor = hasColor && hasColor.has256;

if (!hasColor) {
  // 使用纯文本
} else if (!hasTrueColor) {
  // 使用 16 色
} else {
  // 使用 TrueColor (RGB)
}
```

### 3. 响应式设计
```typescript
import terminalSize from 'term-size';

const { columns, rows } = terminalSize();

if (columns < 80) {
  // 使用小号 banner
  font = 'Small';
} else if (columns < 120) {
  // 使用中号 banner
  font = 'Standard';
} else {
  // 使用大号 banner
  font = 'ANSI Shadow';
}
```

---

## 🎪 在线工具

### ASCII Art 生成器
- [patorjk.com/software/taag](http://patorjk.com/software/taag/) - 最全的字体库
- [ascii-generator.site](https://ascii-generator.site/) - 图片转 ASCII
- [texteditor.com/ascii-art](https://texteditor.com/ascii-art/) - 手绘 ASCII

### 颜色工具
- [coolors.co](https://coolors.co/) - 配色方案生成
- [colorhunt.co](https://colorhunt.co/) - 配色灵感
- [terminal.sexy](https://terminal.sexy/) - 终端配色预览

---

## 🌟 创意灵感

### Copilot CLI 实际效果
- 使用了动画 ASCII art
- 渐变色效果
- 简短的标语
- 快速加载（< 2 秒）

### 其他优秀案例
- **Warp Terminal** - 全屏动画 logo
- **GitHub CLI** - 简洁的图标 + 版本号
- **Vercel CLI** - 三角形 logo + 渐变
- **Next.js** - 打字机效果 + 彩色文字

---

## 📝 下一步

> [!todo] Action Items
> - [ ] 确定品牌视觉风格（颜色、字体）
> - [ ] 设计 ALICE logo（可考虑请设计师）
> - [ ] 选择合适的动画效果
> - [ ] 实现 Banner 代码
> - [ ] 测试不同终端兼容性
> - [ ] 添加 `--no-banner` 选项

---

**推荐方案:** 极简动画风格（示例 3）
- 视觉效果好但不过度
- 加载速度快（< 1.5s）
- 兼容性好
- 易于维护

祝你打造出超酷的 CLI banner! 🚀
