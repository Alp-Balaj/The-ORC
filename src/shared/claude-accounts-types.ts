/** Types shared by the Claude accounts main code, preload and UI. */

export type ClaudeAccountState = 'logged-in' | 'expired' | 'logged-out' | 'logging-in' | 'error'

export interface ClaudeAccountView {
  id: string
  name: string
  isDefault: boolean
  active: boolean
  state: ClaudeAccountState
  email: string | null
  plan: string | null
  expiresAt: string | null
  error: string | null
  /** While logging in: the sign-in URL the CLI printed (open it if no browser appeared). */
  loginUrl: string | null
}
