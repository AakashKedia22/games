import path from 'node:path';

// Map a request URL to a file inside the build folder, or null if it would
// escape it (e.g. "/../server.mjs" or "/%2e%2e/package.json").
export function resolveBuildFile(buildPath, url) {
  let requestPath;
  try {
    requestPath = decodeURIComponent(String(url || '/').split('?')[0].split('#')[0]);
  } catch {
    return null;
  }
  if (requestPath.includes('\0')) return null;
  const root = path.resolve(buildPath);
  const file = path.resolve(root, `.${path.posix.normalize(`/${requestPath}`)}`);
  if (file !== root && !file.startsWith(root + path.sep)) return null;
  return file === root ? path.join(root, 'index.html') : file;
}
