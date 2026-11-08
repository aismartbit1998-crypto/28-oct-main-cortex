const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const BINANCE_HOSTS = [
  'https://api.binance.com',
  'https://api1.binance.com',
  'https://api2.binance.com',
  'https://api3.binance.com',
  'https://data-api.binance.vision',
];

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const action = url.searchParams.get('action');

    if (!action) {
      return new Response(
        JSON.stringify({ error: 'Missing action parameter. Use one of: ticker24hr, klines, depth, tickers24hr' }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    let binancePath = '';
    const params = new URLSearchParams();

    switch (action) {
      case 'ticker24hr': {
        const symbol = url.searchParams.get('symbol');
        if (symbol) params.set('symbol', symbol);
        binancePath = '/api/v3/ticker/24hr';
        break;
      }
      case 'klines': {
        const symbol = url.searchParams.get('symbol');
        const interval = url.searchParams.get('interval') || '15m';
        const limit = url.searchParams.get('limit') || '200';
        if (!symbol) {
          return new Response(
            JSON.stringify({ error: 'Missing symbol parameter for klines' }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }
        params.set('symbol', symbol);
        params.set('interval', interval);
        params.set('limit', limit);
        binancePath = '/api/v3/klines';
        break;
      }
      case 'depth': {
        const symbol = url.searchParams.get('symbol');
        const limit = url.searchParams.get('limit') || '20';
        if (!symbol) {
          return new Response(
            JSON.stringify({ error: 'Missing symbol parameter for depth' }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }
        params.set('symbol', symbol);
        params.set('limit', limit);
        binancePath = '/api/v3/depth';
        break;
      }
      case 'tickers24hr': {
        const symbols = url.searchParams.get('symbols');
        if (!symbols) {
          return new Response(
            JSON.stringify({ error: 'Missing symbols parameter for tickers24hr' }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }
        params.set('symbols', symbols);
        binancePath = '/api/v3/ticker/24hr';
        break;
      }
      default:
        return new Response(
          JSON.stringify({ error: `Unknown action: ${action}` }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
    }

    // Try each Binance host server-side — ISP blocks don't apply here.
    let lastError: string | null = null;
    for (const host of BINANCE_HOSTS) {
      try {
        const binanceUrl = `${host}${binancePath}?${params.toString()}`;
        const res = await fetch(binanceUrl, {
          headers: { 'Accept': 'application/json' },
          signal: AbortSignal.timeout(8000),
        });
        if (!res.ok) {
          lastError = `${host} returned ${res.status}`;
          continue;
        }
        const data = await res.json();
        return new Response(JSON.stringify(data), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } catch (err) {
        lastError = `${host} failed: ${(err as Error).message}`;
        continue;
      }
    }

    return new Response(
      JSON.stringify({ error: lastError || 'All Binance hosts unreachable' }),
      { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
