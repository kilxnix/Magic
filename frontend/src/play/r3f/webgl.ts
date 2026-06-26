export function supportsWebGL(doc: Document = document): boolean {
  try {
    const canvas = doc.createElement('canvas') as HTMLCanvasElement;
    const ctx =
      canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    return Boolean(ctx);
  } catch {
    return false;
  }
}
