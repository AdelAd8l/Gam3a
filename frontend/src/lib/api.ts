// Typed client for the Gam3a API.

import { send, withQuery, type Query } from './http'
import { pendingCount, syncNow, write } from './offline'

export type MeetingKind = 'lecture' | 'lab' | 'section' | 'tutorial'
export type AssessmentKind = 'assignment' | 'quiz' | 'midterm' | 'final' | 'project' | 'other'
export type Scale = '4' | '5'

export interface User {
  id: number
  email: string
  name: string
  university: string
  scale: Scale
  week_start: number
  cutoffs: Record<string, number>
  default_target: string
  class_minutes: number
  points: Record<string, number>
  bands: Record<string, number>
  is_admin: boolean
  must_change_password: boolean
  timezone: string
  lang: 'en' | 'ar'
  notify_classes: boolean
  class_lead: number
  notify_deadlines: boolean
  deadline_lead: number
}
export interface SiteSettings {
  allow_signup: boolean
}
export interface AdminUser {
  id: number
  email: string
  name: string
  university: string
  scale: Scale
  is_admin: boolean
  must_change_password: boolean
  created_at: string
  terms: number
  courses: number
  assessments: number
}
export type AdminUserUpdate = Partial<Pick<AdminUser, 'name' | 'email' | 'university' | 'scale' | 'is_admin'>> & {
  new_password?: string
}

export interface Term {
  id: number
  name: string
  start_date: string
  end_date: string
  study_start: string
  study_end: string
  hours_per_credit: number
  session_minutes: number
  rest_days: number[]
}
export type TermInput = Omit<Term, 'id'>
export interface Meeting {
  id?: number
  weekday: number
  start: string
  end: string
  kind: MeetingKind
  location: string
}
export interface Course {
  id: number
  term_id: number
  code: string
  name: string
  credits: number
  instructor: string
  color: string
  grade: string | null
  in_gpa: boolean
  target_grade: string | null
  meetings: Meeting[]
  progress: Progress
}
export interface Progress {
  target_grade: string
  target_percent: number
  graded_weight: number
  listed_weight: number
  earned: number
  remaining_weight: number
  current: number | null
  current_letter: string | null
  max_possible: number
  max_letter: string
  required: number | null
  status: 'secured' | 'on_track' | 'needs' | 'out_of_reach' | 'no_data'
}
export type CourseInput = Omit<Course, 'id' | 'progress'>
export interface Busy {
  id: number
  term_id: number
  title: string
  weekday: number
  start: string
  end: string
}
export type BusyInput = Omit<Busy, 'id'>
export interface Assessment {
  id: number
  course_id: number
  title: string
  kind: AssessmentKind
  due_date: string | null
  due_time: string | null
  weight: number | null
  score: number | null
  points_earned: number | null
  points_max: number | null
  done: boolean
}
export type AssessmentInput = Omit<Assessment, 'id'>
export interface Block {
  kind: 'class' | 'busy' | 'study'
  weekday: number
  start: string
  end: string
  course_id: number | null
  ref_id: number | null
  title: string
  detail: string
}
export interface Plan {
  term_id: number
  blocks: Block[]
  conflicts: { a: Block; b: Block }[]
  unplaced: Record<string, number>
  study_minutes: number
  class_minutes: number
}
export interface TermGrades {
  term_id: number
  name: string
  start_date: string
  gpa: number | null
  gpa_credits: number
  earned_credits: number
  cgpa_before: number | null
  cgpa: number | null
  cumulative_credits: number
  cumulative_points: number
  in_progress: number
  gpa_class: string | null
  cgpa_class: string | null
}
export interface Grades {
  scale: Scale
  terms: TermGrades[]
  cgpa: number | null
  cgpa_class: string | null
  total_credits: number
  earned_credits: number
  points: number
}

export { ApiError } from './http'

async function request<T>(method: string, path: string, body?: unknown, query?: Query): Promise<T> {
  // Reads go straight to the network (React Query serves the saved copy when offline);
  // writes go through the outbox so nothing is lost without a signal.
  if (method === 'GET') {
    // Send queued changes first so the answer already includes them.
    if (pendingCount() && navigator.onLine) await syncNow()
    return send<T>(method, path, body, query)
  }
  // Account and notification calls need the server's answer; they never go to the outbox.
  if (['/auth/', '/push/', '/admin/'].some((p) => path.startsWith(p))) return send<T>(method, path, body, query)
  return write<T>(method, path, body)
}

export const api = {
  me: () => request<User>('GET', '/auth/me'),
  login: (email: string, password: string) => request<User>('POST', '/auth/login', { email, password }),
  register: (data: { name: string; email: string; password: string; university: string; scale: Scale }) =>
    request<User>('POST', '/auth/register', data),
  logout: () => request<void>('POST', '/auth/logout'),
  updateMe: (data: Partial<Omit<User, 'id' | 'email'>>) => request<User>('PATCH', '/auth/me', data),
  changePassword: (current_password: string, new_password: string) =>
    request<void>('POST', '/auth/password', { current_password, new_password }),
  deleteMe: () => request<void>('DELETE', '/auth/me'),

  terms: () => request<Term[]>('GET', '/terms'),
  saveTerm: (data: TermInput, id?: number) =>
    id ? request<Term>('PUT', `/terms/${id}`, data) : request<Term>('POST', '/terms', data),
  deleteTerm: (id: number) => request<void>('DELETE', `/terms/${id}`),
  plan: (termId: number) => request<Plan>('GET', `/terms/${termId}/plan`),
  calendarUrl: (termId: number, study: boolean) => withQuery(`/api/terms/${termId}/calendar.ics`, { study: String(study) }),

  courses: (termId?: number) => request<Course[]>('GET', '/courses', undefined, { term_id: termId }),
  course: (id: number) => request<Course>('GET', `/courses/${id}`),
  saveCourse: (data: CourseInput, id?: number) =>
    id ? request<Course>('PUT', `/courses/${id}`, data) : request<Course>('POST', '/courses', data),
  setGrade: (id: number, grade: string | null) => request<Course>('PUT', `/courses/${id}/grade`, { grade }),
  deleteCourse: (id: number) => request<void>('DELETE', `/courses/${id}`),

  busy: (termId: number) => request<Busy[]>('GET', '/busy', undefined, { term_id: termId }),
  saveBusy: (data: BusyInput, id?: number) =>
    id ? request<Busy>('PUT', `/busy/${id}`, data) : request<Busy>('POST', '/busy', data),
  deleteBusy: (id: number) => request<void>('DELETE', `/busy/${id}`),

  assessments: (query: Query) => request<Assessment[]>('GET', '/assessments', undefined, query),
  saveAssessment: (data: AssessmentInput, id?: number) =>
    id ? request<Assessment>('PUT', `/assessments/${id}`, data) : request<Assessment>('POST', '/assessments', data),
  deleteAssessment: (id: number) => request<void>('DELETE', `/assessments/${id}`),

  grades: () => request<Grades>('GET', '/grades'),

  pushKey: () => request<{ public_key: string }>('GET', '/push/key'),
  pushSubscribe: (sub: PushSubscriptionJSON) => request<void>('POST', '/push/subscribe', sub),
  pushUnsubscribe: (endpoint: string) => request<void>('POST', '/push/unsubscribe', { endpoint }),
  pushTest: () => request<{ sent: number }>('POST', '/push/test'),

  adminUsers: (q: string) => request<AdminUser[]>('GET', '/admin/users', undefined, { q }),
  adminUpdateUser: (id: number, data: AdminUserUpdate) => request<AdminUser>('PATCH', `/admin/users/${id}`, data),
  adminDeleteUser: (id: number) => request<void>('DELETE', `/admin/users/${id}`),
  adminSettings: () => request<SiteSettings>('GET', '/admin/settings'),
  adminSaveSettings: (data: SiteSettings) => request<SiteSettings>('PUT', '/admin/settings', data),
}
