(function (ChatWidget) {
    'use strict';

    const colors = ['#52040b', '#790912', '#9e101d', '#b91b29', '#d12c37'];

    // Shares the bounded canvas, animation loop and reduced-motion lifecycle
    // with dust. Only geometry is captured; removed content is never retained.
    ChatWidget.BloodEffects = class extends ChatWidget.DustEffects {
        get layerClass() {
            return 'blood-layer';
        }
        get selector() {
            return '.body';
        }
        particleCount(area) {
            return Math.min(128, Math.max(48, Math.ceil(area / 140)));
        }
        createParticle(region, now) {
            const angle = Math.random() * Math.PI * 2;
            const speed = 90 + Math.random() * 220;
            return {
                x: region.left + Math.random() * region.width,
                y: region.top + region.height * (0.15 + Math.random() * 0.7),
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed * 0.55 - 120,
                size: 1.4 + Math.random() ** 2 * 5.4,
                color: colors[Math.floor(Math.random() * colors.length)],
                born: now,
                life: 720 + Math.random() * 480
            };
        }
        drawParticle(ctx, particle, progress, seconds) {
            const drag = Math.exp(-2.4 * seconds);
            const distance = (1 - drag) / 2.4;
            const vx = particle.vx * drag;
            const vy = particle.vy * drag + 680 * seconds;
            const radius = particle.size * (1 - progress * 0.3);
            const stretch = Math.min(2.7, 1 + Math.hypot(vx, vy) / 220);
            ctx.beginPath();
            ctx.ellipse(
                particle.x + particle.vx * distance,
                particle.y + particle.vy * distance + 340 * seconds * seconds,
                radius * stretch,
                radius,
                Math.atan2(vy, vx),
                0,
                Math.PI * 2
            );
            ctx.fill();
        }
    };
})(window.ChatWidget);
