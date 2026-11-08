/* Sync-Exchange-Positions Edge Function — DISABLED (No-Op)
 *
 * Reconciliation has been permanently disabled. This function previously
 * auto-corrected DB positions based on the CoinDCX exchange positions list,
 * which caused active trades to be falsely marked as closed with 0.00 PnL
 * when the API returned errors or timeouts.
 *
 * Positions are now ONLY closed when:
 *   1. The Virtual Execution Engine fires a reduce-only market close order
 *      (SL/TP threshold breach), confirmed by polling the exchange.
 *   2. The user manually clicks Square-Off (close-single-position).
 *
 * This endpoint now returns a disabled response and modifies NO data.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  return new Response(JSON.stringify({
    success: true,
    disabled: true,
    message: "Reconciliation engine permanently disabled. Positions are only closed by the Virtual Execution Engine or manual square-off.",
    checked: 0,
    ghostCleared: 0,
    ghostReopened: 0,
    aborted: 0,
    results: [],
  }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
