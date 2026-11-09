import { useEffect, useRef, useState } from 'react'
import { Loader2, MapPin, Navigation, Search } from 'lucide-react'
import { apiFetch } from '../../lib/api'

export type AutocompletePlace = {
  placeId: string
  description: string
  mainText: string
  secondaryText: string
  latitude?: number
  longitude?: number
  formattedAddress?: string
}

type Props = {
  defaultValue?: string
  defaultLatitude?: number
  defaultLongitude?: number
  defaultPlaceId?: string
  defaultFormattedAddress?: string
  required?: boolean
  label?: string
}

export function AddressAutocomplete({
  defaultValue = '',
  defaultLatitude,
  defaultLongitude,
  defaultPlaceId = '',
  defaultFormattedAddress = '',
  required = false,
  label = 'Address',
}: Props) {
  const [address, setAddress] = useState(defaultValue)
  const [latitude, setLatitude] = useState<number | undefined>(defaultLatitude)
  const [longitude, setLongitude] = useState<number | undefined>(defaultLongitude)
  const [placeId, setPlaceId] = useState(defaultPlaceId)
  const [formattedAddress, setFormattedAddress] = useState(defaultFormattedAddress)

  const [isOpen, setIsOpen] = useState(false)
  const [suggestions, setSuggestions] = useState<AutocompletePlace[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isLocating, setIsLocating] = useState(false)
  const [isManuallyEdited, setIsManuallyEdited] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(-1)
  const [apiError, setApiError] = useState(false)

  const containerRef = useRef<HTMLDivElement>(null)
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    setAddress(defaultValue)
    setLatitude(defaultLatitude)
    setLongitude(defaultLongitude)
    setPlaceId(defaultPlaceId)
    setFormattedAddress(defaultFormattedAddress)
    setIsManuallyEdited(false)
  }, [defaultValue, defaultLatitude, defaultLongitude, defaultPlaceId, defaultFormattedAddress])

  // Handle outside click to close dropdown
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const fetchSuggestions = async (query: string) => {
    if (!query.trim() || query.trim().length < 2) {
      setSuggestions([])
      setIsOpen(false)
      setIsLoading(false)
      return
    }

    setIsLoading(true)
    setApiError(false)

    try {
      const data = await apiFetch<{ predictions: AutocompletePlace[] }>(
        `/maps/autocomplete?input=${encodeURIComponent(query.trim())}`,
      )
      const list = data?.predictions ?? []
      setSuggestions(list)
      setIsOpen(true)
      setSelectedIndex(-1)
    } catch {
      setApiError(true)
      setSuggestions([])
      setIsOpen(false)
    } finally {
      setIsLoading(false)
    }
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value
    setAddress(val)
    // When manually edited, clear coordinates unless a suggestion is chosen
    setLatitude(undefined)
    setLongitude(undefined)
    setPlaceId('')
    setFormattedAddress('')
    setIsManuallyEdited(true)

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current)
    }

    if (val.trim().length >= 2) {
      setIsLoading(true)
      debounceTimerRef.current = setTimeout(() => {
        void fetchSuggestions(val)
      }, 350) // 350ms debounce
    } else {
      setSuggestions([])
      setIsOpen(false)
      setIsLoading(false)
    }
  }

  const handleUseCurrentLocation = () => {
    if (!navigator.geolocation) {
      alert('Geolocation is not supported by your browser')
      return
    }
    const confirmed = window.confirm(
      'Assign your device\'s current GPS position as this client\'s registered location? Make sure you are physically located at the client\'s premises.'
    )
    if (!confirmed) return

    setIsLocating(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = Number(pos.coords.latitude.toFixed(6))
        const lng = Number(pos.coords.longitude.toFixed(6))
        setLatitude(lat)
        setLongitude(lng)
        setIsLocating(false)
        setIsManuallyEdited(false)
        if (!address.trim()) {
          const autoAddr = `Coordinates (${lat}, ${lng})`
          setAddress(autoAddr)
          setFormattedAddress(autoAddr)
        }
      },
      (err) => {
        setIsLocating(false)
        alert(`Failed to get device location: ${err.message}`)
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    )
  }

  const handleSelectSuggestion = async (item: AutocompletePlace) => {
    const chosenAddress = item.description || item.mainText
    setAddress(chosenAddress)
    setFormattedAddress(chosenAddress)
    setPlaceId(item.placeId)
    setIsOpen(false)
    setSelectedIndex(-1)
    setIsManuallyEdited(false)

    if (item.latitude !== undefined && item.longitude !== undefined) {
      setLatitude(item.latitude)
      setLongitude(item.longitude)
    } else if (item.placeId) {
      // Fetch details if coordinates are missing from autocomplete
      try {
        const details = await apiFetch<{
          latitude?: number
          longitude?: number
          formattedAddress?: string
        }>(`/maps/details?placeId=${encodeURIComponent(item.placeId)}`)
        if (details) {
          if (details.latitude !== undefined && details.longitude !== undefined) {
            setLatitude(details.latitude)
            setLongitude(details.longitude)
          }
          if (details.formattedAddress) {
            setAddress(details.formattedAddress)
            setFormattedAddress(details.formattedAddress)
          }
        }
      } catch {
        // Fall back to description
      }
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!isOpen || suggestions.length === 0) return

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIndex((prev) => (prev < suggestions.length - 1 ? prev + 1 : prev))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIndex((prev) => (prev > 0 ? prev - 1 : -1))
    } else if (e.key === 'Enter') {
      if (selectedIndex >= 0 && selectedIndex < suggestions.length) {
        e.preventDefault()
        void handleSelectSuggestion(suggestions[selectedIndex])
      }
    } else if (e.key === 'Escape') {
      setIsOpen(false)
    }
  }

  return (
    <div className="address-autocomplete-field" ref={containerRef} style={{ position: 'relative' }}>
      <label style={{ display: 'block', width: '100%' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem' }}>
          <span>{label}</span>
          <button
            type="button"
            onClick={handleUseCurrentLocation}
            disabled={isLocating}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--primary, #2563eb)',
              cursor: 'pointer',
              fontSize: '0.78rem',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.25rem',
              padding: '2px 4px',
              fontWeight: 500,
            }}
            title="Set client coordinates using device GPS"
          >
            <Navigation size={12} className={isLocating ? 'animate-spin' : ''} />
            {isLocating ? 'Getting location...' : 'Use current location'}
          </button>
        </div>
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
          <input
            name="address"
            type="text"
            value={address}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            onFocus={() => {
              if (suggestions.length > 0) setIsOpen(true)
            }}
            placeholder="Type address or search landmark / place..."
            required={required}
            autoComplete="off"
            style={{ width: '100%', paddingRight: '2rem' }}
          />
          <span
            style={{
              position: 'absolute',
              right: '0.6rem',
              display: 'flex',
              alignItems: 'center',
              pointerEvents: 'none',
              color: '#666',
            }}
          >
            {isLoading ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Search size={16} />
            )}
          </span>
        </div>
      </label>

      {/* Hidden inputs to pass coordinate data in standard form submissions */}
      <input type="hidden" name="latitude" value={latitude !== undefined ? latitude : ''} />
      <input type="hidden" name="longitude" value={longitude !== undefined ? longitude : ''} />
      <input type="hidden" name="placeId" value={placeId} />
      <input type="hidden" name="formattedAddress" value={formattedAddress} />

      {/* Coordinate & place badge info */}
      {latitude !== undefined && longitude !== undefined ? (
        <p className="form-hint" style={{ marginTop: '0.25rem', fontSize: '0.75rem', color: '#16a34a' }}>
          ✓ Verified location coordinates: {latitude.toFixed(5)}, {longitude.toFixed(5)}
        </p>
      ) : isManuallyEdited && address.trim().length > 0 ? (
        <p className="form-hint" style={{ marginTop: '0.25rem', fontSize: '0.75rem', color: '#b45309' }}>
          ℹ️ Address entered manually. Select an Ola Maps suggestion or click &ldquo;Use current location&rdquo; to attach verified GPS coordinates.
        </p>
      ) : null}

      {apiError && (
        <p className="form-hint" style={{ marginTop: '0.25rem', fontSize: '0.75rem', color: '#6b7280' }}>
          Map suggestions unavailable — manual entry enabled.
        </p>
      )}

      {/* Suggestions dropdown */}
      {isOpen && (
        <ul
          role="listbox"
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            zIndex: 50,
            backgroundColor: '#fff',
            border: '1px solid #e5e7eb',
            borderRadius: '0.375rem',
            boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
            maxHeight: '15rem',
            overflowY: 'auto',
            margin: '0.25rem 0 0 0',
            padding: 0,
            listStyle: 'none',
          }}
        >
          {suggestions.length === 0 ? (
            <li
              style={{
                padding: '0.5rem 0.75rem',
                fontSize: '0.875rem',
                color: '#6b7280',
              }}
            >
              No matching places found. You can enter the address manually.
            </li>
          ) : (
            suggestions.map((item, index) => {
              const isSelected = index === selectedIndex
              return (
                <li
                  key={item.placeId || `${item.description}-${index}`}
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => void handleSelectSuggestion(item)}
                  onMouseEnter={() => setSelectedIndex(index)}
                  style={{
                    padding: '0.5rem 0.75rem',
                    cursor: 'pointer',
                    backgroundColor: isSelected ? '#f3f4f6' : '#fff',
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '0.5rem',
                    borderBottom: index < suggestions.length - 1 ? '1px solid #f3f4f6' : 'none',
                  }}
                >
                  <MapPin size={15} style={{ marginTop: '0.2rem', flexShrink: 0, color: '#4b5563' }} />
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <span style={{ fontWeight: 500, fontSize: '0.875rem', color: '#111827' }}>
                      {item.mainText}
                    </span>
                    {item.secondaryText && (
                      <span style={{ fontSize: '0.75rem', color: '#6b7280' }}>
                        {item.secondaryText}
                      </span>
                    )}
                  </div>
                </li>
              )
            })
          )}
        </ul>
      )}
    </div>
  )
}

