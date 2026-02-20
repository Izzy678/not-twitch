'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useSocket } from '@/lib/useSocket';
import { streamsApi, Stream } from '@/lib/api';

export default function WatchPage() {
  const params = useParams();
  const router = useRouter();
  const streamId = params.id as string;
  const [stream, setStream] = useState<Stream | null>(null);
  const [viewerCount, setViewerCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const isPlayingRef = useRef(false);
  const socket = useSocket();

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
      remoteStreamRef.current = null;
      isPlayingRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!streamId) return;
    loadStream();
  }, [streamId]);

  useEffect(() => {
    if (!socket || !streamId) return;

    // Join the stream room first
    socket.emit('join-stream', { streamId });

    socket.on('viewer-count', (data: { streamId: string; count: number }) => {
      if (data.streamId === streamId) {
        setViewerCount(data.count);
      }
    });

    socket.on('stream-stopped', (data: { streamId: string }) => {
      if (data.streamId === streamId) {
        setError('Stream has ended');
        setTimeout(() => {
          router.push('/');
        }, 3000);
      }
    });

    // WebRTC signaling - handle offer from broadcaster
    socket.on('offer', async (data: { offer: RTCSessionDescriptionInit; from: string }) => {
      console.log('Received offer from broadcaster:', data.from);
      
      // Initialize WebRTC if not already done
      if (!peerRef.current) {
        initializeWebRTC();
      }

      if (peerRef.current) {
        try {
          // Set remote description (broadcaster's offer)
          await peerRef.current.setRemoteDescription(new RTCSessionDescription(data.offer));
          console.log('Set remote description (offer)');
          
          // Create answer
          const answer = await peerRef.current.createAnswer();
          await peerRef.current.setLocalDescription(answer);
          console.log('Created and set local description (answer)');

          // Send answer back to broadcaster
          socket.emit('answer', {
            streamId,
            answer,
            to: data.from,
          });
          console.log('Sent answer to broadcaster');
        } catch (err) {
          console.error('Error handling offer:', err);
          setError('Failed to establish connection. Please refresh the page.');
        }
      }
    });

    socket.on('answer', async (data: { answer: RTCSessionDescriptionInit }) => {
      if (!peerRef.current) return;
      try {
        await peerRef.current.setRemoteDescription(new RTCSessionDescription(data.answer));
        console.log('Set remote description (answer)');
      } catch (err) {
        console.error('Error handling answer:', err);
      }
    });

    socket.on('ice-candidate', async (data: { candidate: RTCIceCandidateInit; from: string }) => {
      if (!peerRef.current || !data.candidate) return;
      try {
        await peerRef.current.addIceCandidate(new RTCIceCandidate(data.candidate));
        console.log('Added ICE candidate from:', data.from);
      } catch (err) {
        console.error('Error adding ICE candidate:', err);
      }
    });

    return () => {
      socket.emit('leave-stream', { streamId });
      if (peerRef.current) {
        peerRef.current.close();
        peerRef.current = null;
      }
      // Don't clear remoteStreamRef here - let it be cleaned up on unmount
    };
  }, [socket, streamId, router]);

  const loadStream = async () => {
    try {
      setLoading(true);
      const data = await streamsApi.getOne(streamId);
      setStream(data);
      setViewerCount(data.viewerCount);

      if (data.isLive) {
        // Don't initialize WebRTC here - wait for offer from broadcaster
        // The socket event handlers will handle WebRTC initialization
        console.log('Stream is live, waiting for broadcaster offer...');
      } else {
        setError('Stream is currently offline');
      }
    } catch (err: any) {
      console.error('Failed to load stream:', err);
      setError('Stream not found');
      setTimeout(() => {
        router.push('/');
      }, 3000);
    } finally {
      setLoading(false);
    }
  };

  const initializeWebRTC = () => {
    if (peerRef.current) {
      console.log('WebRTC already initialized');
      return; // Already initialized
    }

    console.log('Initializing WebRTC connection...');
    const peer = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
      ],
    });

    // Handle incoming media tracks from broadcaster
    peer.ontrack = (event) => {
      console.log('Received track from broadcaster:', event.track.kind);
      
      if (!event.streams || !event.streams[0]) {
        console.warn('No stream in track event');
        return;
      }
      
      const stream = event.streams[0];
      
      // Store the stream reference
      if (!remoteStreamRef.current) {
        remoteStreamRef.current = stream;
        console.log('Stored remote stream reference');
      }
      
      // Only set srcObject once when we get the first track
      // Subsequent tracks will be added to the same stream
      if (videoRef.current && videoRef.current.srcObject !== stream) {
        console.log('Setting video srcObject to remote stream');
        videoRef.current.srcObject = stream;
        
        // Only try to play if not already playing
        if (!isPlayingRef.current) {
          isPlayingRef.current = true;
          
          // Use a small delay to ensure stream is ready
          setTimeout(() => {
            if (videoRef.current && videoRef.current.srcObject === stream) {
              videoRef.current.play()
                .then(() => {
                  console.log('Video playback started successfully');
                  setError(null);
                  isPlayingRef.current = true;
                })
                .catch((err) => {
                  console.error('Error playing video:', err);
                  isPlayingRef.current = false;
                  
                  // Only show error if it's not an abort (interruption)
                  if (err.name !== 'AbortError') {
                    setError('Failed to play video. Please check browser permissions.');
                  }
                });
            }
          }, 100);
        }
      } else {
        console.log('Video srcObject already set or same stream, skipping');
      }
    };

    // Send ICE candidates to broadcaster
    peer.onicecandidate = (event) => {
      if (event.candidate && socket) {
        console.log('Sending ICE candidate');
        socket.emit('ice-candidate', {
          streamId,
          candidate: event.candidate,
        });
      } else if (!event.candidate) {
        console.log('ICE gathering complete');
      }
    };

    peer.onconnectionstatechange = () => {
      console.log('WebRTC connection state:', peer.connectionState);
      if (peer.connectionState === 'failed' || peer.connectionState === 'disconnected') {
        console.error('WebRTC connection failed');
        setError('Connection lost. Please refresh the page.');
      } else if (peer.connectionState === 'connected') {
        console.log('WebRTC connected successfully');
        setError(null);
      } else if (peer.connectionState === 'connecting') {
        console.log('WebRTC connecting...');
      }
    };

    peer.oniceconnectionstatechange = () => {
      console.log('ICE connection state:', peer.iceConnectionState);
    };

    peerRef.current = peer;
  };

  if (loading) {
    return (
      <main className="min-h-screen bg-gradient-to-br from-gray-900 via-purple-900 to-gray-900 flex items-center justify-center">
        <div className="text-white text-xl">Loading stream...</div>
      </main>
    );
  }

  if (!stream) {
    return (
      <main className="min-h-screen bg-gradient-to-br from-gray-900 via-purple-900 to-gray-900 flex items-center justify-center">
        <div className="text-white text-xl">Stream not found</div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-gray-900 via-purple-900 to-gray-900 p-8">
      <div className="max-w-6xl mx-auto">
        <div className="mb-4">
          <button
            onClick={() => router.push('/')}
            className="text-white hover:text-gray-300 mb-4 flex items-center gap-2"
          >
            <span>←</span> Back to streams
          </button>
          <h1 className="text-3xl font-bold text-white mb-2">{stream.title}</h1>
          {stream.description && (
            <p className="text-gray-400 mb-4">{stream.description}</p>
          )}
        </div>

        <div className="bg-gray-800/50 backdrop-blur-sm rounded-lg overflow-hidden border border-gray-700">
          {stream.isLive ? (
            <>
              <video
                ref={videoRef}
                autoPlay
                playsInline
                controls
                className="w-full aspect-video bg-black"
                onLoadedMetadata={() => {
                  const video = videoRef.current;
                  if (video && video.srcObject && video.paused && !isPlayingRef.current) {
                    video.play()
                      .then(() => {
                        console.log('Video started playing from onLoadedMetadata');
                        isPlayingRef.current = true;
                      })
                      .catch((err) => {
                        // Ignore AbortError - it's just an interruption
                        if (err.name !== 'AbortError') {
                          console.error('Error playing video on metadata load:', err);
                        }
                      });
                  }
                }}
                onCanPlay={() => {
                  const video = videoRef.current;
                  if (video && video.paused && !isPlayingRef.current && video.srcObject) {
                    video.play()
                      .then(() => {
                        console.log('Video started playing from onCanPlay');
                        isPlayingRef.current = true;
                      })
                      .catch((err) => {
                        if (err.name !== 'AbortError') {
                          console.error('Error playing video on canPlay:', err);
                        }
                      });
                  }
                }}
                onPlay={() => {
                  console.log('Video is now playing');
                  isPlayingRef.current = true;
                  setError(null);
                }}
                onPause={() => {
                  // Don't reset isPlayingRef on pause - user might pause manually
                }}
                onWaiting={() => {
                  console.log('Video is waiting for data');
                }}
                onError={(e) => {
                  console.error('Video element error:', e);
                  const error = videoRef.current?.error;
                  if (error) {
                    let errorMsg = 'Video playback error occurred';
                    switch (error.code) {
                      case error.MEDIA_ERR_ABORTED:
                        errorMsg = 'Video playback was aborted';
                        break;
                      case error.MEDIA_ERR_NETWORK:
                        errorMsg = 'Network error while loading video';
                        break;
                      case error.MEDIA_ERR_DECODE:
                        errorMsg = 'Video decoding error';
                        break;
                      case error.MEDIA_ERR_SRC_NOT_SUPPORTED:
                        errorMsg = 'Video format not supported';
                        break;
                    }
                    setError(errorMsg);
                  }
                }}
              />
              {error && (
                <div className="bg-yellow-500/20 border-t border-yellow-500 text-yellow-200 px-4 py-2">
                  {error}
                </div>
              )}
            </>
          ) : (
            <div className="aspect-video bg-black flex items-center justify-center text-white text-xl">
              Stream is offline
            </div>
          )}
        </div>

        <div className="mt-4 flex items-center gap-4 text-white">
          <div className="flex items-center gap-2 bg-gray-800/50 px-4 py-2 rounded-lg">
            <span className="w-3 h-3 bg-red-600 rounded-full animate-pulse"></span>
            <span className="font-semibold">{viewerCount}</span>
            <span className="text-gray-400">viewers</span>
          </div>
        </div>
      </div>
    </main>
  );
}
