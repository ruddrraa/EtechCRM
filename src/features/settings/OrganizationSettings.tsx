import React, { useState } from 'react'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { FileUpload } from '../../components/ui/FileUpload'
import { BrandLogo } from '../../components/ui/BrandLogo'
import { useOrganization } from '../organization/OrganizationContext'
import { Building2, CheckCircle2, AlertCircle, Eye } from 'lucide-react'

export function OrganizationSettings() {
  const { organization, updateOrganization, isUpdating } = useOrganization()

  const [name, setName] = useState(organization.name || '')
  const [email, setEmail] = useState(organization.email || '')
  const [phone, setPhone] = useState(organization.phone || '')
  const [address, setAddress] = useState(organization.address || '')
  const [successMsg, setSuccessMsg] = useState('')
  const [errorMsg, setErrorMsg] = useState('')

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    setSuccessMsg('')
    setErrorMsg('')

    if (!name.trim()) {
      setErrorMsg('Organization name is required.')
      return
    }

    try {
      await updateOrganization({
        name: name.trim(),
        email: email.trim() || undefined,
        phone: phone.trim() || undefined,
        address: address.trim() || undefined,
      })
      setSuccessMsg('Organization profile updated successfully.')
      setTimeout(() => setSuccessMsg(''), 4000)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to update organization profile.'
      setErrorMsg(msg)
    }
  }

  // Use real Organization _id once loaded; fall back to explicit server-recognized pending placeholder only before initialization
  const orgOwnerId = organization._id && /^[a-f\d]{24}$/i.test(organization._id)
    ? organization._id
    : '000000000000000000000001'

  return (
    <Card>
      <div className="section-heading" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.5rem' }}>
        <Building2 size={22} className="text-primary" />
        <div>
          <h2 style={{ fontSize: '1.15rem', fontWeight: 600, margin: 0 }}>Organization Profile &amp; Branding</h2>
          <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--muted)' }}>
            Configure your workspace branding, sidebar logos and details used in reports and exports.
          </p>
        </div>
      </div>

      <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1rem' }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', fontSize: '0.875rem', fontWeight: 500 }}>
            Organization Name *
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              placeholder="e.g. Acme Corporation"
              style={{
                height: '38px',
                padding: '0 0.75rem',
                borderRadius: '6px',
                border: '1px solid var(--border)',
                background: 'var(--surface)',
                fontSize: '0.875rem',
              }}
            />
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', fontSize: '0.875rem', fontWeight: 500 }}>
            Official Email
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="contact@company.com"
              style={{
                height: '38px',
                padding: '0 0.75rem',
                borderRadius: '6px',
                border: '1px solid var(--border)',
                background: 'var(--surface)',
                fontSize: '0.875rem',
              }}
            />
          </label>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1rem' }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', fontSize: '0.875rem', fontWeight: 500 }}>
            Phone Number
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+91 33 2222 1111"
              style={{
                height: '38px',
                padding: '0 0.75rem',
                borderRadius: '6px',
                border: '1px solid var(--border)',
                background: 'var(--surface)',
                fontSize: '0.875rem',
              }}
            />
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', fontSize: '0.875rem', fontWeight: 500 }}>
            Headquarters / Office Address
            <input
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Suite 400, Tech Park, City, State, PIN"
              style={{
                height: '38px',
                padding: '0 0.75rem',
                borderRadius: '6px',
                border: '1px solid var(--border)',
                background: 'var(--surface)',
                fontSize: '0.875rem',
              }}
            />
          </label>
        </div>

        {/* Dynamic Logo Management */}
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: '1.25rem', marginTop: '0.5rem' }}>
          <h3 style={{ fontSize: '0.95rem', fontWeight: 600, margin: '0 0 0.5rem 0' }}>
            Sidebar &amp; Header Logos
          </h3>
          <p style={{ margin: '0 0 1rem 0', fontSize: '0.825rem', color: 'var(--muted)' }}>
            Upload custom logos for your CRM workspace. The expanded logo appears in the default sidebar and exports, while the collapsed logo appears in the mini sidebar.
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1.5rem' }}>
            <div style={{ border: '1px solid var(--border)', borderRadius: '8px', padding: '1rem', background: 'var(--surface-muted, #fdfdfd)' }}>
              <span style={{ fontSize: '0.85rem', fontWeight: 600, display: 'block', marginBottom: '0.5rem' }}>
                Expanded Sidebar Logo (Recommended: ~210x42px)
              </span>
              <FileUpload
                ownerType="ORGANIZATION_EXPANDED_LOGO"
                ownerId={orgOwnerId}
                label=""
                description="Upload expanded logo"
                accept="image/png,image/jpeg,image/webp"
                maxSizeBytes={5 * 1024 * 1024}
                currentUrl={organization.expandedLogo}
                onUploadSuccess={async (data) => {
                  await updateOrganization({ expandedLogo: data.viewUrl || data.signedUrl })
                }}
                onDeleteSuccess={async () => {
                  await updateOrganization({ expandedLogo: '' })
                }}
              />
            </div>

            <div style={{ border: '1px solid var(--border)', borderRadius: '8px', padding: '1rem', background: 'var(--surface-muted, #fdfdfd)' }}>
              <span style={{ fontSize: '0.85rem', fontWeight: 600, display: 'block', marginBottom: '0.5rem' }}>
                Collapsed Sidebar Icon (Recommended: ~36x36px square)
              </span>
              <FileUpload
                ownerType="ORGANIZATION_COLLAPSED_LOGO"
                ownerId={orgOwnerId}
                label=""
                description="Upload compact logo icon"
                accept="image/png,image/jpeg,image/webp"
                maxSizeBytes={5 * 1024 * 1024}
                currentUrl={organization.collapsedLogo}
                onUploadSuccess={async (data) => {
                  await updateOrganization({ collapsedLogo: data.viewUrl || data.signedUrl })
                }}
                onDeleteSuccess={async () => {
                  await updateOrganization({ collapsedLogo: '' })
                }}
              />
            </div>
          </div>
        </div>

        {/* Live Branding Preview */}
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: '1.25rem' }}>
          <h3 style={{ fontSize: '0.95rem', fontWeight: 600, margin: '0 0 0.5rem 0', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Eye size={16} /> Live Workspace Branding Preview
          </h3>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1.25rem', alignItems: 'center' }}>
            <div>
              <small style={{ color: 'var(--muted)', display: 'block', marginBottom: '0.35rem', fontSize: '0.75rem' }}>Expanded Preview (Max 220x64px)</small>
              <div className="logo-preview-expanded-box">
                <BrandLogo size="sidebar" />
              </div>
            </div>

            <div>
              <small style={{ color: 'var(--muted)', display: 'block', marginBottom: '0.35rem', fontSize: '0.75rem' }}>Collapsed Preview (Max 64x64px)</small>
              <div className="logo-preview-collapsed-box">
                <BrandLogo size="collapsed" />
              </div>
            </div>

            <div style={{ flex: 1, minWidth: '200px' }}>
              <span style={{ fontSize: '0.8rem', color: 'var(--muted)', display: 'block' }}>Configured Display Name</span>
              <strong style={{ fontSize: '1.1rem', color: 'var(--foreground)' }}>{name || organization.name}</strong>
            </div>
          </div>
        </div>

        {successMsg && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#16a34a', fontSize: '0.875rem' }}>
            <CheckCircle2 size={16} />
            <span>{successMsg}</span>
          </div>
        )}

        {errorMsg && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#e11d48', fontSize: '0.875rem' }}>
            <AlertCircle size={16} />
            <span>{errorMsg}</span>
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-start', paddingTop: '0.5rem' }}>
          <Button type="submit" disabled={isUpdating}>
            {isUpdating ? 'Saving...' : 'Save Organization Profile'}
          </Button>
        </div>
      </form>
    </Card>
  )
}

