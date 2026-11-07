/** Homepage presentation only. Coordinates and rates use CSS px and a 60 Hz time base. */
type Ripple = {
  x: number;
  y: number;
  radius: number;
  speed: number;
  alpha: number;
  lineWidth: number;
};
type Droplet = {
  x: number;
  y: number;
  radius: number;
  speed: number;
  alpha: number;
  color: string;
};
type Brush = { x: number; y: number; angle: number; length: number; width: number };
export type RippleScene = {
  ripples: Ripple[];
  droplets: Droplet[];
  pointer: { x: number; y: number } | null;
  autoElapsed: number;
  brushes: Brush[];
};
const COPPER = '182,119,73';

export function createRippleScene(): RippleScene {
  return {
    ripples: [],
    droplets: [],
    pointer: null,
    autoElapsed: 0,
    brushes: Array.from({ length: 15 }, () => ({
      x: Math.random(),
      y: Math.random(),
      angle: Math.random() * Math.PI * 2,
      length: 50 + Math.random() * 200,
      width: 10 + Math.random() * 40,
    })),
  };
}

export function addRipple(scene: RippleScene, x: number, y: number) {
  // Bound rapid repeated clicks independently of the reference's ambient wave limit.
  if (scene.ripples.length >= 24) scene.ripples.shift();
  scene.ripples.push({
    x,
    y,
    radius: 0,
    speed: 2 + Math.random() * 3,
    alpha: 0.6 + Math.random() * 0.4,
    lineWidth: 1 + Math.random() * 3,
  });
  const count = 4 + Math.floor(Math.random() * 5);
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2,
      distance = Math.random() * 60;
    scene.droplets.push({
      x: x + Math.cos(angle) * distance,
      y: y + Math.sin(angle) * distance,
      radius: 2 + Math.random() * 8,
      speed: 0.5 + Math.random() * 1.5,
      alpha: 0.4 + Math.random() * 0.6,
      color: Math.random() < 0.75 ? '#b67749' : '#9d5e34',
    });
  }
  if (scene.droplets.length > 192) scene.droplets.splice(0, scene.droplets.length - 192);
}

export function advanceRippleScene(
  scene: RippleScene,
  deltaMs: number,
  width: number,
  height: number,
) {
  const frames = (Math.min(50, Math.max(0, deltaMs)) * 60) / 1000;
  const slowing = Math.pow(0.995, frames);
  for (const wave of scene.ripples) {
    wave.radius += (wave.speed * (1 - slowing)) / (1 - 0.995);
    wave.speed *= slowing;
    wave.alpha -= 0.003 * frames;
  }
  scene.ripples = scene.ripples.filter((wave) => wave.alpha > 0);
  for (const p of scene.droplets) {
    p.y += p.speed * frames;
    p.alpha -= 0.002 * frames;
    p.radius *= Math.pow(0.999, frames);
  }
  scene.droplets = scene.droplets.filter((p) => p.alpha > 0 && p.y < height + 20);
  scene.autoElapsed += Math.min(50, Math.max(0, deltaMs));
  if (scene.autoElapsed >= 1500) {
    scene.autoElapsed %= 1500;
    if (scene.ripples.length < 5) addRipple(scene, Math.random() * width, Math.random() * height);
  }
}

function glow(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, alpha: number) {
  if (radius <= 0) return;
  const light = ctx.createRadialGradient(x, y, 0, x, y, radius);
  light.addColorStop(0, `rgba(200,136,88,${alpha})`);
  light.addColorStop(1, 'rgba(200,136,88,0)');
  ctx.fillStyle = light;
  ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
}

export function drawRippleScene(
  ctx: CanvasRenderingContext2D,
  scene: RippleScene,
  width: number,
  height: number,
) {
  if (width <= 0 || height <= 0) return;
  ctx.globalAlpha = 1;
  const backdrop = ctx.createRadialGradient(
    width / 2,
    height / 2,
    0,
    width / 2,
    height / 2,
    width * 0.8,
  );
  backdrop.addColorStop(0, '#0f0f0f');
  backdrop.addColorStop(1, '#0a0a0a');
  ctx.fillStyle = backdrop;
  ctx.fillRect(0, 0, width, height);
  // Faint stationary brush texture avoids frame-to-frame random flicker behind the text.
  for (const brush of scene.brushes) {
    ctx.save();
    ctx.translate(brush.x * width, brush.y * height);
    ctx.rotate(brush.angle);
    const shade = ctx.createLinearGradient(0, 0, brush.length, 0);
    shade.addColorStop(0, 'rgba(182,119,73,0)');
    shade.addColorStop(0.5, 'rgba(182,119,73,.025)');
    shade.addColorStop(1, 'rgba(182,119,73,0)');
    ctx.fillStyle = shade;
    ctx.fillRect(0, -brush.width / 2, brush.length, brush.width);
    ctx.restore();
  }
  for (const wave of scene.ripples) {
    glow(ctx, wave.x, wave.y, wave.radius, wave.alpha * 0.1);
    for (let ring = 0; ring < 3; ring++) {
      const radius = wave.radius - ring * 15;
      if (radius <= 0) continue;
      ctx.beginPath();
      ctx.arc(wave.x, wave.y, radius, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(${COPPER},${wave.alpha * (1 - ring * 0.3)})`;
      ctx.lineWidth = wave.lineWidth * (1 - ring * 0.2);
      ctx.stroke();
    }
  }
  for (const p of scene.droplets) {
    ctx.globalAlpha = p.alpha;
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.3)';
    ctx.beginPath();
    ctx.arc(p.x - p.radius * 0.3, p.y - p.radius * 0.3, p.radius * 0.3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  if (scene.pointer) glow(ctx, scene.pointer.x, scene.pointer.y, 40, 0.15);
}
