// This homepage-only async script lets the server-rendered counters start before React.
(() => {
  const tag = 'hd-home-count';
  if (!window.customElements || customElements.get(tag)) return;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

  customElements.define(tag, class extends HTMLElement {
    frame = 0;
    cleanup;

    connectedCallback() {
      // Wait for the parser or a client navigation to finish inserting the number.
      this.frame = requestAnimationFrame((start) => {
        const target = Number(this.dataset.countTo);
        const final = this.dataset.finalText;
        if (!this.isConnected || !final || !Number.isSafeInteger(target) || target <= 0) return;
        const formatter = new Intl.NumberFormat(this.lang, { maximumFractionDigits: 0 });
        const write = (value) => {
          if (this.dataset.counterValue === String(value)) return;
          this.textContent = value === target ? final : formatter.format(value);
          this.dataset.counterValue = String(value);
        };
        // If the static value is already showing, do not jump backwards to zero.
        const settle = this.hasAttribute('data-count-started') || getComputedStyle(this).visibility === 'hidden';
        if (settle || reducedMotion.matches || document.hidden) {
          write(target);
          this.dataset.countStarted = '';
          return;
        }
        this.dataset.countStarted = '';
        const finish = () => {
          write(target);
          this.cleanup?.();
        };
        const tick = (time) => {
          if (!this.isConnected) return;
          const progress = reducedMotion.matches || document.hidden ? 1 : Math.min(1, Math.max(0, (time - start) / 960));
          const value = Math.round(target * (1 - (1 - progress) ** 3));
          write(value);
          if (value < target) this.frame = requestAnimationFrame(tick);
          else this.cleanup?.();
        };
        const onMotionPreference = () => {
          if (reducedMotion.matches) finish();
        };
        // Clear a paused count on background tabs even if the browser pauses RAF.
        const deadline = window.setTimeout(finish, 1000);
        this.cleanup = () => {
          cancelAnimationFrame(this.frame);
          window.clearTimeout(deadline);
          reducedMotion.removeEventListener?.('change', onMotionPreference);
          this.cleanup = undefined;
        };
        reducedMotion.addEventListener?.('change', onMotionPreference);
        this.frame = requestAnimationFrame(tick);
      });
    }

    disconnectedCallback() {
      cancelAnimationFrame(this.frame);
      this.cleanup?.();
    }
  });
})();
