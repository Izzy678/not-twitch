'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { streamsApi, Stream } from '@/lib/api';

export default function Home() {
  const [streams, setStreams] = useState<Stream[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadStreams();
    const interval = setInterval(loadStreams, 5000);
    return () => clearInterval(interval);
  }, []);

  const loadStreams = async () => {
    try {
      const data = await streamsApi.getAll();
      setStreams(data);
      setError(null);
    } catch (err: any) {
      console.error('Failed to load streams:', err);
      setError('Failed to load streams. Make sure the API server is running.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-gradient-to-br from-purple-900 via-blue-900 to-indigo-900 p-8">
      <div className="max-w-7xl mx-auto">
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-5xl font-bold text-white mb-2">Not Twitch</h1>
            <p className="text-gray-300">Live streaming platform</p>
          </div>
          <Link
            href="/broadcast"
            className="bg-red-600 hover:bg-red-700 text-white px-6 py-3 rounded-lg font-semibold transition-colors flex items-center gap-2 shadow-lg"
          >
            <span className="w-2 h-2 bg-white rounded-full"></span>
            Go Live
          </Link>
        </div>

        {error && (
          <div className="bg-red-500/20 border border-red-500 text-red-200 px-4 py-3 rounded-lg mb-6">
            {error}
          </div>
        )}

        {loading ? (
          <div className="text-white text-center py-20">
            <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-white"></div>
            <p className="mt-4">Loading streams...</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {streams.map((stream) => (
              <Link
                key={stream.id}
                href={`/watch/${stream.id}`}
                className="bg-gray-800/50 backdrop-blur-sm rounded-lg overflow-hidden hover:scale-105 transition-transform border border-gray-700"
              >
                <div className="relative aspect-video bg-gray-900">
                  {stream.isLive ? (
                    <>
                      <div className="absolute top-2 left-2 bg-red-600 text-white px-2 py-1 rounded text-sm font-semibold flex items-center gap-1 z-10">
                        <span className="w-2 h-2 bg-white rounded-full animate-pulse"></span>
                        LIVE
                      </div>
                      <div className="absolute bottom-2 right-2 bg-black/70 text-white px-2 py-1 rounded text-sm">
                        {stream.viewerCount} viewers
                      </div>
                    </>
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center text-gray-500">
                      <div className="text-center">
                        <div className="text-4xl mb-2">📹</div>
                        <div>Offline</div>
                      </div>
                    </div>
                  )}
                </div>
                <div className="p-4">
                  <h3 className="text-white font-semibold text-lg mb-1 line-clamp-1">
                    {stream.title}
                  </h3>
                  {stream.description && (
                    <p className="text-gray-400 text-sm line-clamp-2">{stream.description}</p>
                  )}
                  <div className="mt-2 text-xs text-gray-500">
                    Created {new Date(stream.createdAt).toLocaleDateString()}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}

        {!loading && !error && streams.length === 0 && (
          <div className="text-center py-20 text-white">
            <div className="text-6xl mb-4">🎥</div>
            <p className="text-xl mb-4">No streams available</p>
            <Link
              href="/broadcast"
              className="text-blue-400 hover:text-blue-300 underline text-lg"
            >
              Start the first stream!
            </Link>
          </div>
        )}
      </div>
    </main>
  );
}
