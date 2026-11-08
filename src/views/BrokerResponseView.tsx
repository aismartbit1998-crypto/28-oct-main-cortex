import { useState, useEffect } from 'react';
import { Server, CheckCircle, AlertCircle, Clock, Activity, Loader2 } from 'lucide-react';
import { supabase, type BrokerApiLog } from '@/lib/supabase';

const statusConfig = {
  success: { icon: CheckCircle, color: 'text-neon-green', bg: 'bg-neon-green/10', border: 'border-neon-green/20', label: 'SUCCESS' },
  error: { icon: AlertCircle, color: 'text-neon-red', bg: 'bg-neon-red/10', border: 'border-neon-red/20', label: 'ERROR' },
  pending: { icon: Clock, color: 'text-neon-amber', bg: 'bg-neon-amber/10', border: 'border-neon-amber/20', label: 'PENDING' },
};

function formatTimestamp(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleString('en-US', { year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}

export default function BrokerResponseView() {
  const [logs, setLogs] = useState<BrokerApiLog[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    supabase
      .from('broker_api_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50)
      .then(({ data }) => {
        if (!mounted) return;
        setLogs((data as BrokerApiLog[]) ?? []);
        setLoading(false);
      });

    const channel = supabase
      .channel('broker-api-logs-changes')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'broker_api_logs' }, (payload) => {
        setLogs(prev => [payload.new as BrokerApiLog, ...prev].slice(0, 50));
      })
      .subscribe();

    return () => {
      mounted = false;
      supabase.removeChannel(channel);
    };
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 text-neon-cyan animate-spin" />
      </div>
    );
  }

  const successCount = logs.filter(r => r.status === 'success').length;
  const errorCount = logs.filter(r => r.status === 'error').length;
  const avgLatency = logs.length > 0 ? Math.round(logs.reduce((s, r) => s + r.latency_ms, 0) / logs.length) : 0;

  return (
    <div className="space-y-5 animate-slide-up">
      <div>
        <h2 className="text-xl font-bold text-white flex items-center gap-2">
          <Server className="w-5 h-5 text-neon-cyan" />
          Broker Response
        </h2>
        <p className="text-sm text-slate-400">Real-time API response logs from connected brokers</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="glass-card p-4">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] uppercase tracking-wider text-slate-500">Total Requests</span>
          </div>
          <p className="text-lg font-bold text-white font-mono">{logs.length}</p>
        </div>
        <div className="glass-card p-4">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] uppercase tracking-wider text-slate-500">Successful</span>
            <CheckCircle className="w-4 h-4 text-neon-green" />
          </div>
          <p className="text-lg font-bold text-neon-green font-mono">{successCount}</p>
        </div>
        <div className="glass-card p-4">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] uppercase tracking-wider text-slate-500">Errors</span>
            <AlertCircle className="w-4 h-4 text-neon-red" />
          </div>
          <p className="text-lg font-bold text-neon-red font-mono">{errorCount}</p>
        </div>
        <div className="glass-card p-4">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] uppercase tracking-wider text-slate-500">Avg Latency</span>
            <Activity className="w-4 h-4 text-neon-cyan" />
          </div>
          <p className="text-lg font-bold text-neon-cyan font-mono">{avgLatency}ms</p>
        </div>
      </div>

      {/* Response Log */}
      <div className="glass-card overflow-hidden">
        <div className="px-5 py-3 border-b border-white/[0.06]">
          <h3 className="text-sm font-bold text-white">API Response Log</h3>
        </div>
        {logs.length === 0 ? (
          <div className="p-12 flex flex-col items-center justify-center text-center">
            <Server className="w-12 h-12 text-slate-600 mb-3" />
            <p className="text-sm font-semibold text-slate-300">No broker API logs yet</p>
            <p className="text-xs text-slate-500 mt-1">API calls to your connected brokers will be logged here in real-time.</p>
          </div>
        ) : (
          <div className="divide-y divide-white/[0.03]">
            {logs.map((r) => {
              const sc = statusConfig[r.status as keyof typeof statusConfig] ?? statusConfig.pending;
              const Icon = sc.icon;
              return (
                <div key={r.id} className="flex items-start gap-3 px-5 py-3 hover:bg-white/[0.02] transition-colors">
                  <div className={`flex-shrink-0 w-8 h-8 rounded-lg ${sc.bg} ${sc.border} border flex items-center justify-center`}>
                    <Icon className={`w-4 h-4 ${sc.color}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-semibold text-white">{r.broker}</span>
                      <span className="text-xs text-slate-400 font-mono">{r.endpoint}</span>
                      <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${sc.bg} ${sc.color}`}>{sc.label}</span>
                      <span className="text-[10px] text-slate-500 font-mono">{r.latency_ms}ms</span>
                    </div>
                    {r.detail && <p className="text-xs text-slate-400 mt-0.5 font-mono truncate">{r.detail}</p>}
                  </div>
                  <span className="text-[10px] text-slate-600 font-mono flex-shrink-0 hidden sm:block">{formatTimestamp(r.created_at)}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
