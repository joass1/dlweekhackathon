'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Video, VideoOff, Mic, MicOff, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';

// STUN/TURN configuration — works on localhost + cloud
const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
];

// Allow configuring a TURN server via env for production NAT traversal
const TURN_URL = process.env.NEXT_PUBLIC_TURN_URL;
const TURN_USER = process.env.NEXT_PUBLIC_TURN_USERNAME;
const TURN_PASS = process.env.NEXT_PUBLIC_TURN_CREDENTIAL;

if (TURN_URL) {
  ICE_SERVERS.push({
    urls: TURN_URL,
    username: TURN_USER || '',
    credential: TURN_PASS || '',
  });
}

interface PeerStream {
  studentId: string;
  stream: MediaStream;
}

interface WebRTCVideoProps {
  sessionId: string;
  studentId: string;
  members: { student_id: string; name: string }[];
}

export function WebRTCVideo({ sessionId, studentId, members }: WebRTCVideoProps) {
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStreams, setRemoteStreams] = useState<PeerStream[]>([]);
  const [videoEnabled, setVideoEnabled] = useState(true);
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [connectedPeers, setConnectedPeers] = useState<string[]>([]);

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const peerConnectionsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const localStreamRef = useRef<MediaStream | null>(null);

  // Get the WebSocket URL from the current page URL
  const getWsUrl = useCallback(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    // In dev, the backend runs on port 8000
    const host = window.location.hostname;
    const port = process.env.NEXT_PUBLIC_API_BASE_URL
      ? new URL(process.env.NEXT_PUBLIC_API_BASE_URL).port || '8000'
      : '8000';
    return `${protocol}//${host}:${port}/ws/peer/signal/${sessionId}`;
  }, [sessionId]);

  // Create a peer connection for a specific remote peer
  const createPeerConnection = useCallback((remoteStudentId: string) => {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

    // Add local tracks to the connection
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => {
        pc.addTrack(track, localStreamRef.current!);
      });
    }

    // Handle incoming remote tracks
    pc.ontrack = (event) => {
      const [remoteStream] = event.streams;
      if (remoteStream) {
        setRemoteStreams((prev) => {
          const existing = prev.find((p) => p.studentId === remoteStudentId);
          if (existing) {
            return prev.map((p) =>
              p.studentId === remoteStudentId ? { ...p, stream: remoteStream } : p
            );
          }
          return [...prev, { studentId: remoteStudentId, stream: remoteStream }];
        });
        setConnectedPeers((prev) =>
          prev.includes(remoteStudentId) ? prev : [...prev, remoteStudentId]
        );
      }
    };

    // Send ICE candidates to the remote peer via signaling
    pc.onicecandidate = (event) => {
      if (event.candidate && wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(
          JSON.stringify({
            type: 'ice-candidate',
            target: remoteStudentId,
            candidate: event.candidate.toJSON(),
          })
        );
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
        setConnectedPeers((prev) => prev.filter((id) => id !== remoteStudentId));
      }
    };

    peerConnectionsRef.current.set(remoteStudentId, pc);
    return pc;
  }, []);

  // Initialize media + WebSocket signaling
  useEffect(() => {
    let cancelled = false;

    const init = async () => {
      // 1. Get local camera + mic
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        localStreamRef.current = stream;
        setLocalStream(stream);
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
        }
      } catch (err) {
        console.error('Failed to get user media:', err);
        setConnectionError(
          'Camera/mic access denied. Please allow access and reload.'
        );
        return;
      }

      // 2. Connect to signaling server
      const wsUrl = getWsUrl();
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        ws.send(JSON.stringify({ type: 'join', student_id: studentId }));
      };

      ws.onmessage = async (event) => {
        const msg = JSON.parse(event.data);

        switch (msg.type) {
          case 'peer-joined': {
            // When we join, server tells us about existing peers
            // We create offers to all existing peers
            const peers: string[] = msg.peers || [];
            for (const peerId of peers) {
              if (peerId !== studentId && !peerConnectionsRef.current.has(peerId)) {
                const pc = createPeerConnection(peerId);
                try {
                  const offer = await pc.createOffer();
                  await pc.setLocalDescription(offer);
                  ws.send(
                    JSON.stringify({
                      type: 'offer',
                      target: peerId,
                      sdp: pc.localDescription,
                    })
                  );
                } catch (err) {
                  console.error('Failed to create offer:', err);
                }
              }
            }
            break;
          }

          case 'offer': {
            const fromId = msg.from;
            let pc = peerConnectionsRef.current.get(fromId);
            if (!pc) {
              pc = createPeerConnection(fromId);
            }
            try {
              await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
              const answer = await pc.createAnswer();
              await pc.setLocalDescription(answer);
              ws.send(
                JSON.stringify({
                  type: 'answer',
                  target: fromId,
                  sdp: pc.localDescription,
                })
              );
            } catch (err) {
              console.error('Failed to handle offer:', err);
            }
            break;
          }

          case 'answer': {
            const fromId = msg.from;
            const pc = peerConnectionsRef.current.get(fromId);
            if (pc) {
              try {
                await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
              } catch (err) {
                console.error('Failed to set remote description:', err);
              }
            }
            break;
          }

          case 'ice-candidate': {
            const fromId = msg.from;
            const pc = peerConnectionsRef.current.get(fromId);
            if (pc && msg.candidate) {
              try {
                await pc.addIceCandidate(new RTCIceCandidate(msg.candidate));
              } catch (err) {
                console.error('Failed to add ICE candidate:', err);
              }
            }
            break;
          }

          case 'peer-left': {
            const leftId = msg.student_id;
            const pc = peerConnectionsRef.current.get(leftId);
            if (pc) {
              pc.close();
              peerConnectionsRef.current.delete(leftId);
            }
            setRemoteStreams((prev) => prev.filter((p) => p.studentId !== leftId));
            setConnectedPeers((prev) => prev.filter((id) => id !== leftId));
            break;
          }
        }
      };

      ws.onerror = () => {
        setConnectionError('Signaling connection failed. Video chat unavailable.');
      };

      ws.onclose = () => {
        // Attempt reconnect after 3s if not intentionally closed
        if (!cancelled) {
          setTimeout(() => {
            if (!cancelled && wsRef.current === ws) {
              init();
            }
          }, 3000);
        }
      };
    };

    init();

    return () => {
      cancelled = true;

      // Close WebSocket
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }

      // Close all peer connections
      peerConnectionsRef.current.forEach((pc) => pc.close());
      peerConnectionsRef.current.clear();

      // Stop local media
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((t) => t.stop());
        localStreamRef.current = null;
      }
    };
  }, [sessionId, studentId, getWsUrl, createPeerConnection]);

  // Sync local video ref when stream changes
  useEffect(() => {
    if (localVideoRef.current && localStream) {
      localVideoRef.current.srcObject = localStream;
    }
  }, [localStream]);

  // Toggle video
  const toggleVideo = () => {
    if (localStreamRef.current) {
      const videoTrack = localStreamRef.current.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        setVideoEnabled(videoTrack.enabled);
      }
    }
  };

  // Toggle audio
  const toggleAudio = () => {
    if (localStreamRef.current) {
      const audioTrack = localStreamRef.current.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setAudioEnabled(audioTrack.enabled);
      }
    }
  };

  // Find display name for a student
  const getName = (sid: string) => {
    const member = members.find((m) => m.student_id === sid);
    return member?.name || sid;
  };

  if (connectionError) {
    return (
      <div className="w-full aspect-video bg-gray-900 rounded-lg flex items-center justify-center">
        <div className="text-center px-6">
          <Video className="w-10 h-10 text-gray-500 mx-auto mb-3" />
          <p className="text-sm text-gray-400">{connectionError}</p>
          <p className="text-xs text-gray-500 mt-2">
            You can still collaborate on questions below.
          </p>
        </div>
      </div>
    );
  }

  const totalParticipants = 1 + remoteStreams.length;
  // Grid layout: 1 = full, 2 = side by side, 3-4 = 2x2
  const gridClass =
    totalParticipants <= 1
      ? 'grid-cols-1'
      : totalParticipants <= 2
        ? 'grid-cols-2'
        : 'grid-cols-2 grid-rows-2';

  return (
    <div className="space-y-2">
      {/* Video grid */}
      <div className={`grid ${gridClass} gap-1 bg-gray-900 rounded-lg overflow-hidden aspect-video`}>
        {/* Local video */}
        <div className="relative bg-gray-800">
          <video
            ref={localVideoRef}
            autoPlay
            playsInline
            muted
            className="w-full h-full object-cover"
          />
          <span className="absolute bottom-1 left-1 text-xs bg-black/60 text-white px-2 py-0.5 rounded">
            You
          </span>
          {!videoEnabled && (
            <div className="absolute inset-0 bg-gray-800 flex items-center justify-center">
              <VideoOff className="w-8 h-8 text-gray-500" />
            </div>
          )}
        </div>

        {/* Remote videos */}
        {remoteStreams.map((ps) => (
          <div key={ps.studentId} className="relative bg-gray-800">
            <RemoteVideo stream={ps.stream} />
            <span className="absolute bottom-1 left-1 text-xs bg-black/60 text-white px-2 py-0.5 rounded">
              {getName(ps.studentId)}
            </span>
          </div>
        ))}

        {/* Empty slots for expected members not yet connected */}
        {Array.from({ length: Math.max(0, members.length - 1 - remoteStreams.length) }).map(
          (_, i) => (
            <div
              key={`empty-${i}`}
              className="bg-gray-800 flex items-center justify-center"
            >
              <Users className="w-6 h-6 text-gray-600" />
            </div>
          )
        )}
      </div>

      {/* Controls */}
      <div className="flex items-center justify-center gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={toggleVideo}
          className={`h-8 w-8 p-0 ${!videoEnabled ? 'bg-red-100 border-red-300 text-red-600' : ''}`}
        >
          {videoEnabled ? <Video className="w-4 h-4" /> : <VideoOff className="w-4 h-4" />}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={toggleAudio}
          className={`h-8 w-8 p-0 ${!audioEnabled ? 'bg-red-100 border-red-300 text-red-600' : ''}`}
        >
          {audioEnabled ? <Mic className="w-4 h-4" /> : <MicOff className="w-4 h-4" />}
        </Button>
        <span className="text-xs text-muted-foreground ml-2">
          {connectedPeers.length + 1}/{members.length} connected
        </span>
      </div>
    </div>
  );
}

// Separate component for remote video to handle ref assignment properly
function RemoteVideo({ stream }: { stream: MediaStream }) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  return (
    <video
      ref={videoRef}
      autoPlay
      playsInline
      className="w-full h-full object-cover"
    />
  );
}
