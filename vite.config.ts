import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// base './' 讓建置結果可以放在任何子路徑（GitHub Pages 的 /repo-name/）
export default defineConfig({
  base: './',
  plugins: [react()],
  // 固定用 7351，避免和本機其他開發伺服器（如 5178）衝突
  server: { port: 7351, strictPort: true },
  preview: { port: 7352, strictPort: true },
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
