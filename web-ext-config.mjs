// Only the extension files go into the package (hidden files are excluded by default).
export default {
  ignoreFiles: ['scripts', 'icons/icon.svg', 'README.md', 'web-ext-config.mjs', 'temp.txt', '*.log'],
  sign: { channel: 'unlisted' },
};
