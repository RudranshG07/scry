export type Box = { left: number; top: number; width: number; height: number };

/**
 * Where the frame actually sits inside a box that crops it, the way
 * `object-fit: cover` does, so anything drawn in frame coordinates lands on the
 * pixels it belongs on rather than on the crop.
 */
export function coverBox(
  frame: { width: number; height: number },
  box: { width: number; height: number },
): Box {
  if (!(frame.width > 0 && frame.height > 0 && box.width > 0 && box.height > 0)) {
    return { left: 0, top: 0, width: box.width, height: box.height };
  }
  const scale = Math.max(box.width / frame.width, box.height / frame.height);
  const width = frame.width * scale;
  const height = frame.height * scale;
  return { left: (box.width - width) / 2, top: (box.height - height) / 2, width, height };
}

export type CountLine = { from: [number, number]; to: [number, number] };

/**
 * The line this market is counted across, in fractions of the frame. It is the
 * same line the observers use, so what is drawn is what is counted rather than
 * a decoration.
 */
export function countLine(claim?: { kind?: string; options?: Record<string, unknown> }): CountLine | null {
  if (!claim || claim.kind !== "crossings") return null;
  const line = claim.options?.line;
  if (!Array.isArray(line) || line.length !== 2) return null;

  const points = line.map((point) =>
    Array.isArray(point) && point.length === 2 && point.every((value) => typeof value === "number" && value >= 0 && value <= 1)
      ? ([point[0], point[1]] as [number, number])
      : null,
  );
  if (points.some((point) => point === null)) return null;
  return { from: points[0] as [number, number], to: points[1] as [number, number] };
}
