export interface Participant {
  id: string;
  nickname: string;
  telegram: string;
  tgChannel: string;
  vkLink: string;
  roles: string[];
}

export type EpisodeStatus = "UPLOAD" | "ROLES" | "RECORDING" | "QA" | "FIXES" | "SOUND_ENGINEERING" | "FINISHED";

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
  status: string; // "PENDING", "RECORDED", "APPROVED", "REJECTED", "FIXES_NEEDED"
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
  status: "ACTIVE" | "COMPLETED";
  lastActiveEpisode: number;
  totalEpisodes: number;
  links?: string; // JSON string
  globalMapping?: string; // JSON string
  episodes: Episode[];
  createdAt: string;
  updatedAt: string;
}
