import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createContext, useContext } from 'react'

import { api, ApiError, type Assessment, type Course, type Term, type User } from './api'

export function useMe() {
  return useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      try {
        return await api.me()
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null
        throw e
      }
    },
    staleTime: Infinity,
    // "Not signed in" is always checked again: after "Continue with Google" the browser comes back
    // signed in, and a saved answer from the sign-in page would hide that. (A signed-in user still
    // starts from the saved copy, so the app opens offline.)
    refetchOnMount: (query) => (query.state.data == null ? 'always' : false),
  })
}

/** The signed-in user. Only call inside the authenticated layout. */
export function useUser(): User {
  const { data } = useMe()
  if (!data) throw new Error('useUser() outside authenticated area')
  return data
}

export const useTerms = () => useQuery({ queryKey: ['terms'], queryFn: api.terms })

export function useCourses(termId: number | undefined) {
  const query = useQuery({
    queryKey: ['courses', termId],
    queryFn: () => api.courses(termId),
    enabled: termId !== undefined,
  })
  const byId = new Map((query.data ?? []).map((c) => [c.id, c]))
  return { ...query, byId }
}

export const usePlan = (termId: number | undefined) =>
  useQuery({ queryKey: ['plan', termId], queryFn: () => api.plan(termId!), enabled: termId !== undefined })

/** Invalidate everything that depends on courses, classes, timings or grades. */
export function useRefresh() {
  const qc = useQueryClient()
  return () =>
    Promise.all(
      ['terms', 'courses', 'plan', 'busy', 'assessments', 'grades'].map((key) =>
        qc.invalidateQueries({ queryKey: [key] }),
      ),
    )
}

// ---- selected term, shared by every page ----------------------------------------

export interface TermState {
  term: Term | undefined
  terms: Term[]
  setTermId: (id: number) => void
}

export const TermContext = createContext<TermState | null>(null)

export function useTerm() {
  const ctx = useContext(TermContext)
  if (!ctx) throw new Error('useTerm() outside TermContext')
  return ctx
}

// ---- global dialogs --------------------------------------------------------------

export interface Dialogs {
  editCourse: (course?: Course) => void
  editAssessment: (item?: Assessment, preset?: { course_id?: number }) => void
  editTerm: (term?: Term) => void
}

export const DialogContext = createContext<Dialogs>({
  editCourse: () => {},
  editAssessment: () => {},
  editTerm: () => {},
})

export const useDialogs = () => useContext(DialogContext)
