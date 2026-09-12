import fs from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const certDir = path.resolve(__dirname, 'certs');
const certFile = path.join(certDir, 'cert.pem');
const keyFile = path.join(certDir, 'key.pem');
const hasCerts = fs.existsSync(certFile) && fs.existsSync(keyFile);

// GitHub Pages serves at https://<user>.github.io/<repo>/
// Vite needs base to match the subpath
const isProd = process.env.NODE_ENV === 'production';
const base = isProd ? '/stereo-vid-viewer/' : '/';

export default defineConfig({
  base,
  plugins: [react()],
  server: {
    host: true,
    port: 5177,
    allowedHosts: ['papa-debian', 'localhost', '.local'],
    https: hasCerts
      ? {
          key: fs.readFileSync(keyFile),
          cert: fs.readFileSync(certFile),
        }
      : undefined,
  },
});
