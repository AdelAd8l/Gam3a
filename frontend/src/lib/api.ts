// Typed client for the Gam3a API.

import { serverError } from './i18n'

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
  cgpa: number | null
  cumulative_credits: number
  cumulative_points: number
  in_progress: number
}
export interface Grades {
  scale: Scale
  terms: TermGrades[]
  cgpa: number | null
  total_credits: number
  earned_credits: number
  points: number
}

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

type Query = Record<string, string | number | undefined | null>

function withQuery(path: string, query?: Query) {
  if (!query) return path
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== '') params.set(k, String(v))
  }
  const qs = params.toString()
  return qs ? `${path}?${qs}` : path
}

async function request<T>(method: string, path: string, body?: unknown, query?: Query): Promise<T> {
  const init: RequestInit = { method, credentials: 'same-origin', headers: {} }
  if (body instanceof FormData) {
    init.body = body
  } else if (body !== undefined) {
    init.body = JSON.stringify(body)
    init.headers = { 'Content-Type': 'application/json' }
  }
  const res = await fetch(withQuery(`/api${path}`, query), init)
  if (!res.ok) {
    let message = res.statusText
    try {
      const data = await res.json()
      if (typeof data.detail === 'string') message = data.detail
      else if (Array.isArray(data.detail)) message = data.detail.map((d: { msg: string }) => d.msg.replace(/^Value error, /, '')).join('. ')
    } catch {
      /* not JSON */
    }
    throw new ApiError(res.status, serverError(message))
  }
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
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
}
