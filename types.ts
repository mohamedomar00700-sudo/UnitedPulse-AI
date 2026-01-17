
export enum AttendanceStatus {
  PRESENT = 'PRESENT',
  ABSENT = 'ABSENT',
  UNEXPECTED = 'UNEXPECTED'
}

export enum MatchSensitivity {
  STRICT = 'STRICT',
  BALANCED = 'BALANCED',
  FLEXIBLE = 'FLEXIBLE'
}

export interface Attendee {
  name: string;
  status: AttendanceStatus;
  originalName?: string; // Name found in Zoom screenshot that matched this attendee
}

export interface ProcessingResult {
  present: Attendee[];
  absent: Attendee[];
  unexpected: Attendee[];
}
