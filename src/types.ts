export interface Participant {
  id: string;
  nickname: string;
  telegram: string;
  tgChannel: string;
  vkLink: string;
  roles: string[];
}

declare global {
  interface Window {
    electronAPI: {
      invoke: (channel: string, ...args: any[]) => Promise<any>;
      on: (channel: string, callback: (...args: any[]) => void) => () => void;
    };
  }
}

export type EpisodeStatus = "UPLOAD" | "ROLES" | "RECORDING" | "QA" | "FIXES" | "SOUND_ENGINEERING" | "FINISHED";
export type ReleaseType = "VOICEOVER" | "RECAST" | "REDUB";

export interface Episode {
  id: string;
  projectId: string;
  project?: Project;
  number: number;
  status: EpisodeStatus;
  deadline?: string;
  rawPath?: string;
  subPath?: string;
  assignments: RoleAssignment[];
  uploads: UploadedFile[];
  createdAt: string;
  updatedAt: string;
}

export interface RoleAssignment {
  id: string;
  episodeId: string;
  characterName: string;
  dubberId: string;
  dubber?: Participant;
  substituteId?: string;
  substitute?: Participant;
  status: string; // "PENDING", "RECORDED", "APPROVED", "REJECTED", "FIXES_NEEDED"
  comments?: string; // JSON string
  lineCount?: number;
}

export interface UploadedFile {
  id: string;
  episodeId: string;
  assignmentId?: string;
  type: "DUBBER_FILE" | "FIXES";
  path: string;
  uploadedById: string;
  uploadedBy?: Participant;
  createdAt: string;
}

export interface Project {
  id: string;
  title: string;
  originalTitle?: string;
  status: "ACTIVE" | "COMPLETED";
  lastActiveEpisode: number;
  totalEpisodes: number;
  assignedDubberIds: string[];
  soundEngineerId?: string;
  releaseType?: ReleaseType;
  emoji?: string;
  isOngoing?: boolean;
  synopsis?: string;
  posterUrl?: string;
  links?: string; // JSON string
  globalMapping?: string; // JSON string
  characterAliases?: string; // JSON string: Record<string, string> (alias -> mainName)
  episodes: Episode[];
  createdAt: string;
  updatedAt: string;
}
