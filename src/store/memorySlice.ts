import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { RootState } from './store';

interface MemoryState {
  memory: Record<string, string>;
}

const initialState: MemoryState = {
  memory: {},
};

export const memorySlice = createSlice({
  name: 'memory',
  initialState,
  reducers: {
    setMemory: (state, action: PayloadAction<MemoryState['memory']>) => {
      state.memory = action.payload;
    },
    removeMemory: (state, action: PayloadAction<string>) => {
      delete state.memory[action.payload];
    },
    updateMemory: (
      state,
      action: PayloadAction<{ key: string; value: string }>
    ) => {
      state.memory[action.payload.key] = action.payload.value;
    },
    clearMemory: (state) => {
      state.memory = {};
    },
  },
});

export const { setMemory, removeMemory, updateMemory, clearMemory } =
  memorySlice.actions;

// Selector to get current memory
export const selectMemory = (state: RootState) => state.memory.memory;
