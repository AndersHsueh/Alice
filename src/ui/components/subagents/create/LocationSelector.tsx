/**
 * @license
 * Copyright 2025 Qwen
 * SPDX-License-Identifier: Apache-2.0
 */

import { Box } from 'ink';
import { RadioButtonSelect } from '../../shared/RadioButtonSelect.js';
import type { WizardStepProps } from '../types.js';
import { t } from '../../../../i18n/index.js';
import { SubagentLevel } from '@qwen-code/qwen-code-core';

interface LocationOption {
  label: string;
  value: SubagentLevel.Project | SubagentLevel.User;
}

const locationOptions: LocationOption[] = [
  {
    get label() {
      return t('Project Level (.qwen/agents/)');
    },
    value: SubagentLevel.Project,
  },
  {
    get label() {
      return t('User Level (~/.qwen/agents/)');
    },
    value: SubagentLevel.User,
  },
];

/**
 * Step 1: Location selection for subagent storage.
 */
export function LocationSelector({ state, dispatch, onNext }: WizardStepProps) {
  const handleSelect = (selectedValue: string) => {
    const location = selectedValue as SubagentLevel.Project | SubagentLevel.User;
    dispatch({ type: 'SET_LOCATION', location });
    onNext();
  };

  return (
    <Box flexDirection="column">
      <RadioButtonSelect
        items={locationOptions.map((option) => ({
          key: option.value,
          label: option.label,
          value: option.value,
        }))}
        initialIndex={locationOptions.findIndex(
          (opt) => opt.value === state.location,
        )}
        onSelect={handleSelect}
        isFocused={true}
      />
    </Box>
  );
}
