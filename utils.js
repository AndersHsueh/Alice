/**
 * 字符串显示宽度计算工具
 * 处理中英文混合字符的终端显示问题
 * 
 * @module utils
 */

/**
 * 计算字符串在终端中的显示宽度
 * 全角字符（中文、日文、韩文等）占2个宽度
 * 半角字符（英文、数字、符号）占1个宽度
 * 
 * @param {string} str - 要计算的字符串
 * @returns {number} 显示宽度
 */
function getStringDisplayWidth(str) {
  if (!str) return 0;
  
  let width = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charAt(i);
    
    // 检查是否为全角字符
    if (isFullWidth(char)) {
      width += 2;
    } else {
      width += 1;
    }
  }
  return width;
}

/**
 * 判断字符是否为全角字符
 * 
 * @param {string} char - 要判断的字符
 * @returns {boolean} 是否为全角字符
 */
function isFullWidth(char) {
  // 全角字符范围
  const fullWidthRanges = [
    ['\u4e00', '\u9fff'],    // CJK Unified Ideographs
    ['\u3400', '\u4dbf'],    // CJK Unified Ideographs Extension A
    ['\u20000', '\u2a6df'],  // CJK Unified Ideographs Extension B
    ['\u2a700', '\u2b73f'],  // CJK Unified Ideographs Extension C
    ['\u2b740', '\u2b81f'],  // CJK Unified Ideographs Extension D
    ['\u2b820', '\u2ceaf'],  // CJK Unified Ideographs Extension E
    ['\u2f800', '\u2fa1f'],  // CJK Compatibility Ideographs Supplement
    ['\uff00', '\uffef'],    // Halfwidth and Fullwidth Forms
    ['\u3000', '\u303f'],    // CJK Symbols and Punctuation
    ['\u3040', '\u309f'],    // Hiragana
    ['\u30a0', '\u30ff'],    // Katakana
    ['\uac00', '\ud7af']     // Hangul Syllables
  ];
  
  return fullWidthRanges.some(([start, end]) => 
    char >= start && char <= end
  );
}

/**
 * 在指定位置截断字符串，考虑显示宽度
 * 
 * @param {string} str - 要截断的字符串
 * @param {number} maxWidth - 最大显示宽度
 * @returns {string} 截断后的字符串
 */
function truncateStringByWidth(str, maxWidth) {
  if (!str || maxWidth <= 0) return '';
  
  let result = '';
  let currentWidth = 0;
  
  for (let i = 0; i < str.length; i++) {
    const char = str.charAt(i);
    const charWidth = isFullWidth(char) ? 2 : 1;
    
    if (currentWidth + charWidth > maxWidth) {
      // 如果还能放下省略号
      if (currentWidth + 3 <= maxWidth) {
        result += '...';
      }
      break;
    }
    
    result += char;
    currentWidth += charWidth;
  }
  
  return result;
}

/**
 * 将字符串填充到指定的显示宽度
 * 
 * @param {string} str - 要填充的字符串
 * @param {number} targetWidth - 目标显示宽度
 * @param {string} padChar - 填充字符（默认空格）
 * @returns {string} 填充后的字符串
 */
function padStringToWidth(str, targetWidth, padChar = ' ') {
  const currentWidth = getStringDisplayWidth(str);
  if (currentWidth >= targetWidth) return str;
  
  const padWidth = targetWidth - currentWidth;
  const padCount = Math.ceil(padWidth / getStringDisplayWidth(padChar));
  
  return str + padChar.repeat(padCount).substring(0, padWidth);
}

module.exports = {
  getStringDisplayWidth,
  isFullWidth,
  truncateStringByWidth,
  padStringToWidth
};