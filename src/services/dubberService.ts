export interface Dubber {
  id: string;
  nickname: string;
  telegram: string;
  tgChannel: string;
  vkLink: string;
}

export const STORAGE_KEY = 'polza_studio_dubbers';

export const getDubbers = (): Dubber[] => {
  const data = localStorage.getItem(STORAGE_KEY);
  return data ? JSON.parse(data) : [];
};

export const saveDubber = (dubber: Dubber) => {
  const dubbers = getDubbers();
  const index = dubbers.findIndex(d => d.id === dubber.id);
  if (index !== -1) {
    dubbers[index] = dubber;
  } else {
    dubbers.push(dubber);
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(dubbers));
};

export const deleteDubber = (id: string) => {
  const dubbers = getDubbers().filter(d => d.id !== id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(dubbers));
};
