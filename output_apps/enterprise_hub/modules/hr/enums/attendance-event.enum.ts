export enum AttendanceEventKind {
  IN = 'in',
  OUT = 'out',
}

export enum AttendanceEventSource {
  MANUAL = 'manual',
  POS_PIN = 'pos_pin',
  DEVICE_IMPORT = 'device_import',
}

export enum DailyAttendanceStatus {
  PRESENT = 'present',
  ABSENT = 'absent',
  LATE = 'late',
  ON_LEAVE = 'on_leave',
}
