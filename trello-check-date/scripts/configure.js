import { writeFile } from 'node:fs/promises';

const key = process.env.TRELLO_APP_KEY?.trim();
if (!key || !/^[a-f\d]{32}$/i.test(key)) {
  throw new Error('Set TRELLO_APP_KEY to the public 32-character Power-Up API key. Never supply a user token.');
}
await writeFile(new URL('../config.js', import.meta.url),
  `// Public Power-Up API key. Generated for this build.\nexport const TRELLO_APP_KEY = ${JSON.stringify(key)};\n`);
