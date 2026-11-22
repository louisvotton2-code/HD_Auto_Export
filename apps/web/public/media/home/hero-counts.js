// This homepage-only async script lets the server-rendered counters start before React.
(() => {
  const tag = 'hd-home-count';
  if (!window.customElements || customElements.get(tag)) return;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

  customElements.define(tag, class extends HTMLElement {
    frame;
    cleanup;

    connectedCallback() {
      const target = Number(this.dataset.countTo);
      const final = this.dataset.finalText;
      if (!final || !Number.isSafeInteger(target) || target <= 0) return;
      const formatter = new Intl.NumberFormat(this.lang, { maximumFractionDigits: 0 });
      const write = (value) => {
        if (this.dataset.counterValue === String(value)) return;
        this.textContent = value === target ? final : formatter.format(value);
        this.dataset.counterValue = String(value);
      };
      // Claim the SSR number before the next paint can reveal the fallback.
      const settle = this.hasAttribute('data-count-started') || getComputedStyle(this).visibility === 'hidden';
      if (settle) {
        // Updating text during parser insertion would concatenate it with the SSR zero.
        this.frame = requestAnimationFrame(() => {
          write(target);
          this.dataset.countStarted = '';
        });
        return;
      }
      this.dataset.countStarted = '';

      let elapsed = 0;
      let previousTime;
      const finish = () => {
        write(target);
        this.cleanup?.();
      };
      const tick = (time) => {
        this.frame = undefined;
        if (reducedMotion.matches) {
          finish();
          return;
        }
        if (document.hidden) return;
        // Start on a painted frame and cap long gaps so a busy iPhone still shows intermediate values.
        if (previousTime !== undefined) elapsed += Math.min(time - previousTime, 50);
        previousTime = time;
        const progress = Math.min(1, elapsed / 960);
        const value = Math.round(target * (1 - (1 - progress) ** 3));
        write(value);
        if (value < target) this.frame = requestAnimationFrame(tick);
        else this.cleanup?.();
      };
      const onMotionPreference = () => {
        if (reducedMotion.matches) finish();
      };
      const onVisibility = () => {
        cancelAnimationFrame(this.frame);
        this.frame = undefined;
        previousTime = undefined;
        if (!document.hidden) this.frame = requestAnimationFrame(tick);
      };
      this.cleanup = () => {
        cancelAnimationFrame(this.frame);
        this.frame = undefined;
        reducedMotion.removeEventListener?.('change', onMotionPreference);
        document.removeEventListener('visibilitychange', onVisibility);
        this.cleanup = undefined;
      };
      reducedMotion.addEventListener?.('change', onMotionPreference);
      document.addEventListener('visibilitychange', onVisibility);
      if (!document.hidden) this.frame = requestAnimationFrame(tick);
    }

    disconnectedCallback() {
      cancelAnimationFrame(this.frame);
      this.cleanup?.();
    }
  });
})();
