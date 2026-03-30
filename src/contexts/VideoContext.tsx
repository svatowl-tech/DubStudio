import React, { createContext, useContext, useState, useRef } from 'react';

interface VideoContextType {
  togglePlayPause: () => void;
  registerPlayer: (playPauseFn: () => void) => void;
  unregisterPlayer: () => void;
}

const VideoContext = createContext<VideoContextType | undefined>(undefined);

export const VideoProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const playPauseFnRef = useRef<(() => void) | null>(null);

  const registerPlayer = (playPauseFn: () => void) => {
    playPauseFnRef.current = playPauseFn;
  };

  const unregisterPlayer = () => {
    playPauseFnRef.current = null;
  };

  const togglePlayPause = () => {
    if (playPauseFnRef.current) {
      playPauseFnRef.current();
    }
  };

  return (
    <VideoContext.Provider value={{ togglePlayPause, registerPlayer, unregisterPlayer }}>
      {children}
    </VideoContext.Provider>
  );
};

export const useVideoContext = () => {
  const context = useContext(VideoContext);
  if (!context) {
    throw new Error('useVideoContext must be used within a VideoProvider');
  }
  return context;
};
