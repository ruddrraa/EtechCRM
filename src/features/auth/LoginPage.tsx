import { useState } from 'react'
import { Eye, EyeOff, LockKeyhole, Mail } from 'lucide-react'
import { useAuth } from './AuthContext'
import { Button } from '../../components/ui/Button'
import { BrandLogo } from '../../components/ui/BrandLogo'

export function LoginPage() {
  const { login } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setError('')
    setSubmitting(true)
    try { await login(email, password) } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to sign in') } finally { setSubmitting(false) }
  }
  return <div className="login-page"><div className="login-card"><div className="login-brand"><BrandLogo size="login" /></div><p className="eyebrow">Secure workspace</p><h1>Welcome back</h1><p className="page-description">Sign in to your Excel Technologies and Services workspace.</p><form onSubmit={submit} className="login-form"><label htmlFor="login-email">Email<span className="login-input"><Mail size={16} aria-hidden="true" /><input id="login-email" type="email" required value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" /></span></label><label htmlFor="login-password">Password<span className="login-input"><LockKeyhole size={16} aria-hidden="true" /><input id="login-password" type={showPassword ? 'text' : 'password'} required minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" /><button type="button" className="password-toggle" onClick={() => setShowPassword((visible) => !visible)} aria-label={showPassword ? 'Hide password' : 'Show password'}>{showPassword ? <EyeOff size={16} /> : <Eye size={16} />}</button></span></label>{error && <p className="form-error" role="alert">{error}</p>}<Button type="submit" disabled={submitting}>{submitting ? 'Signing in...' : 'Sign in'}</Button></form><p className="login-footer">Excel Technologies and Services</p></div></div>
}
