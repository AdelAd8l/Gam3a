// Asking "are you sure?" with the app's own dialog instead of the browser's confirm() popup.
// Call ask() from anywhere; <ConfirmHost /> (mounted once in main.tsx) shows the question.

import { useSyncExternalStore } from 'react'

export interface Question {
  /** The question itself, e.g. "Delete this deadline?" */
  title: string
  /** Optional detail under it. */
  body?: string
  /** The confirming button's text, e.g. "Delete". */
  confirm: string
  /** Show the confirming button in the danger style (default: true, most questions are deletes). */
  danger?: boolean
}

interface Pending extends Question {
  resolve: (yes: boolean) => void
}

let current: Pending | null = null
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

/** Resolves true when the person confirms, false when they cancel or close the dialog. */
export function ask(question: Question): Promise<boolean> {
  current?.resolve(false) // only one question at a time
  return new Promise((resolve) => {
    current = { danger: true, ...question, resolve }
    emit()
  })
}

export function answer(yes: boolean) {
  const pending = current
  current = null
  emit()
  pending?.resolve(yes)
}

export function useQuestion() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => current,
  )
}
