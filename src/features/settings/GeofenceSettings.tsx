import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { apiFetch } from '../../lib/api'
import { MapPin, ShieldCheck, AlertCircle, CheckCircle2 } from 'lucide-react'

interface GeofenceConfig {
  defaultRadius: number
  maxAccuracy: number
  maxStalenessSeconds: number
}

export function GeofenceSettings() {
  const queryClient = useQueryClient()
  const [radius, setRadius] = useState<number>(50)
  const [accuracy, setAccuracy] = useState<number>(100)
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const { data: config, isLoading } = useQuery<GeofenceConfig>({
    queryKey: ['settings', 'geofence'],
    queryFn: () => apiFetch<GeofenceConfig>('/settings/geofence'),
  })

  useEffect(() => {
    if (config) {
      setRadius(config.defaultRadius)
      setAccuracy(config.maxAccuracy)
    }
  }, [config])

  const mutation = useMutation({
    mutationFn: (body: { defaultRadius: number; maxAccuracy: number }) =>
      apiFetch<GeofenceConfig>('/settings/geofence', {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(['settings', 'geofence'], data)
      setSaveSuccess(true)
      setSaveError(null)
      setTimeout(() => setSaveSuccess(false), 4000)
    },
    onError: (err: Error) => {
      setSaveError(err.message || 'Failed to update geofence configuration')
      setSaveSuccess(false)
    },
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setSaveError(null)
    setSaveSuccess(false)
    if (radius < 10 || radius > 2000) {
      setSaveError('Radius must be between 10 and 2000 meters')
      return
    }
    mutation.mutate({ defaultRadius: radius, maxAccuracy: accuracy })
  }

  return (
    <Card>
      <div className="section-heading" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.25rem' }}>
        <MapPin size={22} className="text-primary" />
        <div>
          <h2 style={{ fontSize: '1.15rem', fontWeight: 600, margin: 0 }}>GPS Geofence Configuration</h2>
          <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--muted)' }}>
            Control the allowed location boundary and verification parameters for field check-ins.
          </p>
        </div>
      </div>

      {isLoading ? (
        <p style={{ color: 'var(--muted)', fontSize: '0.875rem' }}>Loading configuration...</p>
      ) : (
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1rem' }}>
            <div>
              <label htmlFor="defaultRadius" style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.35rem' }}>
                Default Geofence Radius (meters)
              </label>
              <input
                id="defaultRadius"
                type="number"
                min={10}
                max={2000}
                value={radius}
                onChange={(e) => setRadius(Number(e.target.value))}
                required
                className="input"
                style={{ width: '100%', padding: '0.5rem 0.75rem', borderRadius: '6px', border: '1px solid var(--border)' }}
              />
              <span style={{ fontSize: '0.75rem', color: 'var(--muted)', marginTop: '0.25rem', display: 'block' }}>
                Standard policy: 50 meters. Check-ins beyond this radius are rejected.
              </span>
            </div>

            <div>
              <label htmlFor="maxAccuracy" style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.35rem' }}>
                Max Allowed GPS Accuracy (meters)
              </label>
              <input
                id="maxAccuracy"
                type="number"
                min={10}
                max={500}
                value={accuracy}
                onChange={(e) => setAccuracy(Number(e.target.value))}
                required
                className="input"
                style={{ width: '100%', padding: '0.5rem 0.75rem', borderRadius: '6px', border: '1px solid var(--border)' }}
              />
              <span style={{ fontSize: '0.75rem', color: 'var(--muted)', marginTop: '0.25rem', display: 'block' }}>
                Standard threshold: 100 meters. Prevents imprecise or spoofed readings.
              </span>
            </div>
          </div>

          <div style={{ background: 'var(--surface-muted, #f8f9fa)', padding: '0.875rem', borderRadius: '6px', fontSize: '0.8rem', color: 'var(--muted)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem', color: 'var(--foreground)' }}>
              <ShieldCheck size={16} />
              <strong>Enforcement Rules:</strong>
            </div>
            <ul style={{ margin: 0, paddingLeft: '1.25rem', lineHeight: '1.4' }}>
              <li><strong>Check-in</strong>: Verified via Haversine distance. Rejects if distance &gt; radius or GPS accuracy &gt; threshold.</li>
              <li><strong>Check-out</strong>: Never blocked. Records distance and marks OUTSIDE_GEOFENCE if executive has departed.</li>
              <li><strong>Exceptions</strong>: Super Admin and Marketing Heads can authorize exceptions for genuine indoor/basement locations.</li>
            </ul>
          </div>

          {saveError && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#e11d48', fontSize: '0.875rem' }}>
              <AlertCircle size={16} />
              <span>{saveError}</span>
            </div>
          )}

          {saveSuccess && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#16a34a', fontSize: '0.875rem' }}>
              <CheckCircle2 size={16} />
              <span>Geofence configuration updated and active system-wide.</span>
            </div>
          )}

          <div>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? 'Saving...' : 'Save Geofence Settings'}
            </Button>
          </div>
        </form>
      )}
    </Card>
  )
}
