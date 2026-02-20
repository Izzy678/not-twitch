'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSocket } from '@/lib/useSocket';
import { streamsApi, Stream } from '@/lib/api';

export default function BroadcastPage() {
  const [stream, setStream] = useState<Stream | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [hasVideoStream, setHasVideoStream] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  /** One peer connection per viewer so multiple browsers can watch */
  const peersRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const localStreamRef = useRef<MediaStream | null>(null);
  const socket = useSocket();
  const router = useRouter();

  // Clean up media tracks only on unmount (e.g. user navigates away)
  useEffect(() => {
    return () => {
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((track) => track.stop());
        localStreamRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!socket) return;

    socket.on('stream-stopped', () => {
      stopStream();
    });

    // When a new viewer joins, create a dedicated peer connection for them
    socket.on('viewer-joined', async (data: { streamId: string; viewerId: string }) => {
      if (!stream || data.streamId !== stream.id || !localStreamRef.current) return;
      if (peersRef.current.has(data.viewerId)) {
        console.log('Already have peer for viewer:', data.viewerId);
        return;
      }

      const viewerId = data.viewerId;
      const mediaStream = localStreamRef.current;

      try {
        const peer = new RTCPeerConnection({
          iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
          ],
        });

        mediaStream.getTracks().forEach((track) => {
          peer.addTrack(track, mediaStream);
        });

        peer.onicecandidate = (event) => {
          if (event.candidate && socket) {
            socket.emit('ice-candidate', {
              streamId: stream.id,
              candidate: event.candidate,
              to: viewerId,
            });
          }
        };

        peer.onconnectionstatechange = () => {
          if (peer.connectionState === 'failed' || peer.connectionState === 'disconnected' || peer.connectionState === 'closed') {
            peer.close();
            peersRef.current.delete(viewerId);
          }
        };

        const offer = await peer.createOffer();
        await peer.setLocalDescription(offer);

        peersRef.current.set(viewerId, peer);

        socket.emit('offer', {
          streamId: stream.id,
          offer: offer,
          to: viewerId,
        });
        console.log('Sent offer to new viewer:', viewerId);
      } catch (err) {
        console.error('Error creating offer for new viewer:', err);
      }
    });

    // Receive viewer's answer - set on that viewer's peer
    socket.on('answer', async (data: { answer: RTCSessionDescriptionInit; from: string }) => {
      const peer = peersRef.current.get(data.from);
      if (!peer) return;
      try {
        await peer.setRemoteDescription(new RTCSessionDescription(data.answer));
        console.log('Received and set viewer answer for', data.from);
      } catch (err) {
        console.error('Error setting remote description (answer):', err);
      }
    });

    // Receive viewer's ICE candidates - add to that viewer's peer
    socket.on('ice-candidate', async (data: { candidate: RTCIceCandidateInit; from: string }) => {
      const peer = peersRef.current.get(data.from);
      if (!peer || !data.candidate) return;
      try {
        await peer.addIceCandidate(new RTCIceCandidate(data.candidate));
        console.log('Added ICE candidate from viewer', data.from);
      } catch (err) {
        console.error('Error adding ICE candidate:', err);
      }
    });

    return () => {
      peersRef.current.forEach((peer) => peer.close());
      peersRef.current.clear();
    };
  }, [socket, stream]);

  // Ensure video plays when stream is set
  useEffect(() => {
    if (videoRef.current && localStreamRef.current && isStreaming) {
      const video = videoRef.current;
      const stream = localStreamRef.current;
      
      console.log('useEffect: Setting up video element', {
        hasVideoStream,
        isStreaming,
        hasStream: !!stream,
        currentSrcObject: !!video.srcObject,
        videoWidth: video.videoWidth,
        videoHeight: video.videoHeight,
        paused: video.paused,
        readyState: video.readyState,
        streamActive: stream.active,
      });
      
      // Verify stream has active tracks
      const videoTracks = stream.getVideoTracks();
      console.log('Stream video tracks:', videoTracks.map(t => ({
        enabled: t.enabled,
        readyState: t.readyState,
        muted: t.muted,
      })));
      
      // Only update if video element doesn't have a valid stream
      const currentSrcObject = video.srcObject as MediaStream | null;
      const hasValidStream = 
        currentSrcObject && 
        currentSrcObject === stream &&
        currentSrcObject.active &&
        currentSrcObject.getVideoTracks().length > 0 &&
        video.videoWidth > 0 &&
        video.videoHeight > 0;
      
      if (!hasValidStream) {
        const reason = !currentSrcObject ? 'no srcObject' :
                       currentSrcObject !== stream ? 'different reference' :
                       !currentSrcObject.active ? 'inactive stream' :
                       currentSrcObject.getVideoTracks().length === 0 ? 'no video tracks' :
                       (video.videoWidth === 0 || video.videoHeight === 0) ? 'invalid dimensions' :
                       'unknown';
        
        console.log('useEffect: Setting srcObject to stream', {
          reason,
          currentSrcObject: !!currentSrcObject,
          streamActive: stream.active,
          streamVideoTracks: stream.getVideoTracks().length,
        });
        
        // Check if stream is valid - check tracks instead of just stream.active
        const videoTracks = stream.getVideoTracks();
        const hasLiveTracks = videoTracks.some(t => t.readyState === 'live' && t.enabled);
        
        if (hasLiveTracks && videoTracks.length > 0) {
          console.log('Stream is valid, setting on video element', {
            streamActive: stream.active,
            videoTracks: videoTracks.length,
            liveTracks: videoTracks.filter(t => t.readyState === 'live').length,
            enabledTracks: videoTracks.filter(t => t.enabled).length,
          });
          video.srcObject = stream;
        } else {
          console.error('Cannot set stream - stream has no live tracks', {
            streamActive: stream.active,
            videoTracks: videoTracks.length,
            tracks: videoTracks.map(t => ({
              enabled: t.enabled,
              readyState: t.readyState,
            })),
          });
          
          // Try to use the ref stream if available
          if (localStreamRef.current && localStreamRef.current.getVideoTracks().length > 0) {
            console.log('Trying to use localStreamRef instead');
            const refTracks = localStreamRef.current.getVideoTracks();
            if (refTracks.some(t => t.readyState === 'live')) {
              video.srcObject = localStreamRef.current;
              return;
            }
          }
          
          setError('Stream has no active video tracks. Please refresh and try again.');
          return;
        }
      } else {
        console.log('useEffect: Video element already has valid stream, skipping update');
      }
      
      // Ensure video element properties
      video.muted = true;
      video.autoplay = true;
      video.playsInline = true;
      
      // Force play after a short delay to ensure element is ready
      const playVideo = async () => {
        try {
          // Verify stream is still the same reference
          if (video.srcObject !== stream) {
            console.log('useEffect: Stream reference changed, updating...');
            video.srcObject = stream;
          }
          
          // Check if stream is still active
          if (!stream.active) {
            console.error('Stream is not active! Stream state:', {
              active: stream.active,
              videoTracks: stream.getVideoTracks().length,
              audioTracks: stream.getAudioTracks().length,
            });
            
            // Try to get a fresh reference
            if (localStreamRef.current && localStreamRef.current.active) {
              console.log('Using fresh stream reference');
              video.srcObject = localStreamRef.current;
              return;
            }
            
            setError('Stream became inactive. Please refresh and try again.');
            return;
          }
          
          // Check if video tracks are enabled
          const videoTracks = stream.getVideoTracks();
          const activeTracks = videoTracks.filter(t => t.enabled && t.readyState === 'live');
          
          console.log('Video tracks check:', {
            total: videoTracks.length,
            active: activeTracks.length,
            tracks: videoTracks.map(t => ({
              enabled: t.enabled,
              readyState: t.readyState,
              muted: t.muted,
            })),
          });
          
          if (activeTracks.length === 0) {
            console.error('No active video tracks!');
            
            // Try to re-enable tracks
            videoTracks.forEach(track => {
              if (!track.enabled) {
                console.log('Re-enabling track:', track.label);
                track.enabled = true;
              }
            });
            
            // Check again
            const retryTracks = stream.getVideoTracks().filter(t => t.enabled && t.readyState === 'live');
            if (retryTracks.length === 0) {
              setError('No active video tracks. Please check your camera.');
              return;
            }
          }
          
          // Ensure video properties
          video.muted = true;
          video.autoplay = true;
          video.playsInline = true;
          
          if (video.paused) {
            console.log('useEffect: Video is paused, attempting to play');
            await video.play();
            console.log('useEffect: Video playback started successfully', {
              videoWidth: video.videoWidth,
              videoHeight: video.videoHeight,
              readyState: video.readyState,
              srcObject: !!video.srcObject,
            });
            setError(null);
          } else {
            console.log('useEffect: Video is already playing', {
              videoWidth: video.videoWidth,
              videoHeight: video.videoHeight,
              srcObject: !!video.srcObject,
            });
          }
        } catch (err: any) {
          console.error('useEffect: Error playing video:', err);
          setError('Video playback failed: ' + (err.message || 'Unknown error'));
        }
      };
      
      // Try immediately
      playVideo();
      
      // Also try after a short delay in case element needs time
      const timeout = setTimeout(() => {
        if (video.paused && video.srcObject === stream) {
          console.log('useEffect: Retrying video play after delay');
          playVideo();
        }
      }, 500);
      
      return () => clearTimeout(timeout);
    } else if (isStreaming && hasVideoStream && !localStreamRef.current) {
      console.warn('useEffect: Stream is expected but localStreamRef is null');
    }
  }, [isStreaming, hasVideoStream]);

  const startBroadcast = async () => {
    if (!title.trim()) {
      setError('Please enter a stream title');
      return;
    }

    // Check if socket is connected
    if (!socket) {
      setError('Socket not initialized. Please refresh the page and try again.');
      return;
    }
    
    if (!socket.connected) {
      setError('Socket not connected. Please wait a moment for connection...');
      // Wait a bit for connection
      await new Promise((resolve) => setTimeout(resolve, 1000));
      if (!socket.connected) {
        setError('Socket connection timeout. Please refresh the page.');
        return;
      }
    }

    try {
      setError(null);

      // Get user media
      let mediaStream: MediaStream;
      try {
        mediaStream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: true,
        });
      } catch (err: any) {
        if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
          throw new Error('Camera/microphone permission denied. Please allow access and try again.');
        } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
          throw new Error('No camera/microphone found. Please connect a device and try again.');
        } else {
          throw new Error('Failed to access camera/microphone: ' + err.message);
        }
      }

      // Verify stream has tracks
      if (!mediaStream.getVideoTracks().length) {
        mediaStream.getTracks().forEach((track) => track.stop());
        throw new Error('No video track available. Please check your camera.');
      }

      localStreamRef.current = mediaStream;
      
      // Log stream info for debugging
      console.log('Media stream obtained:', {
        videoTracks: mediaStream.getVideoTracks().length,
        audioTracks: mediaStream.getAudioTracks().length,
        active: mediaStream.active,
        id: mediaStream.id,
      });
      
      // Check video track status and ensure it's enabled
      const videoTrack = mediaStream.getVideoTracks()[0];
      if (videoTrack) {
        console.log('Video track:', {
          enabled: videoTrack.enabled,
          readyState: videoTrack.readyState,
          muted: videoTrack.muted,
          label: videoTrack.label,
          settings: videoTrack.getSettings(),
        });
        
        // Ensure video track is enabled
        if (!videoTrack.enabled) {
          console.warn('Video track is disabled, enabling it...');
          videoTrack.enabled = true;
        }
        
        // Monitor track state changes
        videoTrack.onended = () => {
          console.error('Video track ended unexpectedly!');
          setError('Camera feed was interrupted. Please refresh and try again.');
        };
        
        videoTrack.onmute = () => {
          console.warn('Video track was muted');
        };
        
        videoTrack.onunmute = () => {
          console.log('Video track was unmuted');
        };
      } else {
        throw new Error('No video track found in media stream');
      }

      // Set state flags FIRST so video element gets rendered
      setHasVideoStream(true);
      
      // Create stream in database
      const newStream = await streamsApi.create({
        title,
        description,
        broadcasterId: 'user-' + Math.random().toString(36).substr(2, 9),
      });
      setStream(newStream);
      
      // Verify stream is valid BEFORE any async operations
      const videoTracksBefore = mediaStream.getVideoTracks();
      const hasLiveTracks = videoTracksBefore.some(t => t.readyState === 'live' && t.enabled);
      
      if (!hasLiveTracks || videoTracksBefore.length === 0) {
        throw new Error('No live video tracks available before setup');
      }
      
      console.log('Stream verified before setup:', {
        streamActive: mediaStream.active,
        videoTracks: videoTracksBefore.length,
        liveTracks: videoTracksBefore.filter(t => t.readyState === 'live').length,
      });

      // Set isStreaming to true to render the video element
      setIsStreaming(true);
      
      // Wait for React to render the video element, then set the stream
      // Use requestAnimationFrame to ensure DOM is updated
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            if (videoRef.current && localStreamRef.current) {
              // Verify stream is still valid
              const currentTracks = localStreamRef.current.getVideoTracks();
              const hasCurrentLiveTracks = currentTracks.some(t => t.readyState === 'live' && t.enabled);
              
              console.log('Setting video srcObject after render...', {
                streamActive: localStreamRef.current.active,
                videoTracks: currentTracks.length,
                hasLiveTracks: hasCurrentLiveTracks,
              });
              
              if (!hasCurrentLiveTracks) {
                console.error('Stream lost tracks during render wait!', {
                  tracks: currentTracks.map(t => ({
                    enabled: t.enabled,
                    readyState: t.readyState,
                  })),
                });
                // Don't throw here, let useEffect handle it
              } else {
                // CRITICAL: Set stream on video element BEFORE WebRTC operations
                videoRef.current.srcObject = localStreamRef.current;
                videoRef.current.muted = true;
                videoRef.current.autoplay = true;
                videoRef.current.playsInline = true;
                
                videoRef.current.play()
                  .then(() => {
                    console.log('Video playback started immediately', {
                      videoWidth: videoRef.current?.videoWidth,
                      videoHeight: videoRef.current?.videoHeight,
                    });
                  })
                  .catch((err) => {
                    console.warn('Initial play failed, will retry in useEffect:', err);
                  });
                
                console.log('Video element configured:', {
                  hasSrcObject: !!videoRef.current.srcObject,
                  muted: videoRef.current.muted,
                  autoplay: videoRef.current.autoplay,
                  videoWidth: videoRef.current.videoWidth,
                  videoHeight: videoRef.current.videoHeight,
                  streamActive: (videoRef.current.srcObject as MediaStream)?.active,
                });
              }
            } else {
              console.warn('Video ref still not available after render');
            }
            resolve();
          });
        });
      });

      // Verify stream is still valid before WebRTC operations (check tracks, not just active)
      const videoTracksCheck = mediaStream.getVideoTracks();
      const hasLiveTracksCheck = videoTracksCheck.some(t => t.readyState === 'live' && t.enabled);
      
      if (!hasLiveTracksCheck || videoTracksCheck.length === 0) {
        console.error('Stream validation failed before WebRTC:', {
          streamActive: mediaStream.active,
          videoTracks: videoTracksCheck.length,
          tracks: videoTracksCheck.map(t => ({
            enabled: t.enabled,
            readyState: t.readyState,
          })),
        });
        // Don't throw - try to continue, the video element might still work
        console.warn('Continuing despite stream validation failure - video element may still work');
      }

      // Don't create a peer here - we create one per viewer when they join (viewer-joined)
      // Just notify the backend that the stream is live
      if (socket && socket.connected) {
        console.log('Emitting start-stream event...');
        socket.emit('start-stream', { streamId: newStream.id });
        console.log('Stream started successfully, streamId:', newStream.id, '- peers created when viewers join');
      } else {
        console.warn('Socket not connected, but stream is active locally');
        setError('Warning: Socket connection not available. Stream may not be visible to viewers.');
      }
    } catch (err: any) {
      console.error('Failed to start broadcast:', err);
      setError(
        err.message || 'Failed to start broadcast. Please check camera/microphone permissions.'
      );
      // Clean up on error
      setIsStreaming(false);
      setHasVideoStream(false);
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((track) => track.stop());
        localStreamRef.current = null;
      }
      peersRef.current.forEach((peer) => peer.close());
      peersRef.current.clear();
      if (videoRef.current?.srcObject) {
        videoRef.current.srcObject = null;
      }
    }
  };

  const stopStream = async () => {
    try {
      peersRef.current.forEach((peer) => peer.close());
      peersRef.current.clear();

      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((track) => track.stop());
        localStreamRef.current = null;
      }

      if (videoRef.current?.srcObject) {
        videoRef.current.srcObject = null;
      }

      if (stream && socket) {
        socket.emit('stop-stream', { streamId: stream.id });
      }

      setIsStreaming(false);
      setHasVideoStream(false);
      router.push('/');
    } catch (err) {
      console.error('Error stopping stream:', err);
    }
  };

  return (
    <main className="min-h-screen bg-gradient-to-br from-gray-900 via-purple-900 to-gray-900 p-8">
      <div className="max-w-4xl mx-auto">
        <div className="mb-6">
          <button
            onClick={() => router.push('/')}
            className="text-white hover:text-gray-300 mb-4 flex items-center gap-2"
          >
            <span>←</span> Back to streams
          </button>
          <h1 className="text-4xl font-bold text-white mb-2">Start Broadcasting</h1>
          <p className="text-gray-400">Share your content with the world</p>
        </div>

        {!isStreaming ? (
          <div className="bg-gray-800/50 backdrop-blur-sm rounded-lg p-6 space-y-4 border border-gray-700">
            <div>
              <label className="block text-white mb-2 font-semibold">Stream Title *</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full bg-gray-700/50 text-white px-4 py-3 rounded-lg border border-gray-600 focus:border-purple-500 focus:outline-none"
                placeholder="Enter stream title"
                maxLength={100}
              />
            </div>
            <div>
              <label className="block text-white mb-2 font-semibold">
                Description (optional)
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full bg-gray-700/50 text-white px-4 py-3 rounded-lg border border-gray-600 focus:border-purple-500 focus:outline-none resize-none"
                placeholder="Tell viewers what your stream is about"
                rows={4}
                maxLength={500}
              />
            </div>
            {error && (
              <div className="bg-red-500/20 border border-red-500 text-red-200 px-4 py-3 rounded-lg">
                <p className="font-semibold">Error:</p>
                <p>{error}</p>
              </div>
            )}
            <button
              onClick={startBroadcast}
              className="w-full bg-red-600 hover:bg-red-700 text-white px-6 py-4 rounded-lg font-semibold transition-colors flex items-center justify-center gap-2"
            >
              <span className="w-3 h-3 bg-white rounded-full"></span>
              Go Live
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="bg-gray-800/50 backdrop-blur-sm rounded-lg overflow-hidden border border-gray-700 relative">
              <video
                ref={videoRef}
                autoPlay
                muted
                playsInline
                className="w-full aspect-video bg-black"
                style={{ 
                  display: 'block', 
                  objectFit: 'contain',
                  width: '100%',
                  height: 'auto',
                  minHeight: '400px',
                  backgroundColor: '#000'
                }}
                width="1280"
                height="720"
                onLoadedMetadata={() => {
                  const video = videoRef.current;
                  if (video) {
                    console.log('Video metadata loaded', {
                      videoWidth: video.videoWidth,
                      videoHeight: video.videoHeight,
                      duration: video.duration,
                      readyState: video.readyState,
                    });
                    video.play()
                      .then(() => {
                        console.log('Video started playing from onLoadedMetadata', {
                          videoWidth: video.videoWidth,
                          videoHeight: video.videoHeight,
                        });
                      })
                      .catch((err) => {
                        console.error('Error playing video on metadata load:', err);
                        setError('Video playback error: ' + err.message);
                      });
                  }
                }}
                onLoadedData={() => {
                  const video = videoRef.current;
                  if (video) {
                    console.log('Video data loaded', {
                      videoWidth: video.videoWidth,
                      videoHeight: video.videoHeight,
                    });
                  }
                }}
                onCanPlay={() => {
                  const video = videoRef.current;
                  if (video) {
                    console.log('Video can play', {
                      videoWidth: video.videoWidth,
                      videoHeight: video.videoHeight,
                      readyState: video.readyState,
                    });
                    if (video.paused) {
                      video.play().catch(console.error);
                    }
                  }
                }}
                onPlay={() => {
                  const video = videoRef.current;
                  if (video) {
                    console.log('Video started playing', {
                      videoWidth: video.videoWidth,
                      videoHeight: video.videoHeight,
                      currentTime: video.currentTime,
                    });
                    setError(null);
                  }
                }}
                onPlaying={() => {
                  console.log('Video is now playing');
                }}
                onWaiting={() => {
                  console.warn('Video is waiting for data');
                }}
                onStalled={() => {
                  console.warn('Video playback stalled');
                }}
                onError={(e) => {
                  console.error('Video element error:', e);
                  const error = videoRef.current?.error;
                  if (error) {
                    let errorMsg = 'Video playback error';
                    switch (error.code) {
                      case error.MEDIA_ERR_ABORTED:
                        errorMsg = 'Video playback aborted';
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
                  } else {
                    setError('Video playback error. Please check your camera permissions.');
                  }
                }}
              />
              {!hasVideoStream && (
                <div className="absolute inset-0 flex items-center justify-center text-white bg-black/50 z-10">
                  <div className="text-center">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white mx-auto mb-4"></div>
                    <p>Initializing camera...</p>
                  </div>
                </div>
              )}
              {hasVideoStream && videoRef.current && videoRef.current.videoWidth === 0 && (
                <div className="absolute inset-0 flex items-center justify-center text-yellow-300 bg-black/70 z-10">
                  <div className="text-center">
                    <p className="text-lg font-semibold mb-2">⚠️ Video stream detected but no frames</p>
                    <p className="text-sm">Check console for details</p>
                    <button
                      onClick={() => {
                        if (videoRef.current && localStreamRef.current) {
                          videoRef.current.srcObject = localStreamRef.current;
                          videoRef.current.play().catch(console.error);
                        }
                      }}
                      className="mt-4 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
                    >
                      Retry Video
                    </button>
                  </div>
                </div>
              )}
            </div>
            <div className="bg-gray-800/50 backdrop-blur-sm rounded-lg p-4 border border-gray-700">
              <div className="flex items-center justify-between">
                <div className="text-white">
                  <p className="text-xl font-semibold">{stream?.title}</p>
                  <p className="text-sm text-gray-400 mt-1">
                    <span className="inline-flex items-center gap-2">
                      <span className="w-2 h-2 bg-red-600 rounded-full animate-pulse"></span>
                      {stream?.viewerCount || 0} viewers watching
                    </span>
                  </p>
                  {localStreamRef.current && (
                    <p className="text-xs text-green-400 mt-1">
                      ✓ Camera active ({localStreamRef.current.getVideoTracks().length} video track
                      {localStreamRef.current.getVideoTracks().length !== 1 ? 's' : ''})
                    </p>
                  )}
                </div>
                <button
                  onClick={stopStream}
                  className="bg-gray-700 hover:bg-gray-600 text-white px-6 py-3 rounded-lg font-semibold transition-colors"
                >
                  End Stream
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
