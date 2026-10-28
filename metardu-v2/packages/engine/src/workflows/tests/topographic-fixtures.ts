/** Static topology fixtures for engine tests; production TINs come from Rust. */
export function gridTinTriangles(width: number, height: number): [number, number, number][] {
  const index = (x: number, y: number) => x * height + y;
  const triangles: [number, number, number][] = [];
  for (let x = 0; x < width - 1; x++) {
    for (let y = 0; y < height - 1; y++) {
      const a = index(x, y);
      const b = index(x + 1, y);
      const c = index(x + 1, y + 1);
      const d = index(x, y + 1);
      triangles.push([a, b, c], [a, c, d]);
    }
  }
  return triangles;
}
