'use client';

import { useState } from 'react';
import { useBotStatus } from '@/hooks/useBotStatus';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { Pause, Play, Loader2 } from 'lucide-react';

export default function BotControlButtons() {
  const { status, isConnected } = useBotStatus();
  const [isLoading, setIsLoading] = useState(false);

  const botState = (status as any)?.botState || 'stopped';
  const isRunning = botState === 'running';
  const isPaused = botState === 'paused';
  const isStopped = botState === 'stopped';

  const sendControlCommand = async (action: 'pause' | 'resume') => {
    setIsLoading(true);
    try {
      const response = await fetch('/api/bot/control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || `Failed to ${action} bot`);
      }

      toast.success(`Bot ${action === 'pause' ? 'paused' : 'resumed'}`, {
        description: action === 'pause'
          ? 'No new trades will be placed'
          : 'Trading has resumed'
      });
    } catch (error: any) {
      console.error(`Failed to ${action} bot:`, error);
      toast.error(`Failed to ${action} bot`, {
        description: error.message || 'An error occurred'
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handlePause = () => sendControlCommand('pause');
  const handleResume = () => sendControlCommand('resume');

  if (!isConnected || isStopped) {
    return null;
  }

  return (
    <div className="flex items-center gap-2">
      {isRunning && (
        <Button
          onClick={handlePause}
          disabled={isLoading}
          variant="ghost"
          size="sm"
          className="h-8 gap-1.5 text-yellow-600 hover:text-yellow-700 hover:bg-yellow-50 dark:text-yellow-400 dark:hover:text-yellow-300 dark:hover:bg-yellow-950/30"
        >
          {isLoading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Pause className="h-3.5 w-3.5 fill-current" />
          )}
          <span className="text-xs font-medium">Pause</span>
        </Button>
      )}

      {isPaused && (
        <Button
          onClick={handleResume}
          disabled={isLoading}
          variant="ghost"
          size="sm"
          className="h-8 gap-1.5 text-green-600 hover:text-green-700 hover:bg-green-50 dark:text-green-400 dark:hover:text-green-300 dark:hover:bg-green-950/30"
        >
          {isLoading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Play className="h-3.5 w-3.5 fill-current" />
          )}
          <span className="text-xs font-medium">Resume</span>
        </Button>
      )}
    </div>
  );
}
