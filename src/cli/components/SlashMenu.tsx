/**
 * SlashMenu
 * 输入 / 时弹出，展示所有可用命令供键盘选择
 * 输入更多字符时实时过滤
 */

import React from 'react';
import { InlinePicker } from './InlinePicker.js';
import type { PickerItem } from './InlinePicker.js';

export interface SlashCommand {
  name: string;
  description: string;
}

interface Props {
  query: string;           // / 之后输入的内容，用于过滤
  commands: SlashCommand[];
  onSelect: (command: SlashCommand) => void;
  onCancel: () => void;
}

export const SlashMenu: React.FC<Props> = ({ query, commands, onSelect, onCancel }) => {
  const q = query.toLowerCase();
  const filtered = commands.filter(
    c => !q || c.name.startsWith(q) || c.description.toLowerCase().includes(q)
  );

  if (filtered.length === 0) return null;

  const items: PickerItem[] = filtered.map(c => ({
    id: c.name,
    label: `/${c.name}`,
    hint: c.description,
  }));

  const handleSelect = (item: PickerItem) => {
    const cmd = commands.find(c => c.name === item.id);
    if (cmd) onSelect(cmd);
  };

  return (
    <InlinePicker
      items={items}
      onSelect={handleSelect}
      onCancel={onCancel}
      maxVisible={8}
    />
  );
};
