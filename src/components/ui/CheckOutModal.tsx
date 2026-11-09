import { useState, useEffect } from 'react'
import { Modal } from './Modal'
import { Button } from './Button'
import { MapPin, Navigation, AlertTriangle, CheckCircle2 } from 'lucide-react'

export interface CheckOutVisit {
  _id: string
  client?: {
    _id?: string
    organisationName?: string
    address?: string
    latitude?: number
    longitude?: number
    geofenceRadius?: number
  }
}

interface GPSReading {
  latitude: number
  longitude: number
  accuracy: number
  recordedAt: string
}

function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000
  const toRad = (x: number) => (x * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)))
}

export function CheckOutModal({
  visit,
  onClose,
  onComplete,
  isSubmitting,
  submissionError,
}: {
  visit: CheckOutVisit
  onClose: () => void
  onComplete: (payload: {
    remarks: string
    followUpDate?: string
    location: {
      latitude?: number
      longitude?: number
      accuracy?: number
      recordedAt?: string
      locationStatus: 'AVAILABLE' | 'LOCATION_UNAVAILABLE'
    }
  }) => void
  isSubmitting: boolean
  submissionError?: string | null
}) {
  const [gps, setGps] = useState<GPSReading | null>(null)
  const [gpsError, setGpsError] = useState<string | null>(null)
  const [isAcquiring, setIsAcquiring] = useState(true)

  const allowedRadius = visit.client?.geofenceRadius || 50
  const clientLat = visit.client?.latitude
  const clientLng = visit.client?.longitude
  const hasClientCoords = typeof clientLat === 'number' && typeof clientLng === 'number'

  useEffect(() => {
    setIsAcquiring(true)
    if (!navigator.geolocation) {
      setGpsError('Geolocation is not supported by your browser')
      setIsAcquiring(false)
      return
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGps({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: Math.round(pos.coords.accuracy),
          recordedAt: new Date(pos.timestamp).toISOString(),
        })
        setIsAcquiring(false)
      },
      (err) => {
        setGpsError(err.message || 'GPS location unavailable')
        setIsAcquiring(false)
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
      }
    )
  }, [])

  const distance = gps && hasClientCoords
    ? calculateDistance(clientLat!, clientLng!, gps.latitude, gps.longitude)
    : null

  const isOutside = distance !== null && distance > allowedRadius

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    const remarks = String(form.get('remarks') ?? '').trim()
    const followUpDate = form.get('followUpDate') ? String(form.get('followUpDate')) : undefined

    onComplete({
      remarks,
      followUpDate,
      location: gps
        ? {
            latitude: gps.latitude,
            longitude: gps.longitude,
            accuracy: gps.accuracy,
            recordedAt: gps.recordedAt,
            locationStatus: 'AVAILABLE',
          }
        : {
            locationStatus: 'LOCATION_UNAVAILABLE',
          },
    })
  }

  return (
    <Modal title="Complete Visit & Check-out" onClose={onClose}>
      <form onSubmit={handleSubmit} className="modal-form" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
        {/* Client & Departure Location Details */}
        <div style={{ border: '1px solid var(--border)', borderRadius: '8px', padding: '0.875rem', background: 'var(--surface-muted, #fafafa)', fontSize: '0.85rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.35rem' }}>
            <MapPin size={16} className="text-primary" />
            <strong>Client: {visit.client?.organisationName || 'Client'}</strong>
          </div>
          <p style={{ margin: '0 0 0.5rem 0', color: 'var(--muted)' }}>{visit.client?.address}</p>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Navigation size={15} />
            {isAcquiring ? (
              <span style={{ color: 'var(--muted)' }}>Acquiring departure GPS...</span>
            ) : gps ? (
              <span>Departure Location: {gps.latitude.toFixed(5)}, {gps.longitude.toFixed(5)} (±{gps.accuracy}m)</span>
            ) : (
              <span style={{ color: '#d97706' }}>Departure GPS: Unavailable</span>
            )}
          </div>
        </div>

        {/* Departure Verification Feedback */}
        {!isAcquiring && (
          <div>
            {distance !== null && !isOutside ? (
              <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '8px', padding: '0.75rem', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <CheckCircle2 size={18} color="#16a34a" />
                <span style={{ color: '#166534', fontSize: '0.85rem' }}>
                  Location verified · You are {distance}m from the client premises.
                </span>
              </div>
            ) : isOutside ? (
              <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '8px', padding: '0.75rem', display: 'flex', gap: '0.5rem', alignItems: 'flex-start' }}>
                <AlertTriangle size={18} color="#d97706" style={{ flexShrink: 0, marginTop: '2px' }} />
                <div style={{ fontSize: '0.85rem' }}>
                  <strong style={{ color: '#92400e', display: 'block' }}>Outside Geofence Warning ({distance}m away)</strong>
                  <span style={{ color: '#b45309' }}>
                    You have moved away from the client location. You can continue check-out; your location will be recorded with <strong>OUTSIDE_GEOFENCE</strong> verification status.
                  </span>
                </div>
              </div>
            ) : gpsError ? (
              <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '8px', padding: '0.75rem', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <AlertTriangle size={18} color="#d97706" />
                <span style={{ color: '#b45309', fontSize: '0.85rem' }}>
                  GPS unavailable ({gpsError}). Check-out will be recorded with <strong>LOCATION_UNAVAILABLE</strong>.
                </span>
              </div>
            ) : null}
          </div>
        )}

        <label>
          Meeting remarks
          <textarea name="remarks" required rows={3} style={{ width: '100%', padding: '0.5rem 0.75rem', borderRadius: '6px', border: '1px solid var(--border)', marginTop: '0.35rem' }} />
        </label>
        <label>
          Follow-up date (optional)
          <input name="followUpDate" type="date" style={{ width: '100%', padding: '0.5rem 0.75rem', borderRadius: '6px', border: '1px solid var(--border)', marginTop: '0.35rem' }} />
        </label>

        {submissionError && (
          <p style={{ margin: 0, color: '#e11d48', fontSize: '0.875rem' }} role="alert">
            {submissionError}
          </p>
        )}

        <div className="modal-actions" style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
          <Button type="button" variant="secondary" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={isSubmitting}>
            {isSubmitting ? 'Completing...' : isOutside ? 'Continue & Complete Check-out' : 'Complete Visit'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
