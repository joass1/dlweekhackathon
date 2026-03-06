'use client';

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

export default function ProfilePage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-8">
      <h1 className="text-3xl font-bold text-white">Profile</h1>
      <p className="text-slate-400">Coming Soon</p>
      <Link
        href="/"
        className="mt-4 flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-300 transition-colors hover:bg-white/10 hover:text-white"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Dashboard
      </Link>
    </div>
  );
}
