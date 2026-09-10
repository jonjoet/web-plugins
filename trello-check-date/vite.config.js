import { defineConfig } from 'vite';
import { existsSync, readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('.', import.meta.url));
function entries(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? entries(path) : entry.name.endsWith('.html') ? [path] : [];
  });
}

export default defineConfig(async ({ command, isPreview }) => {
  const configPath = resolve(root, 'config.js');
  const key = existsSync(configPath)
    ? (await import(pathToFileURL(configPath).href)).TRELLO_APP_KEY : '';
  const configured = typeof key === 'string' && /^[a-f\d]{32}$/i.test(key);
  if (command === 'build' && !configured) {
    throw new Error('Missing public API key: copy config.example.js to config.js, or run npm run config with TRELLO_APP_KEY.');
  }
  const base = process.env.APP_BASE || '/web-plugins/trello-check-date/';
  if (!/^\/(?:[a-zA-Z0-9_-]+\/)*$/.test(base)) {
    throw new Error('APP_BASE must be a root-relative path with leading and trailing slashes.');
  }
  return {
    base: command === 'build' || isPreview ? base : '/',
    plugins: [{
      name: 'public-trello-config',
      resolveId: id => id === 'virtual:trello-config' ? '\0trello-config' : null,
      load: id => id === '\0trello-config'
        ? `export const TRELLO_APP_KEY = ${JSON.stringify(configured ? key : '')};` : null,
    }],
    build: { rollupOptions: { input: entries(resolve(root, 'apps')) } },
  };
});
