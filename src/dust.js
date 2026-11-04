(function (ChatWidget) {
    'use strict';

    // Capture geometry and colors only; deleted text and images are never retained.
    ChatWidget.DustEffects = class {
        constructor() {
            this.particles = [];
            this.frame = null;
            this.motion =
                typeof window.matchMedia === 'function'
                    ? window.matchMedia('(prefers-reduced-motion: reduce)')
                    : null;
        }
        burst(row) {
            if (this.motion?.matches) {
                return;
            }
            const width = window.innerWidth;
            const height = window.innerHeight;
            if (!width || !height) {
                return;
            }
            const regions = [];
            for (const node of row.querySelectorAll('.name, .body, .badge, .emote')) {
                const color = window.getComputedStyle(node).color || '#ffffff';
                for (const rect of node.getClientRects()) {
                    const left = Math.max(0, rect.left);
                    const right = Math.min(width, rect.right);
                    const top = Math.max(0, rect.top);
                    const bottom = Math.min(height, rect.bottom);
                    if (right > left && bottom > top) {
                        regions.push({
                            left,
                            top,
                            width: right - left,
                            height: bottom - top,
                            color
                        });
                    }
                    if (regions.length >= 24) {
                        break;
                    }
                }
                if (regions.length >= 24) {
                    break;
                }
            }
            if (!regions.length) {
                return;
            }
            if (!this.canvas) {
                this.canvas = document.createElement('canvas');
                this.canvas.className = 'dust-layer';
                this.canvas.setAttribute('aria-hidden', 'true');
                this.context = this.canvas.getContext('2d');
                if (!this.context) {
                    this.canvas = null;
                    return;
                }
                document.body.appendChild(this.canvas);
            }
            const pixelWidth = Math.min(3840, Math.ceil(width));
            const pixelHeight = Math.min(2160, Math.ceil(height));
            if (this.canvas.width !== pixelWidth || this.canvas.height !== pixelHeight) {
                this.canvas.width = pixelWidth;
                this.canvas.height = pixelHeight;
            }
            this.context.setTransform(pixelWidth / width, 0, 0, pixelHeight / height, 0, 0);
            const now = performance.now();
            const area = regions.reduce((total, region) => total + region.width * region.height, 0);
            const count = Math.min(100, Math.max(24, Math.ceil(area / 170)));
            for (let index = 0; index < count; index++) {
                let pick = Math.random() * area;
                let region = regions[0];
                for (const candidate of regions) {
                    region = candidate;
                    pick -= candidate.width * candidate.height;
                    if (pick <= 0) {
                        break;
                    }
                }
                this.particles.push({
                    x: region.left + Math.random() * region.width,
                    y: region.top + region.height * (0.2 + Math.random() * 0.6),
                    vx: 25 + Math.random() * 100,
                    vy: -15 - Math.random() * 55,
                    size: 1 + Math.random() * 1.8,
                    color: region.color,
                    born: now,
                    life: 420 + Math.random() * 220
                });
            }
            if (this.particles.length > 512) {
                this.particles.splice(0, this.particles.length - 512);
            }
            if (this.frame === null) {
                this.frame = requestAnimationFrame((time) => this.draw(time));
            }
        }
        draw(now) {
            this.frame = null;
            if (this.motion?.matches) {
                this.stop();
                return;
            }
            const ctx = this.context;
            if (!ctx) {
                return;
            }
            ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
            let live = 0;
            for (const particle of this.particles) {
                const age = now - particle.born;
                if (age >= particle.life) {
                    continue;
                }
                this.particles[live++] = particle;
                const progress = Math.max(0, age / particle.life);
                const seconds = age / 1000;
                ctx.globalAlpha = (1 - progress) ** 1.5;
                ctx.fillStyle = particle.color;
                const size = particle.size * (1 - progress * 0.65);
                ctx.fillRect(
                    particle.x + particle.vx * seconds,
                    particle.y + particle.vy * seconds - 12 * seconds * seconds,
                    size,
                    size
                );
            }
            this.particles.length = live;
            ctx.globalAlpha = 1;
            if (live) {
                this.frame = requestAnimationFrame((time) => this.draw(time));
            } else {
                this.stop();
            }
        }
        stop() {
            if (this.frame !== null) {
                cancelAnimationFrame(this.frame);
            }
            this.frame = null;
            this.particles.length = 0;
            this.canvas?.remove();
            this.canvas = null;
            this.context = null;
        }
    };
})(window.ChatWidget);
