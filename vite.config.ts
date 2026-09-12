import fs from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const certDir = path.resolve(__dirname, 'certs');
const certFile = path.join(certDir, 'cert.pem');
const keyFile = path.join(certDir, 'key.pem');
const hasCerts = fs.existsSync(certFile) && fs.existsSync(keyFile);

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5177,
    allowedHosts: ['papa-debian', 'localhost', '.local'],
    // getUserMedia requires a secure context (HTTPS or localhost).
    // LAN hostnames like http://papa-debian are blocked — use HTTPS.
    https: hasCerts
      ? {
          key: fs.readFileSync(keyFile),
          cert: fs.readFileSync(certFile),
        }
      : undefined,
  },
});
