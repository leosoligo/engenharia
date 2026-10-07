import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'
import { viteSingleFile } from 'vite-plugin-singlefile'

// Build em um único arquivo HTML (abre com duplo clique, sem servidor).
export default defineConfig({
  plugins: [react(), viteSingleFile()],
  // otimização e cenários aleatórios são pesados: sem limite de 5 s por teste
  test: { testTimeout: 600_000 },
})
