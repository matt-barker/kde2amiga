import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

const INSTALLER_FILES = ['Installer', 'Installer.license']

/**
 * Serves and ships the Installer 43.3 files straight from `Installer43_3/`.
 *
 * A plugin rather than a copy under `public/` so the repository holds exactly one copy of
 * a binary that licence clause B.1 forbids modifying — a second copy is a second thing to
 * keep identical, and nothing about the output would reveal that it had drifted.
 * `Installer.guide` and `SampleScripts/` are deliberately not served: clause B.3 forbids
 * redistributing them outside the complete original archive.
 */
function installerAssets(): Plugin {
  const read = (name: string) =>
    readFileSync(fileURLToPath(new URL(`../Installer43_3/${name}`, import.meta.url)))

  return {
    name: 'kde2amiga-installer-assets',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const name = INSTALLER_FILES.find((file) => req.url === `/installer/${file}`)
        if (!name) return next()
        res.setHeader('Content-Type', 'application/octet-stream')
        res.end(read(name))
      })
    },
    generateBundle() {
      for (const name of INSTALLER_FILES) {
        this.emitFile({ type: 'asset', fileName: `installer/${name}`, source: read(name) })
      }
    },
  }
}

export default defineConfig({
  plugins: [react(), installerAssets()],
  server: {
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
})
