import { registerHooks } from 'node:module';
import path from 'node:path';

function hasKnownExtension(specifier) {
  const ext = path.extname(specifier);
  return ext === '.js' || ext === '.mjs' || ext === '.cjs' || ext === '.json' || ext === '.node' || ext === '.ts';
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (err) {
      // Only rewrite relative/absolute file specifiers (not bare package imports).
      const isPathLike = specifier.startsWith('.') || specifier.startsWith('/') || specifier.startsWith('file:');
      if (!isPathLike || hasKnownExtension(specifier)) throw err;

      // Try appending ".js" (TypeScript-compiled output uses extensionless specifiers).
      try {
        return nextResolve(`${specifier}.js`, context);
      } catch {
        // Try directory index resolution as a fallback.
        return nextResolve(`${specifier}/index.js`, context);
      }
    }
  },
  load(url, context, nextLoad) {
    return nextLoad(url, context);
  },
});

