import { useEffect, useRef, useState } from 'react';
import WaveSurfer from 'wavesurfer.js';
import RegionsPlugin from 'wavesurfer.js/dist/plugins/regions.esm.js';
import { Track, SubtitleLine } from '../../types';

interface TrackWaveformProps {
  track: Track;
  currentTime: number;
  isPlaying: boolean;
  subLines: SubtitleLine[];
  onTimeUpdate: (time: number) => void;
  onPlayPause: () => void;
  volume: number;
  isMuted: boolean;
  onRegionClick: (region: any) => void;
}

export const TrackWaveform = ({ track, currentTime, isPlaying, subLines, onTimeUpdate, onPlayPause, volume, isMuted, onRegionClick }: TrackWaveformProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const wavesurferRef = useRef<WaveSurfer | null>(null);
  const regionsRef = useRef<any>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    wavesurferRef.current = WaveSurfer.create({
      container: containerRef.current,
      waveColor: '#3b82f6',
      progressColor: '#1d4ed8',
      cursorColor: '#ffffff',
      barWidth: 2,
      barGap: 3,
      height: 80,
      normalize: true,
    });

    regionsRef.current = wavesurferRef.current.registerPlugin(RegionsPlugin.create());

    wavesurferRef.current.on('error', (err: any) => {
      if (err.name === 'AbortError' || err.message?.includes('aborted')) return;
      console.error('WaveSurfer error:', err);
    });

    // Region click handler
    regionsRef.current.on('region-click', (region: any, e: MouseEvent) => {
      e.stopPropagation();
      onRegionClick(region);
    });

    const selectedFile = track.files.find(f => f.id === track.selectedFileId) || track.files[0];
    if (selectedFile && selectedFile.path) {
      const audioUrl = selectedFile.path.startsWith('file://') || selectedFile.path.startsWith('http') ? selectedFile.path : `file://${selectedFile.path}`;
      wavesurferRef.current.load(audioUrl).catch(err => {
        if (err.name === 'AbortError' || err.message?.includes('aborted')) return;
        console.error('WaveSurfer load error:', err);
      });
    }

    wavesurferRef.current.on('audioprocess', () => {
      const time = wavesurferRef.current?.getCurrentTime() || 0;
      onTimeUpdate(time);
    });

    wavesurferRef.current.on('play', () => {
      if (!isPlaying) onPlayPause();
    });
    wavesurferRef.current.on('pause', () => {
      if (isPlaying) onPlayPause();
    });

    let isUnmounted = false;

    // Add regions
    wavesurferRef.current.on('ready', () => {
      if (isUnmounted) return;
      subLines.forEach(line => {
        try {
          regionsRef.current.addRegion({
            start: line.startSec,
            end: line.endSec,
            color: 'rgba(59, 130, 246, 0.1)',
            drag: false,
            resize: false,
            content: line.text
          });
        } catch (e: any) {
          if (e.message !== 'WaveSurfer is not initialized') {
            console.error('Failed to add region:', e);
          }
        }
      });
    });

    return () => {
      isUnmounted = true;
      wavesurferRef.current?.destroy();
    };
  }, [track.id]);

  useEffect(() => {
    if (wavesurferRef.current) {
      wavesurferRef.current.setVolume(isMuted ? 0 : volume);
    }
  }, [volume, isMuted]);

  useEffect(() => {
    if (wavesurferRef.current) {
      if (isPlaying) {
        wavesurferRef.current.play();
      } else {
        wavesurferRef.current.pause();
      }
    }
  }, [isPlaying]);

  useEffect(() => {
    if (wavesurferRef.current && Math.abs(wavesurferRef.current.getCurrentTime() - currentTime) > 0.1) {
      wavesurferRef.current.setTime(currentTime);
    }
  }, [currentTime]);

  return <div ref={containerRef} className="w-full" />;
};
