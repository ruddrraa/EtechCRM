import { useState, useEffect, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Modal } from './Modal'
import { Button } from './Button'
import { Badge } from './Badge'
import { MapPin, Navigation, RefreshCw, AlertTriangle, CheckCircle2, ShieldAlert } from 'lucide-react'
import { apiFetch } from '../../lib/api'

export interface CheckInVisit {
  _id: string
  client?: {
    _id?: string
    organisationName?: string
    address?: string
    latitude?: number
    longitude?: number
    geofenceRadius?: number
  }
  exceptionAuthorized?: boolean
  exceptionReason?: string
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

export function CheckInModal({
  visit,
  onClose,
  onCheckIn,
  isSubmitting,
  submissionError,
}: {
  visit: CheckInVisit
  onClose: () => void
  onCheckIn: (payload: {
    latitude?: number
    longitude?: number
    accuracy?: number
    recordedAt?: string
    locationStatus: 'AVAILABLE' | 'LOCATION_UNAVAILABLE'
    allowException?: boolean
    exceptionReason?: string
  }) => void
  isSubmitting: boolean
  submissionError?: string | null
}) {
  const [gps, setGps] = useState<GPSReading | null>(null)
  const [gpsError, setGpsError] = useState<string | null>(null)
  const [isAcquiring, setIsAcquiring] = useState(true)

  const { data: config } = useQuery<{ defaultRadius: number; maxAccuracy: number } | null>({
    queryKey: ['settings', 'geofence'],
    queryFn: () => apiFetch<{ defaultRadius: number; maxAccuracy: number }>('/settings/geofence').catch(() => null),
    staleTime: 60000,
  })

  const allowedRadius = visit.client?.geofenceRadius || config?.defaultRadius || 50
  const clientLat = visit.client?.latitude
  const clientLng = visit.client?.longitude
  const hasClientCoords = typeof clientLat === 'number' && typeof clientLng === 'number'

  const configuredMaxAccuracy = config?.maxAccuracy ?? 100
  const maxAllowedAccuracy = Math.max(configuredMaxAccuracy, allowedRadius)

  const acquireGPS = useCallback(() => {
    setIsAcquiring(true)
    setGpsError(null)

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
        setGpsError(err.message || 'Unable to retrieve your current location. Please ensure location services are enabled.')
        setIsAcquiring(false)
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0,
      }
    )
  }, [])

  useEffect(() => {
    acquireGPS()
  }, [acquireGPS])

  // Distance calculation
  const distance = gps && hasClientCoords
    ? calculateDistance(clientLat!, clientLng!, gps.latitude, gps.longitude)
    : null

  const isInsideRadius = distance !== null && distance <= allowedRadius
  const isAccuracyGood = gps !== null && gps.accuracy <= maxAllowedAccuracy
  const isVerified = isInsideRadius && isAccuracyGood

  const handleConfirm = () => {
    if (!gps) return
    onCheckIn({
      latitude: gps.latitude,
      longitude: gps.longitude,
      accuracy: gps.accuracy,
      recordedAt: gps.recordedAt,
      locationStatus: 'AVAILABLE',
    })
  }

  const handleExceptionCheckIn = () => {
    onCheckIn({
      latitude: gps?.latitude,
      longitude: gps?.longitude,
      accuracy: gps?.accuracy,
      recordedAt: gps?.recordedAt ?? new Date().toISOString(),
      locationStatus: gps ? 'AVAILABLE' : 'LOCATION_UNAVAILABLE',
      allowException: true,
      exceptionReason: visit.exceptionReason || 'Authorized location exception',
    })
  }

  return (
    <Modal title="Visit Check-in & Location Verification" onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
        {/* Client Registered Location */}
        <div style={{ border: '1px solid var(--border)', borderRadius: '8px', padding: '1rem', background: 'var(--surface-muted, #fafafa)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
            <MapPin size={18} className="text-primary" />
            <strong style={{ fontSize: '0.95rem' }}>Registered Client Location</strong>
          </div>
          <p style={{ margin: '0 0 0.25rem 0', fontWeight: 600 }}>{visit.client?.organisationName || 'Client'}</p>
          <p style={{ margin: '0 0 0.5rem 0', fontSize: '0.85rem', color: 'var(--muted)' }}>
            {visit.client?.address || 'No registered address'}
          </p>
          {hasClientCoords ? (
            <div style={{ display: 'flex', gap: '1rem', fontSize: '0.8rem', color: 'var(--muted)' }}>
              <span>Coordinates: {clientLat.toFixed(5)}, {clientLng.toFixed(5)}</span>
              <span>Allowed geofence: {allowedRadius}m</span>
            </div>
          ) : (
            <div style={{ background: '#fff1f2', border: '1px solid #fecdd3', borderRadius: '6px', padding: '0.625rem 0.75rem', marginTop: '0.5rem', display: 'flex', gap: '0.5rem', alignItems: 'flex-start' }}>
              <AlertTriangle size={16} color="#e11d48" style={{ flexShrink: 0, marginTop: '2px' }} />
              <div>
                <strong style={{ color: '#9f1239', fontSize: '0.82rem', display: 'block' }}>Unpinned Client Location</strong>
                <span style={{ color: '#be123c', fontSize: '0.78rem' }}>
                  This client does not have GPS coordinates registered in the master record. An administrator can update the client via Ola Maps suggestions, or a manager can authorize a check-in exception.
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Current Device Location */}
        <div style={{ border: '1px solid var(--border)', borderRadius: '8px', padding: '1rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Navigation size={18} />
              <strong style={{ fontSize: '0.95rem' }}>Your Current Location</strong>
            </div>
            <Button size="sm" variant="secondary" onClick={acquireGPS} disabled={isAcquiring}>
              <RefreshCw size={13} className={isAcquiring ? 'animate-spin' : ''} /> {isAcquiring ? 'Locating...' : 'Refresh GPS'}
            </Button>
          </div>

          {isAcquiring ? (
            <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--muted)' }}>Acquiring high-accuracy GPS signal...</p>
          ) : gpsError ? (
            <p style={{ margin: 0, fontSize: '0.85rem', color: '#e11d48' }}>{gpsError}</p>
          ) : gps ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem', fontSize: '0.85rem' }}>
              <div>Coordinates: <strong>{gps.latitude.toFixed(5)}, {gps.longitude.toFixed(5)}</strong></div>
              {distance !== null && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <span>Distance to Client: <strong>{distance} meters</strong></span>
                  {distance <= allowedRadius ? (
                    <Badge tone="success">Inside geofence ({distance}m ≤ {allowedRadius}m)</Badge>
                  ) : (
                    <Badge tone="danger">{distance - allowedRadius}m beyond {allowedRadius}m geofence</Badge>
                  )}
                </div>
              )}
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                <span>Device GPS Accuracy: ±{gps.accuracy}m</span>
                {gps.accuracy <= 30 ? (
                  <Badge tone="success">High accuracy (satellite)</Badge>
                ) : gps.accuracy <= maxAllowedAccuracy ? (
                  <Badge tone="neutral">Acceptable (≤ ±{maxAllowedAccuracy}m)</Badge>
                ) : (
                  <Badge tone="warning">Poor accuracy (&gt; ±{maxAllowedAccuracy}m)</Badge>
                )}
              </div>
              <span style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>
                * Note: Device accuracy (±{gps.accuracy}m) is your hardware/network positioning margin. Your actual distance to the client is {distance ?? 0}m.
              </span>
            </div>
          ) : null}
        </div>

        {/* Verification Status Banner */}
        {!isAcquiring && (
          <div>
            {isVerified ? (
              <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '8px', padding: '0.875rem', display: 'flex', gap: '0.75rem', alignItems: 'flex-start' }}>
                <CheckCircle2 size={20} color="#16a34a" style={{ flexShrink: 0, marginTop: '2px' }} />
                <div>
                  <strong style={{ color: '#166534', fontSize: '0.9rem', display: 'block' }}>Location Verified</strong>
                  <span style={{ color: '#15803d', fontSize: '0.85rem' }}>
                    You are <strong>{distance}m</strong> away from the client (within the {allowedRadius}m allowed geofence) with acceptable device precision (±{gps?.accuracy}m ≤ ±{maxAllowedAccuracy}m).
                  </span>
                </div>
              </div>
            ) : distance !== null && distance > allowedRadius ? (
              <div style={{ background: '#fff1f2', border: '1px solid #fecdd3', borderRadius: '8px', padding: '0.875rem', display: 'flex', gap: '0.75rem', alignItems: 'flex-start' }}>
                <AlertTriangle size={20} color="#e11d48" style={{ flexShrink: 0, marginTop: '2px' }} />
                <div>
                  <strong style={{ color: '#9f1239', fontSize: '0.9rem', display: 'block' }}>Outside Geofence</strong>
                  <span style={{ color: '#be123c', fontSize: '0.85rem' }}>
                    You are <strong>{distance}m</strong> away from the registered client location. Check-in is only permitted within <strong>{allowedRadius}m</strong>. Please move closer to the client location.
                  </span>
                </div>
              </div>
            ) : gps && !isAccuracyGood ? (
              <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '8px', padding: '0.875rem', display: 'flex', gap: '0.75rem', alignItems: 'flex-start' }}>
                <AlertTriangle size={20} color="#d97706" style={{ flexShrink: 0, marginTop: '2px' }} />
                <div>
                  <strong style={{ color: '#92400e', fontSize: '0.9rem', display: 'block' }}>Insufficient GPS Accuracy (±{gps.accuracy}m)</strong>
                  <span style={{ color: '#b45309', fontSize: '0.85rem', display: 'block', marginBottom: '0.25rem' }}>
                    Your measured distance is <strong>{distance}m</strong>, but device uncertainty is ±{gps.accuracy}m (required within ±{maxAllowedAccuracy}m).
                  </span>
                  <ul style={{ margin: 0, paddingLeft: '1.2rem', color: '#92400e', fontSize: '0.8rem' }}>
                    <li>Laptops use Wi-Fi network positioning which has higher uncertainty than mobile phones.</li>
                    <li>Step outdoors or move near an open window for better satellite reception.</li>
                    <li>Click &ldquo;Refresh GPS&rdquo; above once signal stabilizes.</li>
                  </ul>
                </div>
              </div>
            ) : null}
          </div>
        )}

        {/* Authorized Exception Banner */}
        {visit.exceptionAuthorized && (
          <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '8px', padding: '0.875rem', display: 'flex', gap: '0.75rem', alignItems: 'flex-start' }}>
            <ShieldAlert size={20} color="#2563eb" style={{ flexShrink: 0, marginTop: '2px' }} />
            <div>
              <strong style={{ color: '#1e40af', fontSize: '0.9rem', display: 'block' }}>Location Exception Pre-Authorized</strong>
              <span style={{ color: '#1d4ed8', fontSize: '0.85rem' }}>
                Reason: &ldquo;{visit.exceptionReason || 'Authorized by manager'}&rdquo;. You may check in despite location or GPS issues.
              </span>
            </div>
          </div>
        )}

        {submissionError && (
          <p style={{ margin: 0, color: '#e11d48', fontSize: '0.875rem' }} role="alert">
            {submissionError}
          </p>
        )}

        {/* Modal Actions */}
        <div className="modal-actions" style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
          <Button variant="secondary" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>

          {visit.exceptionAuthorized ? (
            <Button variant="primary" onClick={handleExceptionCheckIn} disabled={isSubmitting}>
              {isSubmitting ? 'Checking in...' : 'Check-in with Authorized Exception'}
            </Button>
          ) : (
            <Button variant="primary" onClick={handleConfirm} disabled={!isVerified || isSubmitting}>
              {isSubmitting
                ? 'Verifying & Checking in...'
                : !hasClientCoords
                ? 'Client GPS Missing'
                : !gps
                ? 'Acquiring GPS...'
                : !isInsideRadius
                ? `Outside Geofence (${distance}m)`
                : !isAccuracyGood
                ? `Accuracy Insufficient (±${gps.accuracy}m)`
                : 'Confirm Check-in'}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  )
}

