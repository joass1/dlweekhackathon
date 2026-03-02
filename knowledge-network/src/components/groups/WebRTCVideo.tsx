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
  const [debugInfo, setDebugInfo] = useState('Initializing...');

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const peerConnectionsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const localStreamRef = useRef<MediaStream | null>(null);
  const cancelledRef = useRef(false);

  // Get the WebSocket URL from the backend
  const getWsUrl = useCallback(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.hostname;
    // Use the API base URL if set, otherwise default to port 8000
    let port = '8000';
    if (process.env.NEXT_PUBLIC_API_BASE_URL) {
      try {
        const apiUrl = new URL(process.env.NEXT_PUBLIC_API_BASE_URL);
        port = apiUrl.port || (apiUrl.protocol === 'https:' ? '443' : '8000');
      } catch {
        // keep default
      }
    }
    return `${protocol}//${host}:${port}/ws/peer/signal/${sessionId}`;
  }, [sessionId]);

  // Create a peer connection for a specific remote peer
  const createPeerConnection = useCallback((remoteStudentId: string) => {
    console.log(`[WebRTC] Creating peer connection for ${remoteStudentId}`);

    // Close existing connection if any
    const existingPc = peerConnectionsRef.current.get(remoteStudentId);
    if (existingPc) {
      existingPc.close();
      peerConnectionsRef.current.delete(remoteStudentId);
    }

    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

    // Add local tracks to the connection
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => {
        pc.addTrack(track, localStreamRef.current!);
      });
      console.log(`[WebRTC] Added ${localStreamRef.current.getTracks().length} local tracks`);
    } else {
      console.warn('[WebRTC] No local stream when creating peer connection!');
    }

    // Handle incoming remote tracks
    pc.ontrack = (event) => {
      console.log(`[WebRTC] Got remote track from ${remoteStudentId}:`, event.track.kind);
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

    pc.oniceconnectionstatechange = () => {
      console.log(`[WebRTC] ICE state for ${remoteStudentId}: ${pc.iceConnectionState}`);
      if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
        setConnectedPeers((prev) =>
          prev.includes(remoteStudentId) ? prev : [...prev, remoteStudentId]
        );
      }
    };

    pc.onconnectionstatechange = () => {
      console.log(`[WebRTC] Connection state for ${remoteStudentId}: ${pc.connectionState}`);
      if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
        setConnectedPeers((prev) => prev.filter((id) => id !== remoteStudentId));
      }
    };

    peerConnectionsRef.current.set(remoteStudentId, pc);
    return pc;
  }, []);

  // Initialize media + WebSocket signaling
  useEffect(() => {
    cancelledRef.current = false;

    const init = async () => {
      setDebugInfo('Requesting camera/mic...');

      // 1. Get local camera + mic
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true,
        });
        if (cancelledRef.current) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        localStreamRef.current = stream;
        setLocalStream(stream);
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
        }
        console.log('[WebRTC] Got local stream:', stream.getTracks().map(t => t.kind).join(', '));
        setDebugInfo('Camera OK. Connecting to signaling...');
      } catch (err) {
        console.error('Failed to get user media:', err);
        setConnectionError(
          'Camera/mic access denied. Please allow access and reload.'
        );
        return;
      }

      // 2. Connect to signaling server
      const wsUrl = getWsUrl();
      console.log('[WebRTC] Connecting to signaling server:', wsUrl);
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('[WebRTC] WebSocket connected, joining as', studentId);
        setDebugInfo('Connected. Joining room...');
        ws.send(JSON.stringify({ type: 'join', student_id: studentId }));
      };

      ws.onmessage = async (event) => {
        const msg = JSON.parse(event.data);
        console.log('[WebRTC] Received:', msg.type, msg.from || msg.student_id || '');

        switch (msg.type) {
          case 'peer-joined': {
            // Determine if WE just joined or if someone else joined
            // If msg.student_id === our ID, this is OUR join confirmation
            // → we should create offers to all listed peers
            // If msg.student_id !== our ID, someone else joined
            // → WAIT for them to send us an offer (don't create one)
            if (msg.student_id === studentId) {
              // We just joined — create offers to all existing peers
              const peers: string[] = msg.peers || [];
              setDebugInfo(`Joined! Found ${peers.length} peer(s)`);
              console.log('[WebRTC] We joined, existing peers:', peers);
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
                    console.log('[WebRTC] Sent offer to', peerId);
                  } catch (err) {
                    console.error('Failed to create offer:', err);
                  }
                }
              }
            } else {
              // Someone else joined — they will send us an offer, just wait
              console.log('[WebRTC] Peer joined:', msg.student_id, '— waiting for their offer');
              setDebugInfo(`Peer ${msg.student_id} joined, waiting for connection...`);
            }
            break;
          }

          case 'offer': {
            const fromId = msg.from;
            console.log('[WebRTC] Received offer from', fromId);
            // Always create a fresh connection for incoming offers
            const pc = createPeerConnection(fromId);
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
              console.log('[WebRTC] Sent answer to', fromId);
              setDebugInfo(`Connected to peer ${fromId}`);
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
                console.log('[WebRTC] Set answer from', fromId);
                setDebugInfo(`Connected to peer ${fromId}`);
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
                // ICE candidates can arrive before remote description; this is ok
                console.warn('Failed to add ICE candidate (may be ok):', err);
              }
            }
            break;
          }

          case 'peer-left': {
            const leftId = msg.student_id;
            console.log('[WebRTC] Peer left:', leftId);
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

      ws.onerror = (err) => {
        console.error('[WebRTC] WebSocket error:', err);
        setConnectionError('Signaling connection failed. Video chat unavailable.');
      };

      ws.onclose = () => {
        console.log('[WebRTC] WebSocket closed');
        // Attempt reconnect after 3s if not intentionally closed
        if (!cancelledRef.current) {
          setDebugInfo('Disconnected. Reconnecting...');
          setTimeout(() => {
            if (!cancelledRef.current) {
              // Clean up old peer connections before reconnecting
              peerConnectionsRef.current.forEach((pc) => pc.close());
              peerConnectionsRef.current.clear();
              setRemoteStreams([]);
              setConnectedPeers([]);
              init();
            }
          }, 3000);
        }
      };
    };

    init();

    return () => {
      cancelledRef.current = true;

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

      {/* Debug info — shows connection status */}
      {connectedPeers.length === 0 && (
        <p className="text-xs text-center text-muted-foreground">{debugInfo}</p>
      )}
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
