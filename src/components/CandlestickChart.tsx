import { useEffect, useRef } from 'react';
import { createChart, ColorType } from 'lightweight-charts';
import type { IChartApi, ISeriesApi, UTCTimestamp } from 'lightweight-charts';
import { useBinanceKlineStream, type Candle } from '@/hooks/useBinanceWebSocket';

interface Props {
  symbol: string;
  interval?: string;
  height?: number;
}

/**
 * TradingView Lightweight-Charts candlestick chart wired to free Binance data.
 * Uses Binance REST klines for historical data + Binance WebSocket for real-time updates.
 * Zero API cost, no commercial license required (lightweight-charts is open-source Apache 2.0).
 */
export default function BinanceCandlestickChart({ symbol, interval = '15m', height = 400 }: Props) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const { candles, loading } = useBinanceKlineStream(symbol, interval);

  // Initialize chart once
  useEffect(() => {
    if (!chartContainerRef.current) return;

    const chart = createChart(chartContainerRef.current, {
      width: chartContainerRef.current.clientWidth,
      height,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#94a3b8',
        fontFamily: 'ui-monospace, monospace',
      },
      grid: {
        vertLines: { color: 'rgba(255,255,255,0.04)' },
        horzLines: { color: 'rgba(255,255,255,0.04)' },
      },
      crosshair: {
        mode: 1,
        vertLine: { color: 'rgba(0,229,255,0.3)', labelBackgroundColor: '#0a0b0f' },
        horzLine: { color: 'rgba(0,229,255,0.3)', labelBackgroundColor: '#0a0b0f' },
      },
      rightPriceScale: { borderColor: 'rgba(255,255,255,0.06)' },
      timeScale: { borderColor: 'rgba(255,255,255,0.06)', timeVisible: true, secondsVisible: false },
    });

    chartRef.current = chart;

    const candleSeries = chart.addCandlestickSeries({
      upColor: '#00ff9d',
      downColor: '#ff3b5c',
      borderUpColor: '#00ff9d',
      borderDownColor: '#ff3b5c',
      wickUpColor: '#00ff9d',
      wickDownColor: '#ff3b5c',
    });
    candleSeriesRef.current = candleSeries;

    const volumeSeries = chart.addHistogramSeries({
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
    });
    chart.priceScale('volume').applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
    volumeSeriesRef.current = volumeSeries;

    // Responsive resize
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.contentRect.width > 0) {
          chart.applyOptions({ width: entry.contentRect.width });
        }
      }
    });
    resizeObserver.observe(chartContainerRef.current);

    return () => {
      resizeObserver.disconnect();
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
    };
  }, [height]);

  // Update chart data when candles change
  useEffect(() => {
    if (!candleSeriesRef.current || !volumeSeriesRef.current || candles.length === 0) return;

    candleSeriesRef.current.setData(
      candles.map((c: Candle) => ({
        time: c.time as UTCTimestamp,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      }))
    );

    volumeSeriesRef.current.setData(
      candles.map((c: Candle) => ({
        time: c.time as UTCTimestamp,
        value: c.volume,
        color: c.close >= c.open ? 'rgba(0,255,157,0.3)' : 'rgba(255,59,92,0.3)',
      }))
    );

    chartRef.current?.timeScale().fitContent();
  }, [candles]);

  return (
    <div className="relative">
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center z-10 bg-base-900/50 rounded-xl">
          <div className="flex flex-col items-center gap-2">
            <div className="w-6 h-6 border-2 border-neon-cyan/30 border-t-neon-cyan rounded-full animate-spin" />
            <p className="text-xs text-slate-500">Loading {symbol} chart...</p>
          </div>
        </div>
      )}
      <div ref={chartContainerRef} className="w-full rounded-xl overflow-hidden" style={{ height }} />
    </div>
  );
}
