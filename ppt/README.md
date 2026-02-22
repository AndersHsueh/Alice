# ALICE CLI 技术介绍 PPT

基于 **HTML + SVG** 的幻灯片，介绍 ALICE 项目架构、技术特性及与市面 CLI 的对比。

## 使用方式

在浏览器中打开 `index.html` 即可全屏演示：

```bash
# 在项目根目录
open ppt/index.html

# 或指定浏览器
open -a "Google Chrome" ppt/index.html
```

## 操作

- **→ / 空格**：下一页  
- **←**：上一页  

## 内容概览

1. **封面**：ALICE 全称与技术关键词  
2. **项目简介**：产品定位、VERONICA/ALICE 体系  
3. **架构特性**：CLI ↔ Daemon ↔ Core / Tools / Providers 示意  
4. **技术栈**：Node/TS/ESM、Ink、多 Provider、MCP、配置分离  
5. **目录与规模**：src 结构、文件与工具数量  
6. **对比表**：ALICE vs GitHub Copilot CLI / aider / Cursor 等  
7. **能力图表**：多模型、Daemon、MCP、开源、TUI 等维度评分条形图  
8. **技术优势总结**  
9. **结尾**  

## 设计

- 主色：科技蓝 `#00D9FF`，与 ALICE 产品调性一致  
- 深色背景、极简排版、SVG 图表无外部依赖  
