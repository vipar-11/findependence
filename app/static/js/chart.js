/**
 * Self-Contained Local Canvas Chart Engine (Chart.js-compatible subset for FinDependence India)
 * Zero external CDN dependencies — supports line charts, vertical bar charts, horizontal bar charts,
 * interactive tooltips, clickable legends, dashed lines, area fills, and custom point markers.
 */
(function (global) {
  'use strict';

  class LocalChart {
    constructor(ctxOrCanvas, config) {
      this.canvas = ctxOrCanvas && ctxOrCanvas.canvas ? ctxOrCanvas.canvas : ctxOrCanvas;
      this.ctx = this.canvas.getContext('2d');
      this.config = config || {};
      this.type = this.config.type || 'line';
      this.data = this.config.data || { labels: [], datasets: [] };
      this.options = this.config.options || {};
      this._hoverIndex = -1;
      this._legendBoxes = [];
      this._destroyed = false;

      this._onMouseMove = this._handleMouseMove.bind(this);
      this._onMouseLeave = this._handleMouseLeave.bind(this);
      this._onClick = this._handleClick.bind(this);
      this._onResize = () => {
        if (!this._destroyed) this.render();
      };

      this.canvas.addEventListener('mousemove', this._onMouseMove);
      this.canvas.addEventListener('mouseleave', this._onMouseLeave);
      this.canvas.addEventListener('click', this._onClick);
      window.addEventListener('resize', this._onResize);

      this.render();
    }

    destroy() {
      this._destroyed = true;
      this.canvas.removeEventListener('mousemove', this._onMouseMove);
      this.canvas.removeEventListener('mouseleave', this._onMouseLeave);
      this.canvas.removeEventListener('click', this._onClick);
      window.removeEventListener('resize', this._onResize);
    }

    update() {
      if (!this._destroyed) this.render();
    }

    _resizeCanvas() {
      const parent = this.canvas.parentElement;
      const dpr = window.devicePixelRatio || 1;
      const rect = parent ? parent.getBoundingClientRect() : this.canvas.getBoundingClientRect();
      const width = Math.max(260, Math.floor(rect.width || 600));
      const height = Math.max(180, Math.floor(rect.height || 300));

      if (this.canvas.width !== width * dpr || this.canvas.height !== height * dpr) {
        this.canvas.width = width * dpr;
        this.canvas.height = height * dpr;
        this.canvas.style.width = width + 'px';
        this.canvas.style.height = height + 'px';
      }
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      return { width, height };
    }

    _getVisibleDatasets() {
      return (this.data.datasets || [])
        .map((ds, idx) => ({ ds, idx }))
        .filter(({ ds }) => !ds.hidden);
    }

    _formatTick(scaleOpts, val) {
      const cb = scaleOpts && scaleOpts.ticks && scaleOpts.ticks.callback;
      if (typeof cb === 'function') {
        try {
          return String(cb(val));
        } catch (_e) {
          return String(val);
        }
      }
      return String(val);
    }

    render() {
      if (this._destroyed) return;
      const { width, height } = this._resizeCanvas();
      const ctx = this.ctx;
      ctx.clearRect(0, 0, width, height);

      const plugins = this.options.plugins || {};
      const legendOpts = plugins.legend || {};
      const showLegend = legendOpts.display !== false && (this.data.datasets || []).length > 0;

      let topPad = 16;
      this._legendBoxes = [];
      if (showLegend) {
        topPad = this._drawLegend(ctx, width);
      }

      const isHorizontal = this.options.indexAxis === 'y';
      if (this.type === 'bar' && isHorizontal) {
        this._drawHorizontalBarChart(ctx, width, height, topPad);
      } else if (this.type === 'bar') {
        this._drawVerticalBarChart(ctx, width, height, topPad);
      } else {
        this._drawLineChart(ctx, width, height, topPad);
      }
    }

    _drawLegend(ctx, width) {
      const datasets = this.data.datasets || [];
      ctx.save();
      ctx.font = '600 12px Inter, -apple-system, sans-serif';
      let x = 16;
      let y = 14;
      const itemGap = 20;

      datasets.forEach((ds, idx) => {
        const label = ds.label || `Series ${idx + 1}`;
        const textW = ctx.measureText(label).width;
        const boxW = 18 + textW;
        if (x + boxW > width - 16 && x > 16) {
          x = 16;
          y += 22;
        }
        const color = Array.isArray(ds.borderColor)
          ? ds.borderColor[0]
          : ds.borderColor || (Array.isArray(ds.backgroundColor) ? ds.backgroundColor[0] : ds.backgroundColor) || '#6366f1';

        ctx.globalAlpha = ds.hidden ? 0.4 : 1.0;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(x + 6, y + 6, 5, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#e2e8f0';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, x + 16, y + 6);

        this._legendBoxes.push({ x, y: y - 2, w: boxW, h: 18, datasetIndex: idx });
        x += boxW + itemGap;
      });
      ctx.restore();
      return y + 28;
    }

    _drawLineChart(ctx, width, height, topPad) {
      const labels = this.data.labels || [];
      const visible = this._getVisibleDatasets();
      const scales = this.options.scales || {};
      const xOpts = scales.x || {};
      const yOpts = scales.y || {};

      let yMax = typeof yOpts.max === 'number' ? yOpts.max : 0;
      if (!yMax) {
        visible.forEach(({ ds }) => {
          (ds.data || []).forEach((v) => {
            if (typeof v === 'number' && v > yMax) yMax = v;
          });
        });
      }
      if (yMax <= 0) yMax = 100;
      const yMin = typeof yOpts.min === 'number' ? yOpts.min : 0;

      const leftPad = 68;
      const rightPad = 18;
      const bottomPad = 32;
      const plotW = Math.max(50, width - leftPad - rightPad);
      const plotH = Math.max(50, height - topPad - bottomPad);

      this._plotArea = { left: leftPad, top: topPad, width: plotW, height: plotH, mode: 'x', count: labels.length };

      // Y gridlines & labels
      const yTicks = 5;
      ctx.save();
      ctx.font = '11px Inter, -apple-system, sans-serif';
      for (let i = 0; i <= yTicks; i++) {
        const frac = i / yTicks;
        const val = yMin + (yMax - yMin) * (1 - frac);
        const py = topPad + frac * plotH;

        ctx.strokeStyle = (yOpts.grid && yOpts.grid.color) || 'rgba(51, 65, 85, 0.25)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(leftPad, py);
        ctx.lineTo(leftPad + plotW, py);
        ctx.stroke();

        ctx.fillStyle = (yOpts.ticks && yOpts.ticks.color) || '#94a3b8';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.fillText(this._formatTick(yOpts, val), leftPad - 8, py);
      }

      // X labels
      const n = labels.length;
      const maxTicks = (xOpts.ticks && xOpts.ticks.maxTicksLimit) || 10;
      const step = Math.max(1, Math.ceil(n / maxTicks));
      for (let i = 0; i < n; i += step) {
        const px = leftPad + (n > 1 ? (i / (n - 1)) * plotW : plotW / 2);
        ctx.fillStyle = (xOpts.ticks && xOpts.ticks.color) || '#94a3b8';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(String(labels[i]), px, topPad + plotH + 8);
      }

      // Draw datasets
      visible.forEach(({ ds }) => {
        const pts = (ds.data || []).map((val, i) => {
          const px = leftPad + (n > 1 ? (i / (n - 1)) * plotW : plotW / 2);
          const clamped = Math.max(yMin, Math.min(yMax, Number(val) || 0));
          const py = topPad + (1 - (clamped - yMin) / Math.max(1e-9, yMax - yMin)) * plotH;
          return { x: px, y: py, raw: val, idx: i };
        });
        if (!pts.length) return;

        // Area fill
        if (ds.fill && ds.backgroundColor) {
          ctx.save();
          ctx.fillStyle = ds.backgroundColor;
          ctx.beginPath();
          ctx.moveTo(pts[0].x, topPad + plotH);
          pts.forEach((p) => ctx.lineTo(p.x, p.y));
          ctx.lineTo(pts[pts.length - 1].x, topPad + plotH);
          ctx.closePath();
          ctx.fill();
          ctx.restore();
        }

        // Line stroke
        ctx.save();
        ctx.strokeStyle = ds.borderColor || '#6366f1';
        ctx.lineWidth = ds.borderWidth || 2.5;
        if (Array.isArray(ds.borderDash) && ds.borderDash.length) {
          ctx.setLineDash(ds.borderDash);
        }
        ctx.beginPath();
        pts.forEach((p, i) => {
          if (i === 0) ctx.moveTo(p.x, p.y);
          else ctx.lineTo(p.x, p.y);
        });
        ctx.stroke();
        ctx.restore();

        // Point markers
        pts.forEach((p, i) => {
          const r = Array.isArray(ds.pointRadius)
            ? ds.pointRadius[i] || 0
            : typeof ds.pointRadius === 'number'
            ? ds.pointRadius
            : 0;
          const isHovered = i === this._hoverIndex;
          const drawR = isHovered ? Math.max(r, 6) : r;
          if (drawR > 0) {
            const bg = Array.isArray(ds.pointBackgroundColor)
              ? ds.pointBackgroundColor[i] || ds.borderColor
              : ds.pointBackgroundColor || ds.borderColor || '#6366f1';
            ctx.save();
            ctx.fillStyle = bg;
            ctx.strokeStyle = ds.pointBorderColor || '#ffffff';
            ctx.lineWidth = ds.pointBorderWidth || 1.5;
            ctx.beginPath();
            ctx.arc(p.x, p.y, drawR, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
            ctx.restore();
          }
        });
      });

      // Hover guideline & tooltip
      if (this._hoverIndex >= 0 && this._hoverIndex < n) {
        const hx = leftPad + (n > 1 ? (this._hoverIndex / (n - 1)) * plotW : plotW / 2);
        ctx.strokeStyle = 'rgba(148, 163, 184, 0.35)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(hx, topPad);
        ctx.lineTo(hx, topPad + plotH);
        ctx.stroke();

        this._drawTooltip(ctx, width, height, hx, topPad + 16, this._hoverIndex);
      }

      ctx.restore();
    }

    _drawVerticalBarChart(ctx, width, height, topPad) {
      const labels = this.data.labels || [];
      const visible = this._getVisibleDatasets();
      const scales = this.options.scales || {};
      const xOpts = scales.x || {};
      const yOpts = scales.y || {};

      let yMax = 0;
      visible.forEach(({ ds }) => {
        (ds.data || []).forEach((v) => {
          if (typeof v === 'number' && v > yMax) yMax = v;
        });
      });
      yMax = yMax > 0 ? yMax * 1.15 : 100;

      const leftPad = 60;
      const rightPad = 16;
      const bottomPad = 36;
      const plotW = Math.max(50, width - leftPad - rightPad);
      const plotH = Math.max(50, height - topPad - bottomPad);
      const n = labels.length;

      this._plotArea = { left: leftPad, top: topPad, width: plotW, height: plotH, mode: 'bar-v', count: n };

      ctx.save();
      ctx.font = '10px Inter, -apple-system, sans-serif';

      // Y gridlines
      const yTicks = 4;
      for (let i = 0; i <= yTicks; i++) {
        const frac = i / yTicks;
        const val = yMax * (1 - frac);
        const py = topPad + frac * plotH;
        ctx.strokeStyle = (yOpts.grid && yOpts.grid.color) || 'rgba(51, 65, 85, 0.25)';
        ctx.beginPath();
        ctx.moveTo(leftPad, py);
        ctx.lineTo(leftPad + plotW, py);
        ctx.stroke();

        ctx.fillStyle = '#94a3b8';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.fillText(this._formatTick(yOpts, Math.round(val * 10) / 10), leftPad - 8, py);
      }

      if (n > 0 && visible.length > 0) {
        const groupW = plotW / n;
        const barW = Math.min(38, (groupW * 0.72) / visible.length);

        for (let i = 0; i < n; i++) {
          const groupStart = leftPad + i * groupW + (groupW - barW * visible.length) / 2;
          visible.forEach(({ ds }, sIdx) => {
            const val = Number((ds.data || [])[i]) || 0;
            const bh = Math.max(0, (val / yMax) * plotH);
            const bx = groupStart + sIdx * barW;
            const by = topPad + plotH - bh;
            const color = Array.isArray(ds.backgroundColor)
              ? ds.backgroundColor[i % ds.backgroundColor.length]
              : ds.backgroundColor || '#6366f1';

            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.roundRect ? ctx.roundRect(bx, by, Math.max(2, barW - 2), bh, 4) : ctx.rect(bx, by, Math.max(2, barW - 2), bh);
            ctx.fill();
          });

          ctx.fillStyle = (xOpts.ticks && xOpts.ticks.color) || '#94a3b8';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'top';
          const lbl = String(labels[i]);
          ctx.fillText(lbl.length > 14 ? lbl.slice(0, 13) + '…' : lbl, leftPad + (i + 0.5) * groupW, topPad + plotH + 8);
        }
      }

      if (this._hoverIndex >= 0 && this._hoverIndex < n) {
        const hx = leftPad + (this._hoverIndex + 0.5) * (plotW / Math.max(1, n));
        this._drawTooltip(ctx, width, height, hx, topPad + 16, this._hoverIndex);
      }
      ctx.restore();
    }

    _drawHorizontalBarChart(ctx, width, height, topPad) {
      const labels = this.data.labels || [];
      const visible = this._getVisibleDatasets();
      const scales = this.options.scales || {};
      const xOpts = scales.x || {};

      let xMax = 0;
      visible.forEach(({ ds }) => {
        (ds.data || []).forEach((v) => {
          if (typeof v === 'number' && v > xMax) xMax = v;
        });
      });
      xMax = xMax > 0 ? xMax * 1.12 : 100;

      const leftPad = 175;
      const rightPad = 20;
      const bottomPad = 28;
      const plotW = Math.max(50, width - leftPad - rightPad);
      const plotH = Math.max(50, height - topPad - bottomPad);
      const n = labels.length;

      this._plotArea = { left: leftPad, top: topPad, width: plotW, height: plotH, mode: 'bar-h', count: n };

      ctx.save();
      ctx.font = '11px Inter, -apple-system, sans-serif';

      // X gridlines
      const xTicks = 4;
      for (let i = 0; i <= xTicks; i++) {
        const frac = i / xTicks;
        const val = xMax * frac;
        const px = leftPad + frac * plotW;
        ctx.strokeStyle = 'rgba(51, 65, 85, 0.25)';
        ctx.beginPath();
        ctx.moveTo(px, topPad);
        ctx.lineTo(px, topPad + plotH);
        ctx.stroke();

        ctx.fillStyle = '#94a3b8';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(this._formatTick(xOpts, val), px, topPad + plotH + 6);
      }

      if (n > 0 && visible.length > 0) {
        const rowH = plotH / n;
        const barH = Math.min(22, rowH * 0.68);
        const ds = visible[0].ds;

        for (let i = 0; i < n; i++) {
          const val = Number((ds.data || [])[i]) || 0;
          const bw = Math.max(2, (val / xMax) * plotW);
          const by = topPad + i * rowH + (rowH - barH) / 2;
          const color = Array.isArray(ds.backgroundColor)
            ? ds.backgroundColor[i % ds.backgroundColor.length]
            : ds.backgroundColor || '#6366f1';

          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.roundRect ? ctx.roundRect(leftPad, by, bw, barH, 4) : ctx.rect(leftPad, by, bw, barH);
          ctx.fill();

          ctx.fillStyle = '#f1f5f9';
          ctx.textAlign = 'right';
          ctx.textBaseline = 'middle';
          const lbl = String(labels[i]);
          ctx.fillText(lbl.length > 24 ? lbl.slice(0, 23) + '…' : lbl, leftPad - 10, topPad + (i + 0.5) * rowH);
        }
      }

      if (this._hoverIndex >= 0 && this._hoverIndex < n) {
        this._drawTooltip(ctx, width, height, leftPad + plotW * 0.45, topPad + 16, this._hoverIndex);
      }
      ctx.restore();
    }

    _drawTooltip(ctx, width, _height, anchorX, anchorY, dataIndex) {
      const labels = this.data.labels || [];
      const visible = this._getVisibleDatasets();
      const tooltipOpts = (this.options.plugins && this.options.plugins.tooltip) || {};
      const callbacks = tooltipOpts.callbacks || {};

      const lines = [String(labels[dataIndex] || '')];
      const items = [];

      visible.forEach(({ ds }) => {
        const raw = (ds.data || [])[dataIndex];
        const ctxItem = { dataset: ds, raw, dataIndex };
        items.push(ctxItem);
        if (typeof callbacks.label === 'function') {
          lines.push(callbacks.label(ctxItem));
        } else {
          lines.push(`${ds.label || 'Value'}: ${raw}`);
        }
      });

      if (typeof callbacks.afterBody === 'function') {
        const extra = callbacks.afterBody(items) || [];
        extra.forEach((l) => lines.push(l));
      }

      ctx.save();
      ctx.font = '11px Inter, -apple-system, sans-serif';
      let maxW = 0;
      lines.forEach((l) => {
        const w = ctx.measureText(l).width;
        if (w > maxW) maxW = w;
      });

      const pad = 10;
      const lineH = 16;
      const boxW = Math.min(width - 20, maxW + pad * 2);
      const boxH = lines.length * lineH + pad * 1.5;
      let bx = anchorX + 12;
      if (bx + boxW > width - 10) bx = Math.max(10, anchorX - boxW - 12);
      const by = Math.max(8, anchorY);

      ctx.fillStyle = tooltipOpts.backgroundColor || 'rgba(15, 23, 42, 0.96)';
      ctx.strokeStyle = tooltipOpts.borderColor || '#334155';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect ? ctx.roundRect(bx, by, boxW, boxH, 6) : ctx.rect(bx, by, boxW, boxH);
      ctx.fill();
      ctx.stroke();

      lines.forEach((l, idx) => {
        ctx.fillStyle = idx === 0 ? '#ffffff' : '#cbd5e1';
        ctx.font = idx === 0 ? '700 11px Inter, sans-serif' : '500 11px Inter, sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText(l, bx + pad, by + pad * 0.75 + idx * lineH);
      });
      ctx.restore();
    }

    _handleMouseMove(e) {
      if (!this._plotArea || !this._plotArea.count) return;
      const rect = this.canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const { left, top, width, height, mode, count } = this._plotArea;

      if (mx < left || mx > left + width || my < top || my > top + height) {
        if (this._hoverIndex !== -1) {
          this._hoverIndex = -1;
          this.render();
        }
        return;
      }

      let idx = -1;
      if (mode === 'x') {
        idx = count > 1 ? Math.round(((mx - left) / width) * (count - 1)) : 0;
      } else if (mode === 'bar-v') {
        idx = Math.min(count - 1, Math.floor(((mx - left) / width) * count));
      } else if (mode === 'bar-h') {
        idx = Math.min(count - 1, Math.floor(((my - top) / height) * count));
      }

      if (idx !== this._hoverIndex) {
        this._hoverIndex = idx;
        this.render();
      }
    }

    _handleMouseLeave() {
      if (this._hoverIndex !== -1) {
        this._hoverIndex = -1;
        this.render();
      }
    }

    _handleClick(e) {
      const rect = this.canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      for (const box of this._legendBoxes) {
        if (mx >= box.x && mx <= box.x + box.w && my >= box.y && my <= box.y + box.h) {
          const legendOpts = (this.options.plugins && this.options.plugins.legend) || {};
          if (typeof legendOpts.onClick === 'function') {
            legendOpts.onClick(e, { datasetIndex: box.datasetIndex });
          } else {
            const ds = this.data.datasets[box.datasetIndex];
            if (ds) ds.hidden = !ds.hidden;
            this.render();
          }
          return;
        }
      }
    }
  }

  global.Chart = LocalChart;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { LocalChart, Chart: LocalChart };
  }
})(typeof window !== 'undefined' ? window : globalThis);
