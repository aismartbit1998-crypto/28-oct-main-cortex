import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import type { Position } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';

/**
 * usePositionMonitor — Frontend Realtime listener for position updates.
 *
 * The engine runs autonomously via a database cron job that calls the
 * monitor-positions edge function every minute. This hook does NOT
 * trigger the engine — it only listens for Supabase Realtime changes
 * on the positions table to update the UI instantly when positions
 * are opened, closed, or have their trailing stops / P&L updated.
 */
export function usePositionMonitor() {
  const { effectiveUserId } = useAuth();
  const [positions, setPositions] = useState<Position[]>([]);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  const fetchPositions = useCallback(async (userId: string) => {
    const { data, error } = await supabase
      .from('positions')
      .select('*')
      .eq('user_id', userId)
      .eq('status', 'open')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('usePositionMonitor: Failed to fetch positions:', error.message);
      return;
    }
    if (data) {
      setPositions(data as Position[]);
      setLastUpdate(new Date());
    }
  }, []);

  useEffect(() => {
    if (!effectiveUserId) return;
    let mounted = true;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    // Initial fetch is fire-and-forget; subscription runs independently.
    fetchPositions(effectiveUserId);

    try {
      channel = supabase
        .channel('positions-realtime')
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'positions', filter: `user_id=eq.${effectiveUserId}` },
          (payload) => {
            if (!mounted) return;
            try {
              setLastUpdate(new Date());

              const newRow = payload.new as Position;
              if (payload.eventType === 'INSERT' && newRow.status === 'open') {
                setPositions((prev) => [newRow, ...prev]);
              } else if (payload.eventType === 'UPDATE') {
                if (newRow.status === 'open') {
                  setPositions((prev) => prev.map((p) => (p.id === newRow.id ? newRow : p)));
                } else {
                  setPositions((prev) => prev.filter((p) => p.id !== newRow.id));
                }
              } else if (payload.eventType === 'DELETE') {
                const oldRow = payload.old as { id: string };
                setPositions((prev) => prev.filter((p) => p.id !== oldRow.id));
              }
            } catch (err) {
              console.error('usePositionMonitor: Realtime callback error:', (err as Error).message);
            }
          },
        )
        .subscribe((status: string) => {
          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            console.warn('usePositionMonitor: Realtime channel issue:', status);
          }
        });
    } catch (err) {
      console.error('usePositionMonitor: Failed to subscribe:', (err as Error).message);
    }

    return () => {
      mounted = false;
      if (channel) {
        try { supabase.removeChannel(channel); } catch { /* already removed */ }
      }
    };
  }, [effectiveUserId, fetchPositions]);

  return {
    positions,
    lastUpdate,
    refreshPositions: fetchPositions,
  };
}
