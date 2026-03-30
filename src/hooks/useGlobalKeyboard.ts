import { useEffect } from 'react';
import { useVideoContext } from '../contexts/VideoContext';

export const useGlobalKeyboard = () => {
  const { togglePlayPause } = useVideoContext();

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code === 'Space') {
        // Prevent default scrolling behavior
        event.preventDefault();
        togglePlayPause();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [togglePlayPause]);
};
