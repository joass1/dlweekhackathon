import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Activity, Sparkles } from 'lucide-react';
import { GlowingEffect } from '@/components/ui/glowing-effect';

interface Props {
  groupId: string;
}

const panelClass =
  'glow-card relative overflow-hidden rounded-2xl border border-white/15 bg-gradient-to-br from-slate-900/70 via-slate-800/60 to-slate-900/70 backdrop-blur-md shadow-xl text-white';

export function GroupFeed({ groupId }: Props) {
  return (
    <Card className={panelClass}>
      <GlowingEffect spread={220} glow={true} disabled={false} proximity={72} borderWidth={2} variant="cyan" />
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-white">
          <Activity className="h-5 w-5 text-[#4cc9f0]" />
          Activity Feed
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 pt-0">
        <div className="flex items-start gap-3 rounded-2xl border border-cyan-300/15 bg-white/5 p-4">
          <Sparkles className="mt-0.5 h-4 w-4 text-[#4cc9f0]" />
          <p className="text-sm leading-6 text-white/70">
            Group updates will appear here once your hub starts running shared sessions and generating collaborative progress.
          </p>
        </div>
        <p className="text-sm text-white/60">
          No feed activity yet for hub <span className="font-medium text-white">{groupId}</span>.
        </p>
      </CardContent>
    </Card>
  );
}
