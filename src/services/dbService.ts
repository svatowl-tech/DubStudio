import { Participant } from '../types';

export const getParticipants = async (): Promise<Participant[]> => {
  const response = await fetch('/api/participants');
  return response.json();
};

export const saveParticipant = async (participant: Participant): Promise<void> => {
  let response;
  if (participant.id) {
    response = await fetch(`/api/participants/${participant.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(participant),
    });
  } else {
    response = await fetch('/api/participants', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(participant),
    });
  }
  
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `Failed to save participant: ${response.statusText}`);
  }
};

export const deleteParticipant = async (id: string): Promise<void> => {
  await fetch(`/api/participants/${id}`, { method: 'DELETE' });
};

export const exportParticipants = async (): Promise<string> => {
  const participants = await getParticipants();
  return JSON.stringify(participants);
};

export const importParticipants = async (json: string): Promise<void> => {
  const participants: Participant[] = JSON.parse(json);
  for (const participant of participants) {
    const response = await fetch('/api/participants', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nickname: participant.nickname,
        telegram: participant.telegram,
        tgChannel: participant.tgChannel,
        vkLink: participant.vkLink,
        roles: participant.roles
      }),
    });
    
    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(`Failed to import participant ${participant.nickname}: ${errorData.error || response.statusText}`);
    }
  }
};
