/**
 * SelectList 组件
 * 通用的键盘导航选择列表
 * 从 QuestionPrompt 提取的通用化版本
 */

import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import type { FocusableProps, SelectListItem } from './types.js';

export interface SelectListProps extends FocusableProps {
  /** 选项列表 */
  items: SelectListItem[];
  /** 选中回调 */
  onSelect: (item: SelectListItem) => void;
  /** 取消回调 */
  onCancel?: () => void;
  /** 选中项变化回调 */
  onSelectionChange?: (index: number) => void;
  /** 初始选中索引 */
  initialIndex?: number;
  /** 是否显示序号 */
  showNumbers?: boolean;
  /** 是否支持数字键快速选择 */
  numberSelect?: boolean;
  /** 高亮颜色 */
  highlightColor?: string;
}

export const SelectList: React.FC<SelectListProps> = ({
  items,
  onSelect,
  onCancel,
  onSelectionChange,
  initialIndex = 0,
  showNumbers = true,
  numberSelect = true,
  highlightColor = 'cyan',
  disabled = false,
  visible = true,
  focused = true,
}) => {
  const [selectedIndex, setSelectedIndex] = useState(initialIndex);

  useEffect(() => {
    onSelectionChange?.(selectedIndex);
  }, [selectedIndex]);

  useInput((input, key) => {
    if (disabled || !focused) return;

    if (key.upArrow) {
      setSelectedIndex(prev => (prev > 0 ? prev - 1 : items.length - 1));
    } else if (key.downArrow) {
      setSelectedIndex(prev => (prev < items.length - 1 ? prev + 1 : 0));
    } else if (key.return) {
      const item = items[selectedIndex];
      if (item && !item.disabled) {
        onSelect(item);
      }
    } else if (key.escape) {
      onCancel?.();
    } else if (numberSelect && input >= '1' && input <= '9') {
      const index = parseInt(input) - 1;
      if (index >= 0 && index < items.length) {
        const item = items[index];
        if (!item.disabled) {
          onSelect(item);
        }
      }
    }
  });

  if (!visible) return null;

  return (
    <Box flexDirection="column">
      {items.map((item, index) => {
        const isSelected = index === selectedIndex;
        const color = item.disabled ? 'gray' : isSelected ? highlightColor : 'white';

        return (
          <Box key={item.key} paddingLeft={2}>
            <Text color={color} dimColor={item.disabled}>
              {isSelected ? '❯ ' : '  '}
              {showNumbers ? `${index + 1}. ` : ''}
              {item.label}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
};

SelectList.displayName = 'SelectList';
