import { Participant } from '../types';
import { ipcRenderer } from '../lib/ipc';

export const getParticipants = async (): Promise<Participant[]> => {
  return await ipcRenderer.invoke('get-participants');
};

export const saveParticipant = async (participant: Participant): Promise<void> => {
  return await ipcRenderer.invoke('save-participant', participant);
};

export const deleteParticipant = async (id: string): Promise<void> => {
  return await ipcRenderer.invoke('delete-participant', id);
};

export const exportParticipants = async (): Promise<string> => {
  const participants = await getParticipants();
  return JSON.stringify(participants);
};

export const importParticipants = async (json: string): Promise<void> => {
  const participants: Participant[] = JSON.parse(json);
  return await ipcRenderer.invoke('import-participants', participants);
};
