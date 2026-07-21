import type {
  IChartApi,
  ISeriesApi,
  ISeriesPrimitive,
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  SeriesType,
  Time,
} from 'lightweight-charts';
import type { InstitutionalOverlaySpec } from '@/src/lib/analytics/institutional-sr/overlay-spec';

interface BitmapScope {
  context: CanvasRenderingContext2D;
  bitmapSize: { width: number; height: number };
  horizontalPixelRatio: number;
  verticalPixelRatio: number;
}
interface BitmapTarget {
  useBitmapCoordinateSpace(callback: (scope: BitmapScope) => void): void;
}

const LABEL_FONT = '11px system-ui, -apple-system, sans-serif';
const LABEL_HEIGHT = 15;

/**
 * A lightweight-charts series primitive that paints the institutional overlays:
 * translucent demand/supply zone bands and labeled POC/VAH/VAL/AVWAP lines. It
 * reads price→coordinate from the attached series each frame, so it follows zoom
 * and pan without recreating anything. All drawing is guarded against a detached
 * series/chart, keeping overlay updates disposal-safe.
 */
export class InstitutionalOverlayPrimitive implements ISeriesPrimitive<Time> {
  private spec: InstitutionalOverlaySpec = { bands: [], lines: [] };
  private series: ISeriesApi<SeriesType> | null = null;
  private requestUpdate: (() => void) | null = null;
  private readonly view: IPrimitivePaneView;

  constructor() {
    const renderer: IPrimitivePaneRenderer = {
      draw: (target: unknown) => this.draw(target as BitmapTarget),
    };
    this.view = { renderer: () => renderer, zOrder: () => 'top' };
  }

  attached(param: { chart: IChartApi; series: ISeriesApi<SeriesType>; requestUpdate: () => void }): void {
    this.series = param.series;
    this.requestUpdate = param.requestUpdate;
  }

  detached(): void {
    this.series = null;
    this.requestUpdate = null;
  }

  paneViews(): readonly IPrimitivePaneView[] {
    return [this.view];
  }

  setSpec(spec: InstitutionalOverlaySpec): void {
    this.spec = spec;
    this.requestUpdate?.();
  }

  private priceY(price: number, ratio: number): number | null {
    const series = this.series;
    if (!series) return null;
    let coordinate: number | null = null;
    try {
      coordinate = series.priceToCoordinate(price);
    } catch {
      return null; // series may be mid-teardown
    }
    return coordinate == null ? null : coordinate * ratio;
  }

  private draw(target: BitmapTarget): void {
    if (!this.series) return;
    target.useBitmapCoordinateSpace((scope) => {
      const { context: ctx, bitmapSize, verticalPixelRatio: vr } = scope;
      const width = bitmapSize.width;

      for (const band of this.spec.bands) {
        const yHigh = this.priceY(band.high, vr);
        const yLow = this.priceY(band.low, vr);
        if (yHigh == null || yLow == null) continue;
        const top = Math.min(yHigh, yLow);
        const height = Math.max(1, Math.abs(yLow - yHigh));
        ctx.fillStyle = band.fill;
        ctx.fillRect(0, top, width, height);
        ctx.strokeStyle = band.border;
        ctx.lineWidth = Math.max(1, vr);
        ctx.strokeRect(0, top, width, height);
      }

      // Declutter line labels: keep a running list of used label y-slots.
      const usedLabelYs: number[] = [];
      ctx.font = `${LABEL_FONT.replace('11px', `${Math.round(11 * vr)}px`)}`;
      ctx.textBaseline = 'middle';
      for (const line of this.spec.lines) {
        const y = this.priceY(line.price, vr);
        if (y == null) continue;
        ctx.strokeStyle = line.color;
        ctx.lineWidth = Math.max(1, vr);
        if (line.dashed) ctx.setLineDash([6 * vr, 4 * vr]);
        else ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
        ctx.setLineDash([]);

        let labelY = y;
        while (usedLabelYs.some((used) => Math.abs(used - labelY) < LABEL_HEIGHT * vr)) labelY += LABEL_HEIGHT * vr;
        usedLabelYs.push(labelY);
        ctx.fillStyle = line.color;
        ctx.fillText(line.label, 6 * vr, labelY);
      }

      // Band labels at the band top edge.
      for (const band of this.spec.bands) {
        const yHigh = this.priceY(band.high, vr);
        if (yHigh == null) continue;
        ctx.fillStyle = band.labelColor;
        ctx.fillText(band.label, 6 * vr, yHigh + LABEL_HEIGHT * 0.6 * vr);
      }
    });
  }
}
