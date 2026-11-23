import { affine, equal, N, P } from "./toy-curve.mjs";

export const colors = {
  violet: "#c6a7ff",
  cyan: "#9dece1",
  gold: "#ffc296",
  faint: "#8e72b7",
  grid: "#382e49",
  axis: "#766587",
  text: "#c3b9d1",
};

const painters = new Map();
const observer = new ResizeObserver(entries => {
  for (const { target } of entries) repaint(target);
});

function repaint(canvas) {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (!w || !h) return;
  const density = Math.min(window.devicePixelRatio || 1, 3);
  canvas.width = Math.round(w * density);
  canvas.height = Math.round(h * density);
  const context = canvas.getContext("2d");
  if (!context) return;
  context.scale(density, density);
  painters.get(canvas)(context, w, h);
}

export function paint(canvas, draw) {
  if (!painters.has(canvas)) {
    const [width, height] = canvas.dataset.size.split(" ").map(Number);
    canvas.style.aspectRatio = `${width} / ${height}`;
    observer.observe(canvas);
  }
  painters.set(canvas, draw);
  repaint(canvas);
}

function line(context, x1, y1, x2, y2, color, width = 1) {
  context.beginPath();
  context.moveTo(x1, y1);
  context.lineTo(x2, y2);
  context.lineWidth = width;
  context.strokeStyle = color;
  context.stroke();
}

function dot(context, x, y, radius, color, ring = false) {
  context.beginPath();
  context.arc(x, y, radius, 0, Math.PI * 2);
  if (ring) {
    context.lineWidth = 2;
    context.strokeStyle = color;
    context.stroke();
  } else {
    context.fillStyle = color;
    context.fill();
  }
}

function label(context, value, x, y, {
  color = colors.text, align = "center", size = 12, bold = false,
} = {}) {
  context.font = `${bold ? "700 " : ""}${size}px ui-monospace, monospace`;
  context.textAlign = align;
  context.textBaseline = "middle";
  context.fillStyle = color;
  context.fillText(value, x, y);
}

export function finitePlot(canvas, highlights = [], hero = false) {
  paint(canvas, (context, w, h) => {
    const left = 35;
    const top = 23;
    const right = w - 29;
    const bottom = h - 31;
    const xAt = x => left + (right - left) * x / (P - 1);
    const yAt = y => bottom - (bottom - top) * y / (P - 1);
    for (let i = 0; i < P; i++) {
      const weight = i % 4 === 0 ? 1 : .55;
      line(context, xAt(i), top, xAt(i), bottom, colors.grid, weight);
      line(context, left, yAt(i), right, yAt(i), colors.grid, weight);
      if (i % 4 === 0) {
        label(context, i, xAt(i), bottom + 15, { size: 11 });
        label(context, i, left - 9, yAt(i), { align: "right", size: 11 });
      }
    }
    line(context, left, bottom, right + 5, bottom, colors.axis);
    line(context, left, bottom, left, top - 7, colors.axis);
    label(context, "x", right + 17, bottom + 15);
    label(context, "y", left - 9, top - 13, { align: "right" });
    for (const [x, y] of affine) {
      if (hero) dot(context, xAt(x), yAt(y), 7, "#7853ac3b");
      dot(context, xAt(x), yAt(y), hero ? 3.6 : 3.2, colors.faint);
    }
    const [first, second] = highlights;
    if (first?.point && second?.point && first.point[0] === second.point[0] &&
        first.point[1] !== second.point[1]) {
      const [[x, y1], [, y2]] = [first.point, second.point];
      context.setLineDash([4, 4]);
      line(context, xAt(x), yAt(y1), xAt(x), yAt(y2), colors.axis);
      context.setLineDash([]);
    }
    highlights.forEach(({ point, color, name }, index) => {
      if (!point) return; // The identity is reported in the adjacent text.
      const [x, y] = point;
      const coincidentLater = highlights.slice(index + 1).filter(item => equal(item.point, point)).length;
      const px = xAt(x);
      const py = yAt(y);
      if (hero) {
        const halo = context.createRadialGradient(px, py, 2, px, py, 20);
        halo.addColorStop(0, `${color}69`);
        halo.addColorStop(1, `${color}00`);
        dot(context, px, py, 20, halo);
      }
      const ring = coincidentLater > 0 || name === "other";
      dot(context, px, py, 5 + coincidentLater * 4, color, ring);
      if (hero && name) label(context, name, px + 9, py - 10, { color, align: "left", bold: true });
    });
  });
}

export function realPlot(canvas, coefficients, construction = null) {
  paint(canvas, (context, w, h) => {
    const [a, b] = coefficients;
    const xMin = -1.7, xMax = 2.25, yMin = -2.65, yMax = 2.65;
    const xAt = x => 28 + (w - 55) * (x - xMin) / (xMax - xMin);
    const yAt = y => h - 21 - (h - 45) * (y - yMin) / (yMax - yMin);
    for (let i = -2; i <= 2; i++) {
      if (i >= -1) line(context, xAt(i), yAt(yMin), xAt(i), yAt(yMax), i ? colors.grid : colors.axis);
      line(context, xAt(xMin), yAt(i), xAt(xMax), yAt(i), i ? colors.grid : colors.axis);
    }
    label(context, "x", xAt(xMax) + 8, yAt(0) + 12);
    label(context, "y", xAt(0) - 12, yAt(yMax));
    context.save();
    context.beginPath();
    context.rect(xAt(xMin), yAt(yMax), xAt(xMax) - xAt(xMin), yAt(yMin) - yAt(yMax));
    context.clip();
    for (const sign of [-1, 1]) {
      context.beginPath();
      let started = false;
      for (let i = 0; i <= 480; i++) {
        const x = xMin + (xMax - xMin) * i / 480;
        const value = x ** 3 + a * x + b;
        if (value < 0) {
          started = false;
          continue;
        }
      // Begin a new stroke at the first real solution after crossing a root.
        if (!started) {
          context.moveTo(xAt(x), yAt(sign * Math.sqrt(value)));
          started = true;
        } else {
          context.lineTo(xAt(x), yAt(sign * Math.sqrt(value)));
        }
      }
      context.strokeStyle = colors.violet;
      context.lineWidth = 2;
      context.stroke();
    }
    const drawPoint = (x, y, color, text, align = "left") => {
      const px = xAt(x), py = yAt(y);
      dot(context, px, py, 4.7, color);
      label(context, text, px + (align === "left" ? 8 : -8), py + (y < 0 ? 13 : -13), { color, align });
    };
    if (construction) {
      const { kind, step } = construction;
      const isChord = kind === "chord";
      const isVertical = kind === "vertical";
      const tx = isChord ? 1 : .25;
      const ty = isChord ? 1 : .875;
      if (isVertical) line(context, xAt(0), yAt(yMin), xAt(0), yAt(yMax), colors.gold, 2);
      else {
        const lineY = x => isChord ? 1 : 1 - x / 2;
        line(context, xAt(xMin), yAt(lineY(xMin)), xAt(xMax), yAt(lineY(xMax)), colors.gold, 2);
      }
      if (isChord) drawPoint(-1, 1, colors.violet, "P₁");
      drawPoint(0, 1, colors.violet, isChord ? "P₂" : "P", isChord ? "left" : "right");
      if (isVertical) {
        drawPoint(0, -1, colors.violet, "−P", "right");
        if (step >= 2) label(context, "𝒪 lies at infinity", xAt(0) + 10, yAt(yMax) + 10, { color: colors.gold, align: "left" });
      } else if (step >= 2) {
        drawPoint(tx, ty, colors.gold, "T");
        if (step >= 3) {
          context.setLineDash([4, 4]);
          line(context, xAt(tx), yAt(ty), xAt(tx), yAt(-ty), colors.cyan);
          context.setLineDash([]);
          drawPoint(tx, -ty, colors.cyan, "−T");
        }
      }
    } else if (a === -1) {
      drawPoint(0, 1, colors.gold, "P");
      drawPoint(0, -1, colors.cyan, "−P");
    }
    context.restore();
  });
}

export function ringPlot(canvas, size, highlights, center, subtitle, suffix = "") {
  paint(canvas, (context, w, h) => {
    const cx = w / 2, cy = h / 2;
    const radius = Math.min(cx, cy) - 31;
    dot(context, cx, cy, radius, colors.axis, true);
    for (let i = 0; i < size; i++) {
      const angle = 2 * Math.PI * i / size - Math.PI / 2;
      const dx = Math.cos(angle), dy = Math.sin(angle);
      const color = highlights.get(i) || colors.faint;
      dot(context, cx + dx * radius, cy + dy * radius, highlights.has(i) ? 5 : 3, color);
      label(context, `${i}${suffix}`, cx + dx * (radius + 18), cy + dy * (radius + 16), {
        color: highlights.get(i) || colors.text, size: 11,
      });
    }
    label(context, center, cx, cy - 9, { color: colors.cyan, size: 21, bold: true });
    label(context, subtitle, cx, cy + 16, { size: 12 });
  });
}

export function cyclePlot(canvas) {
  ringPlot(canvas, N, new Map([[0, colors.cyan], [1, colors.violet]]), "19G = 𝒪", "One full cycle", "G");
}
