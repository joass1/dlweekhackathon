'use client';

import React, { useEffect, useRef, useState } from 'react';
import {
  connect,
  type RemoteAudioTrack,
  type RemoteParticipant,
  type RemoteTrack,
  type RemoteVideoTrack,
  type Room,
} from 'twilio-video';
import { Video, VideoOff, Mic, MicOff, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { getPeerVideoToken } from '@/services/peer';

interface WebRTCVideoProps {
  sessionId: string;
  studentId: string;
  members: { student_id: string; name: string }[];
}

export function WebRTCVideo({ sessionId, studentId, members }: WebRTCVideoProps) {
  const { getIdToken } = useAuth();
  const [room, setRoom] = useState<Room | null>(null);
  const [participants, setParticipants] = useState<RemoteParticipant[]>([]);
  const [videoEnabled, setVideoEnabled] = useState(true);
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [debugInfo, setDebugInfo] = useState('Initializing...');
  const localVideoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    let mounted = true;
    let activeRoom: Room | null = null;

    const connectRoom = async () => {
      setConnectionError(null);
      setDebugInfo('Requesting Twilio token...');

      try {
        const idToken = await getIdToken();
        if (!idToken) {
          throw new Error('Missing auth token');
        }

        const tokenPayload = await getPeerVideoToken(sessionId, idToken);
        if (!mounted) return;

        setDebugInfo('Connecting to room...');
        const connectedRoom = await connect(tokenPayload.token, {
          name: tokenPayload.room_name,
          audio: true,
          video: { width: 640 },
        });
        if (!mounted) {
          connectedRoom.disconnect();
          return;
        }

        activeRoom = connectedRoom;
        setRoom(connectedRoom);
        setParticipants(Array.from(connectedRoom.participants.values()));
        setDebugInfo('Connected');

        const localVideoTrack = Array.from(connectedRoom.localParticipant.videoTracks.values())[0]?.track;
        const localAudioTrack = Array.from(connectedRoom.localParticipant.audioTracks.values())[0]?.track;

        setVideoEnabled(localVideoTrack?.isEnabled ?? false);
        setAudioEnabled(localAudioTrack?.isEnabled ?? false);

        if (localVideoRef.current && localVideoTrack) {
          localVideoTrack.attach(localVideoRef.current);
        }

        connectedRoom.on('participantConnected', (participant) => {
          setParticipants((prev) =>
            prev.some((p) => p.sid === participant.sid) ? prev : [...prev, participant]
          );
        });

        connectedRoom.on('participantDisconnected', (participant) => {
          setParticipants((prev) => prev.filter((p) => p.sid !== participant.sid));
        });

        connectedRoom.on('disconnected', () => {
          setParticipants([]);
        });
      } catch (error) {
        console.error('Twilio connection failed:', error);
        if (!mounted) return;
        setConnectionError('Could not connect video. Check Twilio credentials and try again.');
        setDebugInfo('Disconnected');
      }
    };

    connectRoom();

    return () => {
      mounted = false;

      if (localVideoRef.current) {
        localVideoRef.current.srcObject = null;
      }

      if (activeRoom) {
        activeRoom.localParticipant.videoTracks.forEach((publication) => {
          publication.track.stop();
          publication.track.detach().forEach((el) => el.remove());
        });
        activeRoom.localParticipant.audioTracks.forEach((publication) => {
          publication.track.stop();
          publication.track.detach().forEach((el) => el.remove());
        });
        activeRoom.disconnect();
      }
    };
  }, [getIdToken, sessionId]);

  const toggleVideo = () => {
    if (!room) return;
    const localVideoTrack = Array.from(room.localParticipant.videoTracks.values())[0]?.track;
    if (!localVideoTrack) return;

    if (localVideoTrack.isEnabled) {
      localVideoTrack.disable();
      setVideoEnabled(false);
    } else {
      localVideoTrack.enable();
      setVideoEnabled(true);
    }
  };

  const toggleAudio = () => {
    if (!room) return;
    const localAudioTrack = Array.from(room.localParticipant.audioTracks.values())[0]?.track;
    if (!localAudioTrack) return;

    if (localAudioTrack.isEnabled) {
      localAudioTrack.disable();
      setAudioEnabled(false);
    } else {
      localAudioTrack.enable();
      setAudioEnabled(true);
    }
  };

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
          <p className="text-xs text-gray-500 mt-2">You can still collaborate on questions below.</p>
        </div>
      </div>
    );
  }

  const totalParticipants = 1 + participants.length;
  const gridClass =
    totalParticipants <= 1
      ? 'grid-cols-1'
      : totalParticipants <= 2
        ? 'grid-cols-2'
        : 'grid-cols-2 grid-rows-2';

  return (
    <div className="space-y-2">
      <div className={`grid ${gridClass} gap-1 bg-gray-900 rounded-lg overflow-hidden aspect-video`}>
        <div className="relative bg-gray-800">
          <video ref={localVideoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
          <span className="absolute bottom-1 left-1 text-xs bg-black/60 text-white px-2 py-0.5 rounded">You</span>
          {!videoEnabled && (
            <div className="absolute inset-0 bg-gray-800 flex items-center justify-center">
              <VideoOff className="w-8 h-8 text-gray-500" />
            </div>
          )}
        </div>

        {participants.map((participant) => (
          <div key={participant.sid} className="relative bg-gray-800">
            <RemoteParticipantTile participant={participant} />
            <span className="absolute bottom-1 left-1 text-xs bg-black/60 text-white px-2 py-0.5 rounded">
              {getName(participant.identity)}
            </span>
          </div>
        ))}

        {Array.from({ length: Math.max(0, members.length - 1 - participants.length) }).map((_, i) => (
          <div key={`empty-${i}`} className="bg-gray-800 flex items-center justify-center">
            <Users className="w-6 h-6 text-gray-600" />
          </div>
        ))}
      </div>

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
          {participants.length + 1}/{members.length} connected
        </span>
      </div>

      {participants.length === 0 && <p className="text-xs text-center text-muted-foreground">{debugInfo}</p>}
    </div>
  );
}

function RemoteParticipantTile({ participant }: { participant: RemoteParticipant }) {
  const mediaContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const isMediaTrack = (track: RemoteTrack): track is RemoteAudioTrack | RemoteVideoTrack => {
      return track.kind === 'audio' || track.kind === 'video';
    };

    const attachTrack = (track: RemoteTrack) => {
      if (!isMediaTrack(track)) return;
      const container = mediaContainerRef.current;
      if (!container) return;
      const element = track.attach();
      if (track.kind === 'video') {
        element.className = 'w-full h-full object-cover';
      } else {
        element.className = 'hidden';
      }
      container.appendChild(element);
    };

    const detachTrack = (track: RemoteTrack) => {
      if (!isMediaTrack(track)) return;
      track.detach().forEach((el) => el.remove());
    };

    participant.tracks.forEach((publication) => {
      if (publication.isSubscribed && publication.track) {
        attachTrack(publication.track);
      }
    });

    const handleTrackSubscribed = (track: RemoteTrack) => attachTrack(track);
    const handleTrackUnsubscribed = (track: RemoteTrack) => detachTrack(track);

    participant.on('trackSubscribed', handleTrackSubscribed);
    participant.on('trackUnsubscribed', handleTrackUnsubscribed);

    return () => {
      participant.off('trackSubscribed', handleTrackSubscribed);
      participant.off('trackUnsubscribed', handleTrackUnsubscribed);
      participant.tracks.forEach((publication) => {
        if (publication.track) {
          detachTrack(publication.track);
        }
      });
    };
  }, [participant]);

  return <div ref={mediaContainerRef} className="w-full h-full" />;
}
